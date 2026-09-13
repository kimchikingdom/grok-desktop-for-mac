import { useEffect, useRef, useState } from 'react';
import { canFrameLocalhost } from '@grok-desktop/shared';
import { ChatStream } from './components/ChatStream.js';
import { Composer } from './components/Composer.js';
import { ReviewPanel } from './components/ReviewPanel.js';
import { ConfirmDialog } from './components/ConfirmDialog.js';
import { Header } from './components/Header.js';
import { Markdown } from './components/Markdown.js';
import { Onboarding } from './components/Onboarding.js';
import { QuickOpen } from './components/QuickOpen.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ShortcutsPanel } from './components/ShortcutsPanel.js';
import { Sidebar } from './components/Sidebar.js';
import { IconClose } from './icons.js';
import { pathBreadcrumb } from './path-links.js';
import { useStore } from './store.js';

function SplitPane(): React.JSX.Element | null {
  const splitSession = useStore((state) => state.splitSession);
  const closeSplitSession = useStore((state) => state.closeSplitSession);
  const focusSplitSession = useStore((state) => state.focusSplitSession);
  const splitStatus = useStore((state) => state.splitStatus);
  if (!splitSession) return null;
  return (
    <section className="main-pane split-pane">
      <header className="split-head">
        <strong>{splitSession.title}</strong>
        <span className="muted small">{splitStatus === 'waiting-approval' ? '승인 대기' : splitStatus === 'running' ? '작업 중' : ''}</span>
        <button type="button" className="link" onClick={() => void focusSplitSession()}>
          앞으로
        </button>
        <button type="button" className="icon-btn" onClick={closeSplitSession} aria-label="나란히 보기 닫기">
          <IconClose size={15} />
        </button>
      </header>
      <ChatStream source="split" />
    </section>
  );
}

function FilePreviewPane(): React.JSX.Element | null {
  const filePreview = useStore((state) => state.filePreview);
  const closeFilePreview = useStore((state) => state.closeFilePreview);
  const recentFiles = useStore((state) => state.recentFiles);
  const recentIndex = filePreview ? recentFiles.indexOf(filePreview.relPath) : -1;
  const [asMarkdown, setAsMarkdown] = useState(true);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  const syncGutter = () => {
    if (gutterRef.current && textRef.current) gutterRef.current.scrollTop = textRef.current.scrollTop;
  };
  useEffect(() => {
    setAsMarkdown(true);
  }, [filePreview?.relPath]);
  useEffect(() => {
    syncGutter();
  }, [filePreview?.text]);
  useEffect(() => {
    if (!filePreview?.line) return;
    const lineTarget = filePreview.line;
    const id = window.requestAnimationFrame(() => {
      const node = textRef.current;
      const text = useStore.getState().filePreview?.text;
      if (!node || text === undefined) return;
      const lines = text.split('\n');
      const line = Math.min(Math.max(1, lineTarget), Math.max(1, lines.length));
      const start = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0);
      const end = start + (lines[line - 1]?.length ?? 0);
      node.focus();
      node.setSelectionRange(start, end);
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight) || 18;
      node.scrollTop = Math.max(0, (line - 4) * lineHeight);
      if (gutterRef.current) gutterRef.current.scrollTop = node.scrollTop;
    });
    return () => window.cancelAnimationFrame(id);
  }, [filePreview?.line, filePreview?.relPath]);
  if (!filePreview) return null;
  const canRenderMarkdown = /\.md$/i.test(filePreview.relPath) && !filePreview.masked && !filePreview.truncated;
  const showMarkdown = canRenderMarkdown && asMarkdown && !filePreview.line;
  return (
    <section className="diff-pane-wrapper">
      <header>
        <div>
          <nav className="file-crumb" aria-label="파일 경로">
            {pathBreadcrumb(filePreview.relPath).map((part, index) => (
              <span key={part.relPath}>
                {index > 0 ? <span className="muted">/</span> : null}
                {part.file ? (
                  <strong>
                    {part.label}
                    {filePreview.line ? `:${filePreview.line}` : ''}
                  </strong>
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() => void useStore.getState().revealInTree(part.relPath, { show: true, directory: true })}
                  >
                    {part.label}
                  </button>
                )}
              </span>
            ))}
          </nav>
          {filePreview.text !== filePreview.originalText ? <span className="muted small">수정됨</span> : null}
          {filePreview.truncated ? <span className="muted small">일부만 표시</span> : null}
          {filePreview.masked ? <span className="muted small">비밀 값 가림</span> : null}
        </div>
        <div className="actions">
          {canRenderMarkdown && !filePreview.line ? (
            <button type="button" className="link" onClick={() => setAsMarkdown((value) => !value)}>
              {asMarkdown ? '원문' : '미리보기'}
            </button>
          ) : null}
          <button
            type="button"
            className="link"
            disabled={filePreview.masked}
            title={filePreview.masked ? '가려진 비밀 값은 복사하지 않습니다' : '내용 복사'}
            onClick={() => void useStore.getState().copyFilePreview()}
          >
            내용
          </button>
          <button
            type="button"
            className="link"
            onClick={() => void useStore.getState().copyPath(filePreview.relPath)}
          >
            경로
          </button>
          <button
            type="button"
            className="link"
            onClick={() => void useStore.getState().revealInTree(filePreview.relPath, { show: true })}
          >
            트리
          </button>
          <button
            type="button"
            className="link"
            disabled={recentIndex < 0 || recentIndex >= recentFiles.length - 1}
            onClick={() => void useStore.getState().previewRecent(1)}
          >
            이전
          </button>
          <button
            type="button"
            className="link"
            disabled={recentIndex <= 0}
            onClick={() => void useStore.getState().previewRecent(-1)}
          >
            다음
          </button>
          <button
            type="button"
            className="link"
            disabled={filePreview.truncated || filePreview.masked}
            title={
              filePreview.truncated
                ? '일부만 열려 있어 저장할 수 없습니다'
                : filePreview.masked
                  ? '가려진 비밀 값이 있어 저장할 수 없습니다'
                  : '저장'
            }
            onClick={() => void useStore.getState().saveFilePreview()}
          >
            저장
          </button>
          <button type="button" className="link" onClick={() => void useStore.getState().revealPath(filePreview.relPath)}>
            폴더
          </button>
          <button type="button" className="link" onClick={() => void useStore.getState().openPath(filePreview.relPath)}>
            열기
          </button>
          <button type="button" className="icon-btn" onClick={closeFilePreview} aria-label="닫기">
            <IconClose size={15} />
          </button>
        </div>
      </header>
      {showMarkdown ? (
        <div className="file-preview markdown-preview">
          <Markdown>{filePreview.text}</Markdown>
        </div>
      ) : (
        <div className="file-preview-wrap">
          <pre className="file-gutter" ref={gutterRef} aria-hidden>
            {filePreview.text.split('\n').map((_, index) => (
              <span key={index} className={filePreview.line === index + 1 ? 'current-line' : ''}>
                {index + 1}
              </span>
            ))}
          </pre>
          <textarea
            ref={textRef}
            className="file-preview"
            value={filePreview.text}
            onScroll={syncGutter}
            onChange={(event) =>
              useStore.setState({
                filePreview: { ...filePreview, text: event.target.value, line: undefined },
              })
            }
          />
        </div>
      )}
    </section>
  );
}

function LocalhostPreview(): React.JSX.Element | null {
  const url = useStore((state) => state.localhostPreview);
  const close = useStore((state) => state.closeLocalhostPreview);
  if (!url) return null;
  return (
    <section className="diff-pane-wrapper preview-frame">
      <header>
        <div>
          <strong>미리보기</strong>
          <span className="muted small">{url}</span>
        </div>
        <div className="actions">
          <button
            type="button"
            className="link"
            onClick={() => void window.grokDesktop.external.openLocalhost({ url })}
          >
            브라우저
          </button>
          <button type="button" className="icon-btn" onClick={close} aria-label="닫기">
            <IconClose size={15} />
          </button>
        </div>
      </header>
      {canFrameLocalhost(url) ? (
        <iframe className="localhost-frame" src={url} title="로컬 미리보기" sandbox="allow-scripts" />
      ) : (
        <div className="preview-unsupported">
          <p className="muted small">
            IPv6 루프백(<code>[::1]</code>)은 앱 안에서 열 수 없습니다. 브라우저에서 여세요.
          </p>
          <button type="button" onClick={() => void window.grokDesktop.external.openLocalhost({ url })}>
            브라우저에서 열기
          </button>
        </div>
      )}
    </section>
  );
}

export function App(): React.JSX.Element {
  const bootstrap = useStore((state) => state.bootstrap);
  const ingest = useStore((state) => state.ingest);
  const session = useStore((state) => state.session);
  const notice = useStore((state) => state.notice);
  const noticeKind = useStore((state) => state.noticeKind);
  const dismissNotice = useStore((state) => state.dismissNotice);
  const reviewOpen = useStore((state) => state.reviewOpen);
  const pendingConfirmation = useStore((state) => state.pendingConfirmation);
  const chooseFolder = useStore((state) => state.chooseFolder);
  const filePreview = useStore((state) => state.filePreview);
  const localhostPreview = useStore((state) => state.localhostPreview);
  const mediaLightbox = useStore((state) => state.mediaLightbox);

  useEffect(() => {
    void bootstrap();
    return window.grokDesktop.session.subscribe(ingest);
  }, [bootstrap, ingest]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        const state = useStore.getState();
        if (state.confirm) return;
        if (state.mediaLightbox) {
          event.preventDefault();
          state.closeMediaLightbox();
          return;
        }
        if (state.fileSwitcherOpen) {
          event.preventDefault();
          state.setFileSwitcherOpen(false);
          return;
        }
        if (state.pendingConfirmation) {
          event.preventDefault();
          useStore.setState({ pendingConfirmation: null });
          return;
        }
        if (state.settingsOpen) {
          event.preventDefault();
          state.setSettingsOpen(false);
          return;
        }
        if (state.shortcutsOpen) {
          event.preventDefault();
          state.setShortcutsOpen(false);
          return;
        }
        if (state.sideAskOpen) {
          event.preventDefault();
          state.setSideAskOpen(false);
          return;
        }
        if (state.localhostPreview) {
          event.preventDefault();
          state.closeLocalhostPreview();
          return;
        }
        if (state.filePreview) {
          event.preventDefault();
          void state.closeFilePreview();
          return;
        }
        if (state.reviewOpen || state.activeDiff) {
          event.preventDefault();
          state.closeDiff();
          return;
        }
        if (state.status === 'waiting-approval') {
          const pending = [...state.items].reverse().find((item) => item.kind === 'permission' && !item.decision);
          if (pending && pending.kind === 'permission') {
            event.preventDefault();
            void state.decide(pending.id, 'deny');
            return;
          }
        }
        if (state.status === 'running') {
          event.preventDefault();
          void state.cancel();
        }
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing) {
        const key = event.key.toLowerCase();
        if (key === 'y' || key === 'n' || key === 's') {
          const target = event.target as HTMLElement | null;
          if (
            !target ||
            (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable)
          ) {
            const state = useStore.getState();
            if (
              !state.confirm &&
              !state.fileSwitcherOpen &&
              !state.settingsOpen &&
              !state.shortcutsOpen &&
              !state.mediaLightbox &&
              state.status === 'waiting-approval'
            ) {
              // With two requests open at once the shortcut would answer the
              // newest, which is not necessarily the card being read. Ambiguity
              // here decides someone's files, so it falls back to clicking.
              const undecided = state.items.filter(
                (item) => item.kind === 'permission' && !item.decision,
              );
              const pending = undecided.length === 1 ? undecided[0] : undefined;
              if (pending && pending.kind === 'permission') {
                if (key === 'y') {
                  event.preventDefault();
                  void state.decide(pending.id, 'once');
                  return;
                }
                if (key === 'n') {
                  event.preventDefault();
                  void state.decide(pending.id, 'deny');
                  return;
                }
                if (key === 's' && pending.request.options.some((option) => option.kind === 'allow-session')) {
                  event.preventDefault();
                  void state.decide(pending.id, 'session');
                  return;
                }
              }
            }
          }
        }
      }
      if (event.key === 'Tab' && event.ctrlKey) {
        const overlay = useStore.getState();
        if (overlay.confirm || overlay.fileSwitcherOpen || overlay.settingsOpen || overlay.shortcutsOpen) return;
        event.preventDefault();
        const { sessions, session, openSession } = useStore.getState();
        if (sessions.length === 0) return;
        const index = sessions.findIndex((entry) => entry.id === session?.id);
        const next = sessions[(index + (event.shiftKey ? -1 : 1) + sessions.length) % sessions.length];
        if (next) void openSession(next.id);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 'w') {
        const state = useStore.getState();
        if (state.confirm) return;
        if (state.mediaLightbox) {
          event.preventDefault();
          state.closeMediaLightbox();
          return;
        }
        if (state.settingsOpen) {
          event.preventDefault();
          state.setSettingsOpen(false);
          return;
        }
        if (state.shortcutsOpen) {
          event.preventDefault();
          state.setShortcutsOpen(false);
          return;
        }
        if (state.fileSwitcherOpen) {
          event.preventDefault();
          state.setFileSwitcherOpen(false);
          return;
        }
        if (state.sideAskOpen) {
          event.preventDefault();
          state.setSideAskOpen(false);
          return;
        }
        if (state.localhostPreview) {
          event.preventDefault();
          state.closeLocalhostPreview();
          return;
        }
        if (state.filePreview) {
          event.preventDefault();
          void state.closeFilePreview();
          return;
        }
        if (state.reviewOpen) {
          event.preventDefault();
          state.closeDiff();
          return;
        }
        if (state.splitSession) {
          event.preventDefault();
          state.closeSplitSession();
          return;
        }
        return;
      }
      if (event.key.toLowerCase() === 'p') {
        const state = useStore.getState();
        if (state.confirm || !state.workspace) return;
        event.preventDefault();
        const mode = event.shiftKey ? 'commands' : 'files';
        if (state.fileSwitcherOpen && state.fileSwitcherMode === mode) state.setFileSwitcherOpen(false);
        else state.setFileSwitcherOpen(true, mode);
        return;
      }
      if (event.key >= '1' && event.key <= '4' && !event.shiftKey && !event.altKey) {
        const overlay = useStore.getState();
        if (overlay.confirm || overlay.fileSwitcherOpen || overlay.settingsOpen || overlay.shortcutsOpen) return;
        event.preventDefault();
        const tabs = ['sessions', 'files', 'changes', 'tasks'] as const;
        const tab = tabs[Number(event.key) - 1];
        if (tab) useStore.getState().setSidebarTab(tab);
        return;
      }
      if (event.key.toLowerCase() === 'f' && event.shiftKey) {
        event.preventDefault();
        useStore.getState().openFileSearch();
        return;
      }
      if (event.key === 'n') {
        event.preventDefault();
        void useStore.getState().newSession();
      } else if (event.key === ',') {
        event.preventDefault();
        useStore.getState().setSettingsOpen(true);
      } else if (event.key === '.') {
        event.preventDefault();
        useStore.getState().setShortcutsOpen(true);
      } else if (event.key === 'k') {
        event.preventDefault();
        document.querySelector<HTMLButtonElement>('[data-sidebar-tab="sessions"]')?.click();
        window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-session-search]')?.focus(), 0);
      } else if (event.key.toLowerCase() === 'd' && event.shiftKey) {
        event.preventDefault();
        const state = useStore.getState();
        void state.setReviewOpen(!state.reviewOpen);
      } else if (event.key === ';') {
        event.preventDefault();
        const state = useStore.getState();
        state.setSideAskOpen(!state.sideAskOpen);
      } else if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) {
          return;
        }
        const state = useStore.getState();
        if (
          state.confirm ||
          state.fileSwitcherOpen ||
          state.mediaLightbox ||
          state.settingsOpen ||
          state.status !== 'waiting-approval'
        ) {
          return;
        }
        const pending = [...state.items].reverse().find((item) => item.kind === 'permission' && !item.decision);
        if (!pending || pending.kind !== 'permission') return;
        event.preventDefault();
        void state.decide(pending.id, 'once');
      } else if (event.key.toLowerCase() === 's') {
        if (!useStore.getState().filePreview) return;
        event.preventDefault();
        void useStore.getState().saveFilePreview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      {notice ? (
        <div className={`toast notice-${noticeKind}`} role={noticeKind === 'error' ? 'alert' : 'status'}>
          <span>{notice}</span>
          <button type="button" className="icon-btn" onClick={dismissNotice} aria-label="닫기">
            <IconClose size={14} />
          </button>
        </div>
      ) : null}

      {session ? (
        <>
          <Header />
          <div className="workspace">
            <Sidebar />
            <main className="main-pane">
              <ChatStream />
              <Composer />
            </main>
            <SplitPane />
            {reviewOpen ? <ReviewPanel /> : localhostPreview ? <LocalhostPreview /> : filePreview ? (
              <FilePreviewPane />
            ) : null}
          </div>
        </>
      ) : (
        <Onboarding />
      )}
      {pendingConfirmation ? (
        <div className="modal-backdrop">
          <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="folder-warn-title">
            <header>
              <h2 id="folder-warn-title">이 폴더를 열까요?</h2>
            </header>
            <code>{pendingConfirmation.canonicalRootPath}</code>
            <ul className="reasons">
              {pendingConfirmation.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div className="actions">
              <button
                type="button"
                className="primary"
                onClick={() => void chooseFolder(pendingConfirmation.canonicalRootPath)}
              >
                확인하고 열기
              </button>
              <button type="button" onClick={() => useStore.setState({ pendingConfirmation: null })}>
                취소
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <SettingsPanel />
      <ShortcutsPanel />
      <QuickOpen />
      {mediaLightbox ? (
        <div className="modal-backdrop media-lightbox" onClick={() => useStore.getState().closeMediaLightbox()}>
          <img
            src={mediaLightbox.src}
            alt={mediaLightbox.alt}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
      <ConfirmDialog />
    </div>
  );
}
