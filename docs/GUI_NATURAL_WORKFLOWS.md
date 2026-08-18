# GUI로 자연스럽게 쓰는 방법과 구현 계획

- 작성일: 2026-08-14
- 대상: Grok Desktop `0.1.0`
- 비교 대상: Claude Code Desktop (Code 탭), Codex (ChatGPT desktop app의 Codex 모드)
- 제약: grok.com WebView 금지, 공식 Grok Build CLI + ACP만, 비공개 API·토큰 저장 금지, 작업공간 봉쇄 유지

이 문서는 두 데스크톱이 **터미널 대신 GUI에서 하는 일**을 전부 정리하고, 같은 일을 Grok Desktop에서 어떻게 구현할지 계획한다.

---

## 0. 원칙

Claude/Codex 데스크톱이 편한 이유는 채팅창이 예뻐서가 아니다. 아래 일을 **창을 나가지 않고** 하기 때문이다.

1. 무엇이 바뀌었는지 본다.
2. 특정 줄에 의견을 달고 고치게 한다.
3. 여러 작업을 동시에 돌리되 파일이 섞이지 않게 한다.
4. 에이전트·백그라운드·승인을 한 화면에서 본다.
5. 결과물(파일, 미리보기, 터미널)을 같은 레이아웃에서 연다.
6. 자율 수준을 모드로 바꾼다.
7. 본 대화를 흐트리지 않고 옆에서 질문한다.

구현 원칙:

- **CLI가 엔진, 앱이 조종석.** `updates.jsonl`·워크트리·권한·세션은 CLI 정본을 읽거나 공식 ACP/`x.ai/*`만 호출한다.
- **GUI는 새 에이전트 루프를 만들지 않는다.** 이미 있는 도구를 보이게 만든다.
- **한 번에 전부 복제하지 않는다.** 사용자가 매일 손으로 하던 일부터 깐다.
- **없으면 만들지 않는다.** 클라우드 세션, Computer Use, iOS 시뮬레이터, grok.com 동기화는 비목표.

Grok CLI가 이미 열어 둔 공식 표면 (`15-agent-mode.md`):

| 카테고리 | 메서드 접두사 | GUI로 올릴 일 |
|---|---|---|
| Git | `x.ai/git/*` | status, stage, commit, diffs, discard |
| Worktree | `x.ai/git/worktree/*` | create, apply, list, remove, gc |
| Terminal | `x.ai/terminal/*` | 세션 cwd 터미널 |
| Session | `x.ai/session/fork`, rewind, compact | 분기·되돌리기·압축 |
| 알림 | `x.ai/session_notification` | diff review, retry, auto-compact |

`initialize` 응답에 없는 메서드는 호출하지 않는다. 구현 전에 실제 CLI로 존재 여부를 한 번 더 확인한다.

---

## 1. 두 데스크톱이 GUI로 하는 일 (전부)

### 1.1 레이아웃

| 하는 일 | Claude Code Desktop | Codex Desktop | 지금 Grok Desktop |
|---|---|---|---|
| 채팅 + 사이드바 | 세션 목록, 프로젝트/상태 필터 | 프로젝트·스레드 목록, 핀 | 대화/파일/변경 탭. 세션은 한 줄 |
| 패널 배치 | 채팅·diff·브라우저·터미널·파일·계획·작업·서브에이전트를 드래그 | 채팅 + 리뷰 패널 + 아티팩트 | 고정 3열. 드래그 없음 |
| 두 세션 나란히 | Cmd-클릭으로 분할 | 여러 스레드 전환 | 불가. 새 세션이 이전 ACP를 파킹 |
| 보기 밀도 | Normal / Verbose / Summary | 접기·펼치기 | 생각 접기만 |
| 단축키 오버레이 | Cmd+/ | 앱 단축키 | 일부만 (⌘N, ⌘,, ⌘., ⌘K) |

### 1.2 리뷰와 배송

| 하는 일 | Claude | Codex | 지금 |
|---|---|---|---|
| 변경 통계 클릭 → 파일별 diff | `+12 -1`로 패널 오픈 | Unstaged/Staged/Commit/Branch/Last turn | 변경 탭 + 우측 패널. 범위 전환 없음 |
| 줄에 댓글 → 에이전트가 수정 | Cmd+Enter로 일괄 제출 | 줄 + 버튼, 채팅으로 전송 | 없음 |
| 에이전트 자체 리뷰 | Review code | `/review` (브랜치/미커밋) | 없음 |
| hunk/파일 stage·revert | 제한적 | 파일·hunk·전체 | 앱 스냅샷 파일만 되돌리기. Git hunk 없음 |
| commit / push / PR | CI 상태바, auto-fix, auto-merge (`gh`) | 헤더에서 commit·push·PR | 없음 |
| PR 댓글 흡수 | CI 폴링 | `gh`로 PR 컨텍스트 | 없음 |

### 1.3 병렬과 격리

| 하는 일 | Claude | Codex | 지금 |
|---|---|---|---|
| 세션마다 워크트리 | 새 세션 = 자동 worktree | 채팅 시작 시 Local / Worktree 선택 | 같은 cwd 하나. 병렬 ACP 없음 |
| Handoff (로컬 ↔ 워크트리) | archive / apply에 가까움 | Handoff가 Git 이동을 처리 | 없음 |
| 사이드 채팅 | Cmd+; / `/btw`, 디스크에 안 남음 | side chat | 없음 |
| 작업 패널 | 서브에이전트·백그라운드 셸 | 스레드 상태 | 도구 카드만. 서브에이전트 숨김 |
| 다른 세션에 메시지 | 세션 간 카드 | 제한적 | 없음 |
| 알림 | 다른 세션 끝나면 OS 알림 | 알림 | 트레이 상태만 |

### 1.4 파일·미리보기·터미널

| 하는 일 | Claude | Codex | 지금 |
|---|---|---|---|
| 경로 클릭 → 파일 열기 | 파일 패널에서 편집·저장 | 기본 에디터로 열기 | 미리보기(읽기)만 |
| 우클릭 | 첨부, IDE로 열기, Finder | 에디터로 열기 | 없음 |
| HTML/PDF/이미지/영상 | Browser 패널 | 아티팩트 뷰어 | 이미지는 도구 카드. PDF 없음 |
| 로컬 개발 서버 미리보기 | Browser + auto-verify | 액션으로 서버 실행 | 없음 |
| 통합 터미널 | Ctrl+`, 세션 cwd | 통합 터미널 + 프로젝트 액션 | 없음 |
| @파일 / 드래그 첨부 | 있음 | 있음 | 있음 |

### 1.5 모드와 계획

| 하는 일 | Claude | Codex | 지금 |
|---|---|---|---|
| 권한 모드 | Manual / Accept edits / Plan / Auto / Bypass | 샌드박스 + 승인 프로필 | Ask / Plan / Agent (앱 프로필 read-only/ask/trusted) |
| 계획 패널 | 별도 pane, 승인 후 실행 | Plan mode | 채팅 안 plan 카드만 |
| 실행 중 끼어들기 | 중단 없이 다음 메시지 | queued / steer | 대기열은 있음. 현재 턴에 즉시 조향은 약함 |
| rewind / fork / compact | `/compact` | 세션 조작 | 슬래시를 프롬프트로 보낼 뿐 |

### 1.6 확장

| 하는 일 | Claude | Codex | 지금 |
|---|---|---|---|
| MCP/커넥터 GUI | + → Connectors | Plugins / MCP | 없음. `~/.grok/config.toml` |
| 스킬·플러그인 | + → Skills / Plugins | Skills & Plugins | `/` 일부 + 칩 |
| 스케줄 | Scheduled tasks | Automations | 없음 |
| 원격/클라우드/SSH | Cloud, SSH, WSL | Remote, Cloud | 비목표 |
| Computer Use / 시뮬레이터 | 있음 (옵트인) | 있음 | 비목표 |

---

## 2. “자연스럽다”의 정의 (복제하지 말 것)

복제하면 안 되는 것: Cowork 탭, Dispatch, Computer Use, iOS 시뮬레이터, 클라우드 세션, Claude-in-Chrome, Codex Pets, grok.com Chat 탭.

반드시 같아야 하는 감각:

1. **변경이 보이면 바로 리뷰한다.** 채팅을 스크롤해 도구 카드를 찾지 않는다.
2. **줄 단위로 말한다.** “저 함수 다시”가 아니라 그 줄에 댓글을 단다.
3. **새 대화 = 새 작업 공간.** 같은 파일을 두 에이전트가 동시에 고치지 않는다.
4. **한 화면이 관제소다.** 누가 돌고, 누가 승인을 기다리는지 사이드바에 보인다.
5. **결과는 옆에서 연다.** 에디터·브라우저·터미널로 나가지 않아도 확인한다.

---

## 3. 지금 막히는 구조

코드를 기준으로 한 병목.

1. **ACP 프로세스 1개.** `SessionManager.#parkAll()` 때문에 세션을 바꾸면 이전 연결이 끊긴다. 병렬·대시보드·백그라운드가 불가능하다.
2. **Diff가 스냅샷 중심.** `fs/write_text_file`로 앱이 쓴 파일만 되돌릴 수 있다. CLI가 직접 쓴 파일·Git hunk·브랜치 diff가 없다.
3. **댓글 채널이 없다.** 줄 피드백을 `session/prompt`로 보내는 형식이 없다.
4. **워크트리 cwd를 세션에 묶지 않는다.** CLI는 `x.ai/git/worktree/*`와 `grok -w`가 있다.
5. **서브에이전트·백그라운드를 버린다.** jsonl의 `subagent_*`, `task_*`를 리플레이하지 않는다.
6. **레이아웃이 고정이다.** 채팅이 항상 가운데, diff는 오버레이에 가깝다.
7. **권한 모드가 CLI와 어긋난다.** 앱 Ask/Plan/Agent vs CLI ask/acceptEdits/auto/always-approve.

---

## 4. 구현 계획

공통 규칙: 각 단계는 공식 표면이 있을 때만 한다. 없으면 그 단계는 건너뛰고 문서에 이유를 남긴다.

### 4.1 0단계 — 능력 탐침 (1~2일)

`initialize`와 실제 stdio에서 확인한다.

- `x.ai/git/{status,diffs,stage,commit,discard}`
- `x.ai/git/worktree/{create,list,apply,remove,gc}`
- `x.ai/terminal/*`
- `x.ai/session/fork`, rewind, compact
- `x.ai/session_notification` 페이로드
- `session/new`의 `_meta` (permissionMode, worktree, yoloMode)

산출: `docs/ACP_PROTOCOL_NOTES.md`에 “확인됨 / 없음 / 인자 모양” 표.

병렬 ACP가 안전한지(프로세스 그룹, 고아 정리, 승인 카드 세션 id)도 여기서 설계한다.

### 4.2 A단계 — 리뷰가 기본 동작이 되게 (핵심)

목표: Claude/Codex처럼 **통계를 누르면 리뷰 패널**이 열린다.

화면:

- 헤더 `+12 −3` → 우측(또는 하단) Review 패널 고정
- 파일 목록 + 선택된 파일 unified/split diff
- 범위: **이번 턴 / 워크트리 전체 / staged / 브랜치(main…HEAD)**
- 줄 호버 → 댓글. 여러 개를 모아 「댓글 반영」
- 파일·hunk **되돌리기** (Git checkout / `x.ai/git/discard`). 앱 스냅샷이 있으면 그걸 우선

구현:

- `git diff` / `git diff --cached` / `git diff main...HEAD`는 이미 `diff.ts` 근처에 둘 수 있다. 공식 `x.ai/git/diffs`가 있으면 그걸 쓰고, 없으면 작업공간 안 `git`만 호출 (경로 봉쇄 유지).
- 댓글은 새 프롬프트로 보낸다. 예: `다음 리뷰 댓글을 반영하라.` + `path:line: text`. 별도 API 없음.
- 「리뷰해줘」는 `/review`를 에이전트에 보내는 로컬 명령. 결과는 채팅 + 패널 인라인 표시.

완료 기준: 에이전트가 파일을 고치면 채팅을 안 읽고도 패널에서 보고, 한 줄에 달아 고치게 할 수 있다.

### 4.3 B단계 — 관제소 (병렬 세션)

목표: 사이드바가 Claude/Codex처럼 **여러 작업의 상태판**이 된다.

화면:

- 각 행: 제목, 상태(실행/승인대기/유휴), 미리보기, live 점
- 필터: 실행 중 / 승인 대기 / 이 폴더
- 실행 중이 아닌 세션을 열어도 **다른 세션의 ACP를 죽이지 않음**
- 다른 세션이 끝나면 OS 알림 (이미 트레이가 있으면 재사용)
- 승인 대기는 Dock/트레이 배지 (일부 있음)

구현:

- `#parkAll()` 제거. 상한(처음 3~4개 라이브) + 유휴 세션만 파킹.
- 라이브 맵을 `sessionId → GrokAgentConnection`으로 유지. 고아 PID 레지스트리는 그대로.
- 렌더러는 활성 트랜스크립트 하나만 그리고, 백그라운드 세션은 이벤트만 배지/목록에 반영.
- CLI 대시보드와 같은 정보를 jsonl/`session_kind`로 보여 주되, 서브에이전트는 부모 아래 접기.

완료 기준: 세션 A가 테스트 도는 동안 세션 B에 질문할 수 있다. A의 승인 카드는 A로 돌아가면 그대로다.

### 4.4 C단계 — 워크트리 격리

목표: **새 대화 = 선택적으로 새 워크트리.** 파일이 안 섞인다.

화면:

- 새 대화 시 Local / Worktree (기본은 설정, CLI `new_session_worktree_mode`와 맞춤)
- 세션 행에 워크트리 라벨, 경로
- **적용(Apply)**: 워크트리 변경을 메인 작업 폴더로 (`x.ai/git/worktree/apply` 또는 명시적 merge)
- **제거**: `remove` + `grok worktree gc` 안내
- Codex Handoff의 완전 복제는 하지 않는다. Apply/Remove면 충분하다.

구현:

- `session/new` cwd를 워크트리 경로로 둔다. 워크트리는 분류된 작업공간과 같게 봉쇄한다 (심볼릭 링크, 홈 탈출 금지).
- 생성은 `x.ai/git/worktree/create`가 있으면 그것, 없으면 사용자 확인 후 `git worktree add` (앱이 임의 경로에 쓰지 않음. `~/.grok/worktrees` 또는 설정 경로만).
- `.worktreeinclude`는 CLI가 지원하면 CLI에 맡긴다.

완료 기준: 같은 레포에서 두 세션이 서로 다른 파일을 고치고, Apply 한 쪽만 메인에 합쳐진다.

### 4.5 D단계 — 계획·조향·대화 조작

목표: Plan이 채팅 카드가 아니라 **승인 가능한 패널**이 된다.

화면:

- Plan 모드: 읽기 전용 + `plan.md`만 허용 (CLI plan mode와 동일)
- 계획 패널: 항목, 상태, 「이 계획으로 진행」/「수정」
- 보기: 보통 / 자세히(도구 전부) / 요약(답변+변경만)
- Rewind: `rewind_points.jsonl` 또는 `x.ai` rewind. 턴 목록에서 고르면 대화만 자름 (파일은 그대로 — CLI와 동일)
- Fork: `x.ai/session/fork` 또는 `/fork`를 에이전트에 위임. 사이드바에 자식으로 표시
- Compact: 진행 알림을 리플레이에 표시

완료 기준: 큰 작업을 Plan에서 보고 Agent로 실행할 수 있다. 잘못 보낸 턴은 Rewind로 되돌린다.

### 4.6 E단계 — 파일과 산출물

목표: 경로를 누르면 **옆에서 읽고, 작은 수정은 저장**한다.

화면:

- 채팅/diff의 경로 클릭 → 파일 패널 (텍스트 편집, 2MB 한도, 민감 파일은 열기 전 확인)
- 우클릭: 첨부, 기본 앱으로 열기, Finder
- HTML/이미지/PDF: 작업공간 안 파일만 미리보기. 외부 URL은 기존 허용 목록 셸
- 저장은 `fs.write`와 같은 봉쇄·민감 검사를 탄다

완료 기준: README 오타를 파일 패널에서 고치고 저장할 수 있다. `.env`는 경고 없이 안 열린다.

### 4.7 F단계 — 터미널과 로컬 미리보기

목표: 테스트·데브 서버를 **같은 창**에서 본다.

터미널:

- 공식 `x.ai/terminal/*`가 있으면 그걸 그린다 (cwd = 세션 워크스페이스).
- 없으면 Electron PTY는 **나중**으로 미룬다. 앱이 임의 셸을 열면 승인 계층을 우회하기 쉽다. 우선순위는 CLI 터미널.

미리보기:

- `localhost` / `127.0.0.1`만 허용하는 작은 Browser 패널
- 사용자가 연 뒤에만 로드. 에이전트가 임의 사이트를 열지 못함
- auto-verify(스크린샷·DOM 클릭)는 Computer Use에 가깝다. **하지 않는다.** 사용자가 보고 채팅으로 말한다.

완료 기준: `npm test` 출력을 터미널 패널에서 보고, 로컬 3000 포트를 직접 연다.

### 4.8 G단계 — Git 배송

목표: 리뷰 후 **커밋·푸시·PR**을 창 안에서 한다.

- stage/unstage/discard: `x.ai/git/*` 또는 봉쇄된 `git`
- commit 메시지 상자. `git commit`은 항상 승인 (서명·훅 위험)
- push / `gh pr create`는 매번 승인. auto-merge는 하지 않음
- CI 폴링·auto-fix는 `gh`가 있을 때만 선택. 없어도 A~F는 동작

### 4.9 H단계 — 설정 GUI (읽기 위주)

- MCP: `~/.grok/config.toml`의 서버 목록 표시, 사용/중지 (파일 쓰기 0600, 값 검증)
- 스킬: `~/.grok/skills`, `.grok/skills` 목록. 설치 마법사는 공식 절차가 있을 때만
- 샌드박스: `off/workspace/read-only/strict`를 세션 시작 인자로 (`grok --sandbox`, 문서화된 플래그)
- 권한 모드를 CLI 이름에 맞춘다: Ask / Accept edits / Plan / Agent(auto 아님)

토큰·커넥터 OAuth는 앱이 받지 않는다. CLI/브라우저 로그인만.

### 4.10 하지 않는 것

- grok.com / ChatGPT 웹 동기화
- Computer Use, 화면 제어, iOS 시뮬레이터
- 클라우드·SSH·WSL 세션
- 외부 사이트 자동 브라우징, auto-verify
- 무제한 Always Approve를 기본값으로
- 앱이 CLI를 대신 설치·업데이트
- `updates.jsonl`을 앱이 쓰기
- 세션 간 자동 아카이브 정책의  prescriptive 복제 (원하면 이후)

---

## 5. 화면 뼈대 (A~C 이후)

```text
┌ 사이드바 ──────────┬ 채팅 ──────────────┬ 보조 패널 ─────────┐
│ 검색               │ 헤더: 모델 모드    │ [Review|파일|계획│
│ ● 고치는 중  승인1 │        +12 −3  워크트리 │  터미널|미리보기] │
│ ○ 계획만           │ 트랜스크립트       │ 파일 목록 / diff  │
│ ● 테스트 도는 중   │ (보통/자세히/요약) │ 줄 댓글           │
│ + 새 대화 ▾로컬/WT │ 입력 @ / 칩        │                   │
└────────────────────┴────────────────────┴───────────────────┘
```

보조 패널은 처음엔 탭이면 된다. 드래그 도킹은 C 이후 여유 있을 때.

단축키 (Claude와 맞추되 macOS):

| 키 | 동작 |
|---|---|
| ⌘N | 새 대화 (두 번이면 워크트리 확인) |
| ⌘⇧D | 리뷰 패널 |
| ⌘⇧F | 파일 패널 |
| ⌃\` | 터미널 (F단계) |
| ⌘; | 사이드 채팅 (D단계) |
| ⌃Tab | 다음 라이브 세션 |
| Esc | 실행 중단 |

---

## 6. 권한·보안

- 워크트리 경로도 `resolveWithinRoot`와 같은 봉쇄. `~/.grok/worktrees`는 예외 허용 목록이 아니라 **선택한 레포의 worktree만** 연다.
- Git 쓰기는 프로필과 무관하게 push/force/reset --hard는 매번 승인.
- 터미널 패널이 생겨도 에이전트 명령은 기존 승인 엔진을 탄다. 사용자 타이핑은 사용자 책임. 민감 경로 자동 완성만 막는다.
- 미리보기는 localhost + 작업공간 파일만.
- 여러 ACP는 세션별 grant Set을 섞지 않는다.

---

## 7. 일정 제안

| 단계 | 사용자에게 열리는 감각 | 의존 |
|---|---|---|
| 0 탐침 | — | — |
| **A 리뷰** | 데스크톱을 쓰는 이유 | git 또는 `x.ai/git/diffs` |
| **B 관제소** | 여러 일을 맡김 | parkAll 제거 |
| **C 워크트리** | 안 심고 병렬 | B + worktree API/git |
| D 계획·rewind | 큰 작업이 안전 | A, 세션 정본 |
| E 파일 패널 | 창을 안 나감 | 경로 클릭 |
| F 터미널·미리보기 | 확인이 빠름 | 0단계 터미널 |
| G Git 배송 | 여기서 끝냄 | A |
| H 설정 GUI | TUI 설정 안 열음 | config.toml |

A → B → C가 제품의 핵심이다. D~H는 그 위에 얹는다.

테스트:

- A: 가짜 레포에서 턴 후 패널 범위, 댓글이 다음 prompt에 들어감
- B: 세션 2개 동시 prompt, 한쪽 cancel이 다른쪽을 안 죽임
- C: 두 워크트리 파일이 서로 안 보임, Apply 후 메인에만 합쳐짐
- 기존 승인 e2e·경로 봉쇄는 매 단계 유지

---

## 8. 현재 상태와의 연결

이미 있는 것: 세션 목록, jsonl 정본, 승인 카드, 기본 diff, 파일 트리, @언급, Ask/Plan/Agent, 트레이.

없는 것 중 **매일 쓰는 GUI 감각**에 해당하는 것: 리뷰 패널, 줄 댓글, 병렬 ACP, 워크트리, 계획 승인, 파일 편집, 터미널, localhost 미리보기, Git 배송.

잔여 목록은 [UNIMPLEMENTED.md](UNIMPLEMENTED.md). 이 문서가 “무엇을 왜 어떤 순서로”이고, 저 문서는 “아직 코드에 없는 것”이다.
