# ACP 연동 노트

- 대상: `grok agent stdio` (Agent Client Protocol, JSON-RPC 2.0 over stdio)
- 구현 위치: `packages/acp-client`
- 공식 문서: <https://docs.x.ai/build/cli/headless-scripting>, <https://docs.x.ai/build/cli/reference>

## 0. 실제 CLI로 확인한 사실 (grok 1.0.3, 2026-08-14)

아래는 추정이 아니라 실제 `grok agent stdio` 트래픽에서 확인한 내용이다.

| 항목 | 확인 결과 |
|---|---|
| 모델 목록 | `initialize` 응답의 `_meta.modelState`에 `currentModelId`와 `availableModels[]`(각 `modelId`, `name`, `description`, `_meta.totalContextTokens`)가 들어온다. `grok models`를 따로 실행할 필요가 없다. |
| 모델 지정 | `-m`는 `agent`의 옵션이라 **서브커맨드 앞**에 와야 한다. `grok agent -m grok-4.5 stdio` 는 동작하고, `grok agent stdio -m grok-4.5` 는 `unexpected argument '-m'`으로 **exit code 2**. |
| 세션 재개 | `agentCapabilities.loadSession: true`. `session/load`로 이전 대화를 에이전트 쪽에서도 복원한다. |
| 인증 방식 | `authMethods`: `cached_token`(기본), `grok.com`. `_meta.defaultAuthMethodId = cached_token`. |
| 사고/답변 분리 | `agent_thought_chunk`와 `agent_message_chunk`가 실제로 분리되어 온다. UI의 "생각 과정" 접기와 답변 본문이 정확히 나뉜다. |
| 도구 이벤트 | 첫 `tool_call`에 `kind`가 없을 수 있고(`title: "read_file"`), 뒤이은 이벤트에서 `kind: "read"`와 `locations`가 채워진다. 따라서 **kind가 없는 업데이트가 기존 kind를 덮어쓰면 안 된다.** |
| 사용량 | 남은 사용량을 알려주는 명령이나 필드는 없다. 한도 초과 시 429 본문의 `tokens (actual/limit): 508641/500000` 이 유일한 실측값이다. |

## 1. 프로세스 기동

```ts
spawn(binaryPath, ['agent', 'stdio'], {
  cwd: workspace.canonicalRootPath,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: sanitizeEnvironment(process.env),
  detached: process.platform !== 'win32', // 프로세스 그룹 종료용
});
```

명세 11.1의 `--no-auto-update`는 공식 레퍼런스에서 확인되지 않아 기본 인자에서 제외했다. 지원이 확인되면 `ConnectionOptions.args`로 추가하면 된다.

## 2. 사용하는 메서드

### 앱 → 에이전트

| 메서드 | 용도 | 비고 |
|---|---|---|
| `initialize` | 프로토콜 버전과 클라이언트 능력 교환 | `fs.readTextFile`/`fs.writeTextFile` = true, `terminal` = false |
| `authenticate` | 인증 방식 선택 | 보통 CLI가 이미 로그인 상태라 호출하지 않음 |
| `session/new` | `cwd`를 지정해 세션 생성 | 반환된 `sessionId`가 이후 모든 호출의 키 |
| `session/prompt` | 사용자 요청 전송 | 응답의 `stopReason`으로 턴 종료 |
| `session/cancel` | 실행 중단 (알림) | 응답 없음 |

### 에이전트 → 앱

| 메서드 | 처리 |
|---|---|
| `session/update` (알림) | `parseSessionUpdate()`로 정규화 후 UI 이벤트로 변환 |
| `session/request_permission` | 권한 엔진 평가 → 자동 허용/자동 거부/승인 카드 |
| `fs/read_text_file` | 경로 정규화 + 루트 봉쇄, 민감 파일이면 승인 요청 |
| `fs/write_text_file` | 경로 봉쇄 + 프로필 검사 + 변경 전 스냅샷 + diff 산출 |
| 그 외 | `-32601 method not found` 로 거부 |

`terminal` 능력을 끈 이유: 명령 실행을 CLI 샌드박스 안에 두어 이중 통제(앱 승인 + CLI 샌드박스)를 유지하기 위해서다. 명령 출력은 `tool_call` 콘텐츠로 들어온다.

## 3. `session/update` 매핑

| `sessionUpdate` | 내부 표현 | UI |
|---|---|---|
| `agent_message_chunk` | `agent-message` | 답변 말풍선(스트리밍) |
| `agent_thought_chunk` | `agent-thought` | 접히는 "생각 과정" |
| `user_message_chunk` | `user-message` | 무시(앱이 이미 표시함) |
| `tool_call` / `tool_call_update` | `tool-call` | 도구 카드(id 기준 병합) |
| `plan` | `plan` | 작업 계획 카드 |
| `current_mode_update` | `mode` | 현재는 로그만 |
| 그 외 | `unsupported` | 로그만 남기고 무시 |

`tool_call`의 `kind`는 `read/search/edit/delete/move/execute/fetch/think` 외의 값이면 `other`로 정규화하고, `status`는 `in_progress` → `in-progress`처럼 앱 표기로 바꾼다.

## 4. 상태 머신

명세 11.3의 상태는 두 계층으로 나뉜다.

```text
연결(GrokAgentConnection): stopped → starting → ready → (failed)
세션(SessionManager):      starting → idle → running → waiting-approval → idle | failed → closed
런타임(RuntimeService):    not-installed | unauthenticated | ready | failed
```

- CLI 미설치/인증 없음은 세션을 만들기 전에 런타임 상태로 판별한다.
- 프롬프트 오류 메시지에 `auth|login|credential|unauthor` 가 보이면 `auth-required` 오류로 승격해 재로그인을 안내한다.
- 자식 프로세스가 죽으면 대기 중인 모든 요청이 같은 오류로 reject되고, 마지막 stderr 50줄이 마스킹되어 오류 카드에 붙는다.

## 5. 견고성 규칙

- stdout은 줄 단위로 파싱하며, JSON이 아닌 줄(배너·경고)은 오류로 보고만 하고 건너뛴다.
- 한 줄이 32MB를 넘으면 버퍼를 비우고 오류를 보고한다.
- 모든 요청에 타임아웃이 있고(기본 180초, initialize 30초), 타임아웃된 요청은 pending 맵에서 제거된다.
- 스키마 검증은 실패해도 예외를 던지지 않고 `unsupported`로 흡수한다. 프로토콜이 확장되어도 앱이 죽지 않는다.

## 6. 검증 방법

실제 CLI 없이도 전체 왕복을 검증할 수 있도록 `tests/fixtures/fake-agent.mjs`가 있다.

```bash
pnpm test:e2e
```

시나리오: `basic`(스트리밍), `permission`(승인 → 파일 쓰기), `noise`(비-JSON 배너), `escape`(작업공간 밖 읽기 시도), `crash`(턴 중간 종료).

0절의 항목은 실제 CLI로 확인을 마쳤다. 아직 실측하지 못한 것은 다음뿐이다.

1. `session/request_permission`의 실제 옵션 `kind` 값 — 쓰기·명령 실행을 동반하는 턴을 아직 실제 CLI로 돌려보지 않았다. 현재 구현은 옵션이 비어 있거나 `kind`가 없어도 앱이 자체 선택지(한 번/세션/거부)를 제시하도록 되어 있다.
2. `execute` 도구의 `rawInput` 키 이름 — `command`/`cmd`/`shellCommand`/`script`를 모두 받도록 해 두었다.
3. `authenticate`를 실제로 호출해야 하는 상황 (지금은 CLI가 이미 로그인된 상태만 확인했다)
