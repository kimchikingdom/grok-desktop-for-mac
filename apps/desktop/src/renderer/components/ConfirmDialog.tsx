import { useEffect, useRef } from 'react';
import { useStore } from '../store.js';

export function ConfirmDialog(): React.JSX.Element | null {
  const confirm = useStore((state) => state.confirm);
  const answerConfirm = useStore((state) => state.answerConfirm);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!confirm) return;
    const node = dialogRef.current?.querySelector('button.primary');
    if (node instanceof HTMLButtonElement) node.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        answerConfirm(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm, answerConfirm]);

  if (!confirm) return null;

  return (
    <div className="modal-backdrop" onClick={() => answerConfirm(false)}>
      <section
        ref={dialogRef}
        className="modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="confirm-title">{confirm.title}</h2>
        </header>
        <p>{confirm.message}</p>
        <div className="actions">
          <button type="button" className="primary" onClick={() => answerConfirm(true)}>
            확인
          </button>
          <button type="button" onClick={() => answerConfirm(false)}>
            취소
          </button>
        </div>
      </section>
    </div>
  );
}
