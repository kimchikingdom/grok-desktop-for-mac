# Grok Desktop (비공식)

*[English README](README.md)*

> **비공식 커뮤니티 프로젝트입니다.** xAI가 만들거나 승인하거나 후원한 앱이 아니며, xAI와 아무런 제휴 관계가 없습니다.
> "Grok", "xAI"는 xAI Corp.의 상표이며, 이 저장소에서는 호환 대상을 가리키기 위한 설명 목적으로만 사용합니다.
> xAI의 로고·아이콘·브랜드 자산은 포함하지 않습니다.

선택한 폴더 안에서만 동작하는 로컬 에이전트 데스크톱 앱. 공식 **Grok Build CLI**를 ACP(Agent Client Protocol) 에이전트로 구동하고, 파일 수정과 명령 실행은 사용자의 승인을 거친다.

`grok.com`을 감싼 WebView가 아니다. 파일 읽기 → 변경 제안 → diff 승인 → 실행 → 결과 확인의 흐름을 로컬에서 처리한다.

## 요구사항

- Node.js LTS (`.nvmrc` = 22.11.0)
- pnpm 11 (`corepack pnpm ...` 로도 실행 가능)
- Grok Build CLI

CLI는 앱이 대신 설치하지 않는다. 직접 실행할 것:

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
```

설치 후 로그인:

```bash
grok login
```

앱은 `PATH`와 `~/.grok/bin`, `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin` 에서 `grok`을 찾는다. 다른 위치에 설치했다면 `GROK_DESKTOP_CLI_PATH` 환경변수로 지정한다.

## 개발

```bash
pnpm install
pnpm dev
```

| 명령 | 설명 |
|---|---|
| `pnpm dev` | 개발 모드 실행 (HMR) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | main/preload/packages + renderer 타입 검사 |
| `pnpm test` | 단위 테스트 |
| `pnpm test:security` | 경로 봉쇄·IPC 스키마·URL·환경변수 보안 테스트 |
| `pnpm test:e2e` | 가짜 ACP 에이전트로 승인 왕복까지 통합 테스트 |
| `pnpm build` | 프로덕션 번들 (`apps/desktop/out`) |
| `pnpm package:mac` | macOS DMG 빌드 |
| `pnpm verify` | lint + typecheck + test + test:security |

## 구조

```text
grok-desktop-mac/
├── apps/desktop/           Electron 앱
│   ├── src/main/           창·IPC·세션·권한·diff·저장소
│   ├── src/preload/        contextBridge 로 노출하는 유일한 API
│   └── src/renderer/       React UI (Node 접근 불가)
├── packages/
│   ├── shared/             도메인 타입, IPC 채널과 Zod 스키마, 브리지 인터페이스
│   ├── security/           경로 봉쇄·명령 위험도·비밀 마스킹·URL/환경변수 정책
│   └── acp-client/         JSON-RPC stdio 클라이언트, ACP 스키마, CLI 감지
├── tests/
│   ├── fixtures/           가짜 ACP 에이전트
│   ├── security/           보안 테스트
│   └── e2e/                통합 테스트
└── docs/                   명세·보안 모델·ACP 노트·릴리스 체크리스트
```

## 동작 방식

1. 앱이 `grok agent stdio`를 자식 프로세스로 띄우고 JSON-RPC로 통신한다.
2. 세션의 `cwd`는 사용자가 고른 폴더의 realpath다.
3. 에이전트의 파일 읽기·쓰기는 앱을 거치므로 모든 경로가 작업공간 안인지 검증된다.
4. 상태를 바꾸는 도구 호출은 권한 엔진이 평가해 자동 허용 / 자동 거부 / 승인 카드로 나뉜다.
5. 쓰기 직전 원본을 스냅샷해 두어 실제 diff를 보여주고 되돌릴 수 있다.
6. 명령 실행은 CLI 샌드박스 안에서 이뤄지고, 앱은 그 앞단의 승인 계층이다.

## 화면 기능

- **모델 선택**: 헤더 드롭다운. 목록은 `initialize` 응답에서 받아온다. 바꾸면 에이전트를 `-m`으로 다시 띄우고 `session/load`로 대화를 그대로 이어간다.
- **사용량**: 한도에 도달해 API가 실제 수치를 알려준 뒤에는 잔여 토큰과 게이지를, 그 전에는 이번 세션 턴 수와 컨텍스트 크기를 표시한다. xAI에 남은 사용량 조회 API가 없어 추정치는 만들지 않는다.
- **테마**: 시스템 다크/라이트를 그대로 따라간다. 네이티브 창 배경도 함께 전환된다.
- **메뉴 바**: macOS 상단 바에 아이콘이 상주하며 상태와 승인 대기 건수를 보여주고, 창 열기·실행 중단·종료를 제공한다. 승인 대기 시 Dock 배지도 함께 뜬다.
- **이전 대화**: 세션 목록에서 재개하면 화면 기록과 에이전트 컨텍스트가 함께 복원된다. 첫 요청 문장이 세션 제목이 된다.
- **입력**: `Enter` 전송, `Shift+Enter` 줄바꿈, `⌘Enter` 대기열 추가(실행 중). 한글 조합 중의 Enter는 전송하지 않는다.

작업 모드:

- **Ask** — 읽기 전용. 질문에 답한다.
- **Plan** — 변경 없이 계획만 제시한다.
- **Agent** — 승인을 받아 파일을 수정하고 명령을 실행한다.

## 데이터 저장 위치

대화의 정본은 Grok Build CLI가 쓰는 `~/.grok/sessions/<작업폴더>/<세션id>/updates.jsonl` 이다. 앱은 인덱스를 만들고, 승인·파일변경처럼 CLI 로그에 없는 이벤트만 오버레이로 덧붙인다.

- CLI 대화 정본: `~/.grok/sessions/` (`GROK_HOME`으로 위치 변경 가능)
- 세션·작업공간·승인 이력: `~/Library/Application Support/Grok Desktop/metadata.json` (0600)
- 대화 UI 캐시(폴백): `~/Library/Application Support/Grok Desktop/sessions/<세션id>.json`
- 앱 전용 오버레이: `~/Library/Application Support/Grok Desktop/overlays/<세션id>.jsonl`
- 진단 로그: `~/Library/Application Support/Grok Desktop/logs/grok-desktop.log`

인증 토큰은 앱이 저장하지 않는다. xAI 인증은 Grok CLI가 관리한다.

## 보안

자세한 내용은 [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md). 요약:

- renderer에 Node·파일시스템·토큰 접근이 없다.
- 모든 IPC 입력은 채널별 Zod 스키마로 검증하고 sender를 확인한다.
- 홈 디렉터리 전체, 시스템 디렉터리, 자격 증명 폴더는 작업공간으로 열 수 없다.
- 작업공간 밖 경로 접근은 프로필과 무관하게 거부된다(심볼릭 링크 경유 포함).
- 삭제·설치·`git push`·네트워크·권한 변경 명령은 세션 허용을 무시하고 매번 승인받는다.
- UI·로그로 나가는 문자열은 비밀 패턴이 마스킹된다.

## 현재 상태

Phase 1–5와 Phase 6의 세션 재개·오류 복구까지 구현했다. 남은 작업은 접근성·성능 다듬기와 서명·공증 배포(Phase 7)이며 [docs/RELEASE_CHECKLIST.md](docs/RELEASE_CHECKLIST.md)에 정리되어 있다.

앱 내 문구와 `docs/` 문서는 한국어로 작성되어 있다.

## 라이선스

라이선스를 부여하지 않습니다(All rights reserved). 소스는 열람·검토 목적으로 공개하며,
복제·수정·재배포·상업적 이용을 허용하지 않습니다. 사용 문의는 저장소 이슈로 남겨 주세요.

이 앱은 별도로 설치한 Grok Build CLI를 실행할 뿐, CLI나 xAI 서비스를 재배포하지 않습니다.
CLI와 xAI 서비스 이용은 각자의 약관을 따릅니다.
