import { useEffect, useRef, useState } from 'react';
import type { DiffScope } from '@grok-desktop/shared';
import { keepInView } from '../keep-in-view.js';
import { useStore } from '../store.js';
import { DiffStats, DiffView } from './DiffView.js';

function splitHunks(unified: string): { header: string; patch: string }[] {
  const lines = unified.split('\n');
  const preamble: string[] = [];
  const hunks: { header: string; patch: string }[] = [];
  let current: string[] = [];
  let header = '';
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current.length > 0) hunks.push({ header, patch: [...preamble, ...current].join('\n') + '\n' });
      header = line;
      current = [line];
    } else if (current.length > 0) current.push(line);
    else preamble.push(line);
  }
  if (current.length > 0) hunks.push({ header, patch: [...preamble, ...current].join('\n') + '\n' });
  return hunks;
}

const SCOPES: { id: NonNullable<DiffScope> | 'turn'; label: string }[] = [
  { id: 'turn', label: '이번 턴' },
  { id: 'working', label: '작업 트리' },
  { id: 'staged', label: '스테이징' },
  { id: 'branch', label: '브랜치' },
];

export function ReviewPanel(): React.JSX.Element {
  const session = useStore((state) => state.session);
  const changes = useStore((state) => state.changes);
  const activeDiff = useStore((state) => state.activeDiff);
  const reviewScope = useStore((state) => state.reviewScope);
  const reviewComments = useStore((state) => state.reviewComments);
  const setReviewScope = useStore((state) => state.setReviewScope);
  const showDiff = useStore((state) => state.showDiff);
  const revert = useStore((state) => state.revert);
  const addReviewComment = useStore((state) => state.addReviewComment);
  const submitReview = useStore((state) => state.submitReview);
  const closeDiff = useStore((state) => state.closeDiff);
  const listReviewFiles = useStore((state) => state.listReviewFiles);
  const commitChanges = useStore((state) => state.commitChanges);
  const pushChanges = useStore((state) => state.pushChanges);
  const createPullRequest = useStore((state) => state.createPullRequest);
  const stageAll = useStore((state) => state.stageAll);
  const revertAll = useStore((state) => state.revertAll);
  const [draft, setDraft] = useState('');
  const [targetLine, setTargetLine] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [prTitle, setPrTitle] = useState('');
  const fileListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    void listReviewFiles();
  }, [session?.id, listReviewFiles]);

  useEffect(() => {
    const list = fileListRef.current;
    keepInView(list, list?.querySelector('.tree-item.current'));
  }, [activeDiff?.relPath, changes]);

  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!session || changes.length === 0) return;
    const current = activeDiff?.relPath;
    if (current && changes.some((change) => change.relPath === current)) return;
    const first = changes.find((change) => change.status !== 'deleted') ?? changes[0];
    if (!first) return;
    const key = `${session.id}:${reviewScope}:${first.relPath}`;
    if (autoOpened.current === key) return;
    autoOpened.current = key;
    void showDiff(first.relPath, reviewScope);
  }, [activeDiff?.relPath, changes, reviewScope, session, showDiff]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'j' && event.key !== 'k') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const state = useStore.getState();
      if (!state.reviewOpen || state.fileSwitcherOpen || state.settingsOpen || state.confirm) return;
      const list = useStore.getState().changes;
      const current = useStore.getState().activeDiff?.relPath;
      const index = list.findIndex((change) => change.relPath === current);
      const next = event.key === 'j' ? index + 1 : index <= 0 ? 0 : index - 1;
      const file = list[next];
      if (file) {
        event.preventDefault();
        void showDiff(file.relPath, useStore.getState().reviewScope);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDiff]);

  if (!session) return <p className="muted small">세션이 없습니다.</p>;

  return (
    <section className="review-panel">
      <header className="review-toolbar">
        <strong>리뷰</strong>
        <div className="review-scopes" role="tablist" aria-label="디프 범위">
          {SCOPES.map((scope) => (
            <button
              key={scope.id}
              type="button"
              role="tab"
              className={reviewScope === scope.id ? 'active' : ''}
              aria-selected={reviewScope === scope.id}
              onClick={() => void setReviewScope(scope.id)}
            >
              {scope.label}
            </button>
          ))}
        </div>
        {changes.some((change) => change.status !== 'deleted') ? (
          <button type="button" className="link" onClick={() => void stageAll()}>
            모두 스테이징
          </button>
        ) : null}
        {changes.some((change) => change.revertable) ? (
          <button type="button" className="link" onClick={() => void revertAll()}>
            모두 되돌리기
          </button>
        ) : null}
        <button type="button" className="link" onClick={closeDiff}>
          닫기
        </button>
      </header>
      <div className="review-body">
        <ul className="review-files" ref={fileListRef}>
          {changes.length === 0 ? (
            <li className="muted small">이 범위에는 변경이 없습니다. 작업 트리·스테이징·브랜치를 바꿔 보세요.</li>
          ) : null}
          {changes.map((change) => (
            <li key={change.relPath}>
              <button
                type="button"
                className={`tree-item ${activeDiff?.relPath === change.relPath ? 'current' : ''}`}
                onClick={() => void showDiff(change.relPath, reviewScope)}
              >
                <span className={`status ${change.status}`}>{change.status[0]?.toUpperCase()}</span>
                <span className="session-title">{change.relPath}</span>
                <span className="diff-stats">
                  <span className="add">+{change.additions}</span>{' '}
                  <span className="del">−{change.deletions}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="review-diff">
          {activeDiff ? (
            <>
              <div className="review-file-head">
                <strong>{activeDiff.relPath}</strong>
                <DiffStats preview={activeDiff.preview} />
                <button
                  type="button"
                  className="link"
                  onClick={() => void useStore.getState().copyPath(activeDiff.relPath)}
                >
                  경로
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => void useStore.getState().previewFile(activeDiff.relPath)}
                >
                  미리보기
                </button>
                {(() => {
                  const index = changes.findIndex((change) => change.relPath === activeDiff.relPath);
                  return (
                    <span className="review-file-nav">
                      <button
                        type="button"
                        className="link"
                        disabled={index <= 0}
                        onClick={() => {
                          const prev = changes[index - 1];
                          if (prev) void showDiff(prev.relPath, reviewScope);
                        }}
                      >
                        이전
                      </button>
                      <button
                        type="button"
                        className="link"
                        disabled={index < 0 || index >= changes.length - 1}
                        onClick={() => {
                          const next = changes[index + 1];
                          if (next) void showDiff(next.relPath, reviewScope);
                        }}
                      >
                        다음
                      </button>
                    </span>
                  );
                })()}
                {activeDiff.revertable ? (
                  <button type="button" className="link" onClick={() => void revert(activeDiff.relPath)}>
                    되돌리기
                  </button>
                ) : null}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    if (!session) return;
                    void window.grokDesktop.changes
                      .act({ sessionId: session.id, relPath: activeDiff.relPath, action: 'stage' })
                      .then(() => listReviewFiles());
                  }}
                >
                  스테이징
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    if (!session) return;
                    void window.grokDesktop.changes
                      .act({ sessionId: session.id, relPath: activeDiff.relPath, action: 'unstage' })
                      .then(() => listReviewFiles());
                  }}
                >
                  스테이징 해제
                </button>
              </div>
              <DiffView
                preview={activeDiff.preview}
                view={activeDiff.view}
                onComment={(line) => {
                  setTargetLine(line);
                  setDraft('');
                }}
              />
              {splitHunks(activeDiff.preview.unifiedDiff).map((hunk) => (
                <div key={hunk.header} className="hunk-row">
                  <code className="muted small">{hunk.header}</code>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      void window.grokDesktop.changes
                        .act({
                          sessionId: session.id,
                          relPath: activeDiff.relPath,
                          action: 'stage-hunk',
                          hunk: hunk.patch,
                        })
                        .then(() => listReviewFiles());
                    }}
                  >
                    이 덩어리 스테이징
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      void window.grokDesktop.changes
                        .act({
                          sessionId: session.id,
                          relPath: activeDiff.relPath,
                          action: 'revert-hunk',
                          hunk: hunk.patch,
                        })
                        .then(() => listReviewFiles());
                    }}
                  >
                    이 덩어리 되돌리기
                  </button>
                </div>
              ))}
              {targetLine ? (
                <form
                  className="review-comment"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addReviewComment(activeDiff.relPath, targetLine, draft);
                    setDraft('');
                    setTargetLine(null);
                  }}
                >
                  <p className="muted small">{targetLine.slice(0, 120)}</p>
                  <textarea
                    value={draft}
                    rows={3}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="이 줄에 대한 의견 · ⌘Enter 추가"
                    aria-label="리뷰 댓글"
                    autoFocus
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        (event.currentTarget.form as HTMLFormElement | null)?.requestSubmit();
                      }
                    }}
                  />
                  <button type="submit" className="primary">
                    댓글 추가
                  </button>
                </form>
              ) : (
                <p className="muted small">줄을 클릭해 댓글을 답니다.</p>
              )}
            </>
          ) : (
            <p className="muted small">왼쪽에서 파일을 고르세요.</p>
          )}
        </div>
      </div>
      <footer className="review-footer">
        {reviewComments.length > 0 ? (
          <>
            <span>{reviewComments.length}개 댓글</span>
            <button type="button" className="primary" onClick={() => void submitReview()}>
              댓글 반영
            </button>
          </>
        ) : null}
        <input
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          placeholder="커밋 메시지"
          aria-label="커밋 메시지"
        />
        <button
          type="button"
          className="primary"
          disabled={!commitMessage.trim()}
          onClick={() => void commitChanges(commitMessage.trim())}
        >
          커밋
        </button>
        <button type="button" onClick={() => void pushChanges()}>
          푸시
        </button>
        <input
          value={prTitle}
          onChange={(event) => setPrTitle(event.target.value)}
          placeholder="PR 제목"
          aria-label="PR 제목"
        />
        <button type="button" disabled={!prTitle.trim()} onClick={() => void createPullRequest(prTitle.trim(), commitMessage)}>
          PR
        </button>
      </footer>
    </section>
  );
}
