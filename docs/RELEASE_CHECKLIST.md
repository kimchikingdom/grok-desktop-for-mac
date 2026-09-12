# 릴리스 체크리스트

Phase 7(배포)에서 사용한다. Phase 1–5 구현 시점에는 서명·공증 항목이 미완료 상태다.

## 1. 릴리스 전 검증

- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:security`
- [ ] `pnpm test:e2e`
- [ ] `pnpm build` 후 `apps/desktop/out/{main,preload,renderer}` 생성 확인
- [ ] 실제 Grok CLI로 수동 수직 흐름 1회: 폴더 열기 → 질문 → 파일 읽기 → 수정 승인 → diff 확인 → 테스트 명령 승인 → 결과 확인 → 중단 → 재시작
- [x] 모든 버튼 상호작용 점검 (사이드바·헤더·채팅·입력창·리뷰·오버레이) — 2026-09-12, 15개 화면 지적 0건. 결과는 [UNIMPLEMENTED.md](UNIMPLEMENTED.md) 「끝낸 점검」
- [ ] 남은 사용량 표시 (429 이전이라도 공식 값이 있으면 헤더에 잔여). 항목은 [UNIMPLEMENTED.md](UNIMPLEMENTED.md) 「다음에 할 것」

## 2. 보안 확인

- [ ] renderer에서 `require`, `process`, `module`, `window.ipcRenderer` 가 모두 `undefined`
- [ ] CSP 응답 헤더가 실제로 적용됨 (`default-src 'none'`)
- [ ] 작업공간 밖 경로 요청이 차단되고 보안 로그에 남음
- [ ] 진단 로그(`userData/logs/grok-desktop.log`)에 토큰·키가 남지 않음
- [ ] `metadata.json` 권한이 0600
- [ ] 앱 종료 후 `grok` 자식 프로세스가 남지 않음 (`pgrep -f "agent stdio"`)
- [ ] 허용 목록 외 URL이 열리지 않음

## 3. macOS 패키징

- [ ] 자체 제작 앱 아이콘 준비 (`build/icon.icns` / `icon.ico`). 타사 로고는 사용하지 않는다.
- [ ] `CSC_LINK` / `CSC_KEY_PASSWORD` 로 Developer ID Application 인증서 주입
- [ ] `hardenedRuntime: true` 유지, `entitlements.mac.plist` 검토
- [ ] `pnpm package:mac`
- [ ] `codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Grok Desktop.app"`
- [ ] `xcrun notarytool submit --wait` 후 `xcrun stapler staple`
- [ ] `spctl --assess --type execute` 통과
- [ ] 깨끗한 사용자 계정에서 DMG 설치 → 실행 → 폴더 열기까지 확인

## 4. Windows 패키징 (이후)

- [ ] `pnpm package:win`
- [ ] 서명 인증서 적용
- [ ] 설치/제거 후 잔여 파일 확인

## 5. 문서

- [ ] README의 요구사항(Node LTS, Grok CLI 설치 명령)이 최신인지
- [ ] 데이터 저장 위치 명시: `~/Library/Application Support/Grok Desktop/`
- [ ] 알려진 제한 사항 갱신 (`SECURITY_MODEL.md` 7절)
- [ ] 지원하는 Grok CLI 버전 범위 기록

## 6. 배포 후

- [ ] 업데이트 서명 검증 경로 확인 (변조된 업데이트 거부)
- [ ] 크래시/오류 리포트 수집 경로 확인
- [ ] 롤백 절차 문서화
