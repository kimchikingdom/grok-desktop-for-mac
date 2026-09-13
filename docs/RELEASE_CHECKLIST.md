# 릴리스 체크리스트

Phase 7(배포)에서 사용한다. Phase 1–5 구현 시점에는 서명·공증 항목이 미완료 상태다.

## 1. 릴리스 전 검증

- [x] `pnpm install --frozen-lockfile`
- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test` — 173개
- [x] `pnpm test:security` — 28개
- [x] `pnpm test:e2e` — 17개
- [x] `pnpm build` 후 `apps/desktop/out/{main,preload,renderer}` 생성 확인
- [x] CLI 기본 설정(`permission_mode = "ask"`)에서 명령 승인 재확인 — 2026-09-13. `node -e` 실행에 대해 「위험도 높음」 승인 카드가 뜨고(이유·작업 디렉터리·Y/N 포함), 허용하면 실행됐다. 확인 뒤 사용자의 원래 설정을 되돌렸다
- [x] 실제 Grok CLI로 수동 수직 흐름 1회: 폴더 열기 → 질문 → 파일 읽기 → 수정 승인 → diff 확인 → 테스트 명령 승인 → 결과 확인 → 중단 → 재시작 — 2026-09-12, CLI 1.0.30 / grok-4.6 으로 완주. 승인 카드에 +1 −1 미리보기가 뜨고 승인 후 디스크에 반영됐다. 명령 실행만 승인 카드를 거치지 않았는데, 이 기계의 CLI 설정(`permission_mode = "always-approve"`) 때문이다. [SECURITY_MODEL.md](SECURITY_MODEL.md) 7절 참고. 기본 설정에서의 재확인은 위 항목에서 끝냈다
- [x] 모든 버튼 상호작용 점검 (사이드바·헤더·채팅·입력창·리뷰·오버레이) — 2026-09-12, 15개 화면 지적 0건. 결과는 [UNIMPLEMENTED.md](UNIMPLEMENTED.md) 「끝낸 점검」
- [x] 사용량 표시 — `grok usage <세션ID>` 가 세션·턴 단위 토큰을 기록해 두므로 그 값을 헤더에 보여 준다. 구독 잔여는 여전히 429 본문에서만 오고, 그 전까지 게이지는 비어 있다 (추정치를 만들지 않는다). [UNIMPLEMENTED.md](UNIMPLEMENTED.md) 「끝낸 점검」

## 2. 보안 확인

- [x] renderer에서 `require`, `process`, `module`, `window.ipcRenderer` 가 모두 `undefined` — 개발 모드와 패키징본 양쪽에서 확인. `global`·`Buffer`도 없고 `window.grokDesktop`은 동결된 6개 네임스페이스뿐
- [x] CSP 응답 헤더가 실제로 적용됨 (`default-src 'none'`) — 개발 서버(http)와 **패키징본(`file://`) 양쪽에서** 외부 fetch·img가 실제로 막히고 `connect-src`·`img-src` 위반 이벤트가 발생
- [x] 작업공간 밖 경로 요청이 차단되고 보안 로그에 남음 — `../../../../etc/passwd`, 절대경로, 인코딩 우회, 중간 `..` 4종 모두 거부되고 `[security]`로 기록
- [x] 진단 로그(`userData/logs/grok-desktop.log`)에 토큰·키가 남지 않음 — 423줄 전수 검사에서 비밀 패턴 0건
- [x] `metadata.json` 권한이 0600 — `logs/`(0700)와 로그 파일(0600)도 함께 확인. 기존 로그 파일이 0644로 남던 문제를 고쳤다
- [x] 앱 종료 후 `grok` 자식 프로세스가 남지 않음 (`pgrep -f "agent stdio"`) — `agent-pids.json`도 비어 있음
- [x] 허용 목록 외 URL이 열리지 않음 — `file:`, `javascript:`, http, 허용 호스트 스푸핑(`x.ai.evil.com`), 자격 증명 포함 URL 모두 거부

## 3. macOS 패키징

- [x] 자체 제작 앱 아이콘 준비 (`build/icon.icns` 10종·최대 1024 / `build/icon.ico` 7프레임·256 포함). 자체 제작 `src/renderer/assets/app-icon.svg`에서 변환했다. 타사 로고는 쓰지 않았다.
- [ ] `CSC_LINK` / `CSC_KEY_PASSWORD` 로 Developer ID Application 인증서 주입
- [x] `hardenedRuntime: true` 유지, `entitlements.mac.plist` 검토 — 설정은 그대로. 서명이 없으면 entitlement 는 실제로 적용되지 않는다
- [x] `pnpm package:mac` — arm64·x64 DMG 생성 확인 (각 ~120MB). 번들 아이콘이 `build/icon.icns` 와 바이트 동일, `CFBundleIdentifier=io.github.kimchikingdom.grokdesktop`, `CFBundleName=Grok Desktop`
- [ ] `codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Grok Desktop.app"` — 지금은 실패한다 (`code has no resources but signature indicates they must be present`). 유효한 Developer ID 인증서가 없어 electron-builder 가 서명을 건너뛴다
- [ ] `xcrun notarytool submit --wait` 후 `xcrun stapler staple`
- [ ] `spctl --assess --type execute` 통과 — 미서명이라 현재 거부됨. 인증서 이후 재확인
- [ ] 깨끗한 사용자 계정에서 DMG 설치 → 실행 → 폴더 열기까지 확인

## 4. Windows 패키징 (이후)

- [x] `pnpm package:win` — NSIS 설치본 `Grok Desktop Setup 0.1.0.exe`(약 96MB) 와 `win-unpacked/Grok Desktop.exe`(PE32+ x86-64) 생성 확인. macOS 에서 wine 없이 빌드된다. 루트에 `package:win` 스크립트가 없어 함께 추가했다
- [ ] 서명 인증서 적용 — 인증서가 없어 electron-builder 의 signtool 단계가 실질적으로 건너뛰어진다
- [ ] 설치/제거 후 잔여 파일 확인

## 5. 문서

- [x] README의 요구사항(Node LTS, Grok CLI 설치 명령)이 최신인지 — `.nvmrc` 22.11.0, pnpm 11, 명령 표 모두 일치
- [x] 데이터 저장 위치 명시 — `productName` 을 넣어 개발·패키징본 모두 `~/Library/Application Support/Grok Desktop/` 을 쓴다. 예전 `@grok-desktop/desktop/` 폴더의 데이터는 첫 실행 때 옮겨 온다 (실제 앱에서 세션 17개 이전 확인)
- [x] 알려진 제한 사항 갱신 (`SECURITY_MODEL.md` 7절) — IPv6 루프백 미리보기, 상위 저장소 안의 작업공간, 핸들러 단위 봉쇄 테스트 부재를 추가
- [x] 지원하는 Grok CLI 버전 범위 기록 — ACP 프로토콜 1, 최소 버전 강제 없음, 1.0.3~1.0.30에서 확인 (README)

## 6. 배포 후

- [ ] 업데이트 서명 검증 경로 확인 (변조된 업데이트 거부)
- [ ] 크래시/오류 리포트 수집 경로 확인
- [ ] 롤백 절차 문서화
