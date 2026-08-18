import { useStore } from '../store.js';

const ROWS = [
  ['Enter', '전송'],
  ['Shift+Enter', '줄바꿈'],
  ['⌘+Enter', '실행 중이면 대기열에 추가'],
  ['/', '슬래시 명령'],
  ['@파일', '작업공간 파일 첨부'],
  ['스크린샷 붙여넣기', '입력창에 이미지를 붙여 첨부'],
  ['⌘N', '새 대화'],
  ['⌘K', '대화 목록 검색'],
  ['⌘F', '이 대화에서 찾기'],
  ['⌘P', '파일 빠른 열기 (최근·변경 파일)'],
  ['미리보기 트리', '사이드바 파일 트리에서 위치 표시'],
  ['@', '최근 파일부터 첨부'],
  ['⌘⇧P', '명령 팔레트'],
  ['⌘1–4', '대화 · 파일 · 변경 · 작업 탭'],
  ['⌘⇧F', '사이드바 파일 검색'],
  ['파일 우클릭', '미리보기 · 열기 · 폴더 · 경로 복사 · 첨부'],
  ['대화 우클릭', '고정 · 이름 변경 · 옆에 열기 · 분기 · 삭제'],
  ['j / k', '사이드바 대화 이동, 리뷰에서 다음·이전 파일'],
  ['⌘⇧P 대화 이름', '명령 팔레트에서 대화로 이동'],
  ['⌘;', '옆 질문 (본 작업을 끊지 않음)'],
  ['⌘클릭 대화', '옆에 나란히 열기'],
  ['⌘⇧D', '리뷰 패널 열기/닫기'],
  ['⌘S', '파일 미리보기 저장'],
  ['⌥↑ / ⌥↓', '채팅에 포커스한 뒤 이전·다음 질문/답변으로 이동'],
  ['Ctrl+Tab', '다음 대화'],
  ['Y / S / N / ⌘Enter', '승인 대기 중 한 번 허용 · 세션 허용 · 거부 · ⌘Enter 한 번 허용'],
  ['⌘W', '리뷰·미리보기·이미지·분할 닫기'],
  ['이미지 클릭', '생성 이미지 크게 보기'],
  ['대기열 ▶ / ↑', '지금 보내기 · 맨 앞으로'],
  ['Esc', '패널 닫기, 승인 대기는 거부, 실행 중이면 중단'],
  ['대화 ‖', '다른 대화를 옆에 열기'],
  ['⌘.', '단축키'],
  ['⌘,', '설정'],
];

export function ShortcutsPanel(): React.JSX.Element | null {
  const open = useStore((state) => state.shortcutsOpen);
  const setShortcutsOpen = useStore((state) => state.setShortcutsOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setShortcutsOpen(false)}>
      <section className="modal" role="dialog" aria-labelledby="shortcuts-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="shortcuts-title">단축키와 명령</h2>
          <button type="button" className="link" onClick={() => setShortcutsOpen(false)}>
            닫기
          </button>
        </header>
        <table className="shortcut-table">
          <tbody>
            {ROWS.map(([key, meaning]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          `/imagine`, `/deep-research`, `/compact` 같은 Grok Build 명령은 에이전트로 그대로 전달됩니다.
        </p>
      </section>
    </div>
  );
}
