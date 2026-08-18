import { useEffect, useRef, useState } from 'react';
import type { FileHit, SessionSummary, TreeNode } from '@grok-desktop/shared';
import { IconChevron, IconFile, IconFolder, IconPencil, IconPlus, IconTrash, IconUndo } from '../icons.js';
import { relativeTime } from '../path-links.js';
import { useStore } from '../store.js';
import { MediaView } from './MediaView.js';

const RELPATH_MIME = 'application/x-grok-relpath';

function clampMenu(x: number, y: number, width = 176, height = 196): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - width)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - height)),
  };
}

const TASK_STATUS: Record<'running' | 'completed' | 'failed', string> = {
  running: '실행 중',
  completed: '완료',
  failed: '실패',
};

function FileTree({ relPath, depth }: { relPath: string; depth: number }): React.JSX.Element | null {
  const nodes = useStore((state) => state.tree[relPath]);
  const expanded = useStore((state) => state.expanded);
  const toggleDirectory = useStore((state) => state.toggleDirectory);
  const attachFromTree = useStore((state) => state.attachFromTree);
  const previewFile = useStore((state) => state.previewFile);
  const revealedFile = useStore((state) => state.revealedFile);
  const openPath = useStore((state) => state.openPath);
  const revealPath = useStore((state) => state.revealPath);
  const copyPath = useStore((state) => state.copyPath);
  const changes = useStore((state) => state.changes);
  const [menu, setMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null);

  if (!nodes) return null;

  return (
    <ul className="tree" style={{ paddingLeft: depth === 0 ? 0 : 10 }}>
      {nodes.map((node: TreeNode) => (
        <li key={node.relPath}>
          {node.kind === 'directory' ? (
            <>
              <button type="button" className={`tree-item ${revealedFile === node.relPath ? 'current' : ''}`} onClick={() => void toggleDirectory(node.relPath)}>
                <IconChevron size={12} open={expanded.includes(node.relPath)} />
                <IconFolder size={14} />
                {node.name}
              </button>
              {expanded.includes(node.relPath) ? <FileTree relPath={node.relPath} depth={depth + 1} /> : null}
            </>
          ) : (
            <div
              className="file-row"
              draggable={!node.sensitive}
              onDragStart={(event) => {
                if (node.sensitive) return;
                event.dataTransfer.setData(RELPATH_MIME, node.relPath);
                event.dataTransfer.setData('text/plain', node.relPath);
                event.dataTransfer.effectAllowed = 'copy';
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ ...clampMenu(event.clientX, event.clientY), node });
              }}
            >
              <button
                type="button"
                className={`tree-item file ${node.sensitive ? 'sensitive' : ''}${revealedFile === node.relPath ? ' current' : ''}`}
                title={node.relPath}
                onClick={() => void previewFile(node.relPath)}
              >
                <IconFile size={14} />
                {node.name}
                {(() => {
                  const change = changes.find((entry) => entry.relPath === node.relPath);
                  return change ? (
                    <span className={`file-status ${change.status}`} title={change.status}>
                      {change.status === 'added' ? 'A' : change.status === 'deleted' ? 'D' : 'M'}
                    </span>
                  ) : null;
                })()}
              </button>
              <button
                type="button"
                className="icon-btn"
                title="기본 앱으로 열기"
                aria-label={`${node.name} 열기`}
                onClick={() => void openPath(node.relPath)}
              >
                ↗
              </button>
              {node.sensitive ? null : (
                <button
                  type="button"
                  className="icon-btn"
                  title="첨부"
                  aria-label={`${node.name} 첨부`}
                  onClick={() => attachFromTree(node.relPath)}
                >
                  <IconPlus size={12} />
                </button>
              )}
            </div>
          )}
        </li>
      ))}
      {menu ? (
        <div
          className="file-menu-backdrop"
          role="presentation"
          onClick={() => setMenu(null)}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu(null);
          }}
        >
          <ul className="file-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void previewFile(menu.node.relPath);
                  setMenu(null);
                }}
              >
                미리보기
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void openPath(menu.node.relPath);
                  setMenu(null);
                }}
              >
                기본 앱으로 열기
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void revealPath(menu.node.relPath);
                  setMenu(null);
                }}
              >
                폴더에서 보기
              </button>
            </li>
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  void copyPath(menu.node.relPath);
                  setMenu(null);
                }}
              >
                상대 경로 복사
              </button>
            </li>
            {menu.node.sensitive ? null : (
              <li>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    attachFromTree(menu.node.relPath);
                    setMenu(null);
                  }}
                >
                  첨부
                </button>
              </li>
            )}
          </ul>
        </div>
      ) : null}
    </ul>
  );
}

export function Sidebar(): React.JSX.Element {
  const workspace = useStore((state) => state.workspace);
  const sessions = useStore((state) => state.sessions);
  const session = useStore((state) => state.session);
  const changes = useStore((state) => state.changes);
  const showDiff = useStore((state) => state.showDiff);
  const previewFile = useStore((state) => state.previewFile);
  const attachFromTree = useStore((state) => state.attachFromTree);
  const revert = useStore((state) => state.revert);
  const newSession = useStore((state) => state.newSession);
  const items = useStore((state) => state.items);
  const continuePlan = useStore((state) => state.continuePlan);
  const setReviewOpen = useStore((state) => state.setReviewOpen);
  const forkSession = useStore((state) => state.forkSession);
  const applyWorktree = useStore((state) => state.applyWorktree);
  const exportRaw = useStore((state) => state.exportRaw);
  const exportConversation = useStore((state) => state.exportConversation);
  const revealedFile = useStore((state) => state.revealedFile);
  const sessionRecord = useStore((state) => state.session);
  const openSession = useStore((state) => state.openSession);
  const openSplitSession = useStore((state) => state.openSplitSession);
  const renameSession = useStore((state) => state.renameSession);
  const deleteSession = useStore((state) => state.deleteSession);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const tab = useStore((state) => state.sidebarTab);
  const setTab = useStore((state) => state.setSidebarTab);
  const [query, setQuery] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [fileHits, setFileHits] = useState<FileHit[]>([]);
  const [sessionFilter, setSessionFilter] = useState<'all' | 'running' | 'approval'>('all');
  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number; entry: SessionSummary } | null>(null);
  const fileSearchRef = useRef<HTMLInputElement>(null);
  const fileSearchFocus = useStore((state) => state.fileSearchFocus);
  const attentionIds = useStore((state) => state.attentionIds);
  const recentFiles = useStore((state) => state.recentFiles);
  const pinnedIds = useStore((state) => state.pinnedIds);
  const togglePin = useStore((state) => state.togglePin);
  const [sessionFocusId, setSessionFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== 'files' || !revealedFile) return;
    document.querySelector<HTMLElement>('.sidebar .tree-item.current')?.scrollIntoView({ block: 'nearest' });
  }, [revealedFile, tab]);

  useEffect(() => {
    if (tab !== 'files' || fileSearchFocus === 0) return;
    fileSearchRef.current?.focus();
    fileSearchRef.current?.select();
  }, [fileSearchFocus, tab]);

  const commitRename = (sessionId: string) => {
    const title = draft.trim();
    setRenamingId(null);
    if (title) void renameSession(sessionId, title);
  };

  const visibleSessions = sessions
    .filter((entry) => {
      if (sessionFilter === 'running' && entry.status !== 'running') return false;
      if (sessionFilter === 'approval' && entry.status !== 'waiting-approval') return false;
      if (!query.trim()) return true;
      const needle = query.trim().toLowerCase();
      return (
        entry.title.toLowerCase().includes(needle) ||
        (entry.preview ?? '').toLowerCase().includes(needle) ||
        (entry.searchText ?? '').includes(needle)
      );
    })
    .slice()
    .sort((left, right) => {
      const watching = new Set(attentionIds);
      const pinned = new Set(pinnedIds);
      const rank = (entry: (typeof sessions)[number]) => {
        if (entry.status === 'waiting-approval') return 0;
        if (entry.status === 'running') return 1;
        if (pinned.has(entry.id)) return 2;
        if (watching.has(entry.id)) return 3;
        if (entry.live) return 4;
        return 5;
      };
      const delta = rank(left) - rank(right);
      return delta !== 0 ? delta : right.updatedAt.localeCompare(left.updatedAt);
    });
  const runningCount = sessions.filter((entry) => entry.status === 'running').length;
  const approvalCount = sessions.filter((entry) => entry.status === 'waiting-approval').length;

  useEffect(() => {
    if (tab !== 'sessions') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'j' && event.key !== 'k' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
        return;
      }
      if (event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.sidebar')) return;
      if (target.closest('.session-rename')) return;
      if (target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const inSearch = target.classList.contains('session-search');
      if (target.tagName === 'INPUT' && !inSearch) return;
      if (inSearch && (event.key === 'j' || event.key === 'k')) return;
      const state = useStore.getState();
      if (state.confirm || state.fileSwitcherOpen || state.settingsOpen || state.reviewOpen) return;
      if (visibleSessions.length === 0) return;
      if (event.key === 'Enter') {
        const current = visibleSessions.find((entry) => entry.id === sessionFocusId) ?? visibleSessions[0];
        if (current) {
          event.preventDefault();
          void openSession(current.id);
        }
        return;
      }
      event.preventDefault();
      const down = event.key === 'j' || event.key === 'ArrowDown';
      const index = visibleSessions.findIndex((entry) => entry.id === (sessionFocusId ?? session?.id));
      const next = down
        ? visibleSessions[Math.min(visibleSessions.length - 1, Math.max(0, index) + 1)]
        : visibleSessions[Math.max(0, (index < 0 ? 0 : index) - 1)];
      if (next) setSessionFocusId(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openSession, session?.id, sessionFocusId, tab, visibleSessions]);

  useEffect(() => {
    if (tab !== 'files' || !workspace) {
      setFileHits([]);
      return;
    }
    const needle = fileQuery.trim();
    if (!needle) {
      setFileHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.grokDesktop.workspace
        .searchFiles({ workspaceId: workspace.id, query: needle, limit: 40 })
        .then((hits) => {
          if (!cancelled) setFileHits(hits);
        })
        .catch(() => {
          if (!cancelled) setFileHits([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileQuery, tab, workspace]);

  const media = items.flatMap((item) => (item.kind === 'tool' && item.call.media ? item.call.media : []));
  const plan = [...items].reverse().find((item) => item.kind === 'plan');
  const subagents = items.filter((item) => item.kind === 'subagent');
  const tasks = items.filter((item) => item.kind === 'task');

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs" role="tablist" aria-label="사이드바">
        <button
          type="button"
          role="tab"
          data-sidebar-tab="sessions"
          aria-selected={tab === 'sessions'}
          className={tab === 'sessions' ? 'active' : ''}
          onClick={() => setTab('sessions')}
        >
          대화
        </button>
        <button type="button" role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          파일
        </button>
        <button type="button" role="tab" aria-selected={tab === 'changes'} className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
          변경
          {changes.length > 0 ? <span className="tab-count">{changes.length}</span> : null}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'tasks'} className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
          작업
          {subagents.length + tasks.length > 0 ? (
            <span className="tab-count">{subagents.length + tasks.length}</span>
          ) : null}
        </button>
      </div>

      <div className="sidebar-body">
        {tab === 'sessions' ? (
          <>
            <div className="sidebar-chrome">
              <div className="new-chat-row">
                <button type="button" className="new-chat with-icon" onClick={() => void newSession('none')}>
                  <IconPlus size={14} />
                  새 대화
                </button>
                <button
                  type="button"
                  className="new-chat worktree"
                  title="같은 저장소를 격리된 워크트리에서 엽니다"
                  onClick={() => void newSession('worktree')}
                >
                  워크트리
                </button>
              </div>
              <div className="session-filters" role="tablist" aria-label="대화 필터">
                <button
                  type="button"
                  role="tab"
                  className={sessionFilter === 'all' ? 'active' : ''}
                  onClick={() => setSessionFilter('all')}
                >
                  전체
                </button>
                <button
                  type="button"
                  role="tab"
                  className={sessionFilter === 'running' ? 'active' : ''}
                  onClick={() => setSessionFilter('running')}
                >
                  실행{runningCount > 0 ? ` ${runningCount}` : ''}
                </button>
                <button
                  type="button"
                  role="tab"
                  className={sessionFilter === 'approval' ? 'active' : ''}
                  onClick={() => setSessionFilter('approval')}
                >
                  승인{approvalCount > 0 ? ` ${approvalCount}` : ''}
                </button>
              </div>
              <input
                className="session-search"
                data-session-search
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="대화 검색"
                aria-label="대화 검색"
              />
              {sessionRecord?.worktreePath ? (
                <div className="worktree-banner">
                  <span>워크트리에서 작업 중</span>
                  <button type="button" className="link" onClick={() => void applyWorktree()}>
                    본문에 적용
                  </button>
                </div>
              ) : null}
            </div>
            {visibleSessions.length === 0 ? (
              <p className="muted small">
                {sessionFilter === 'running'
                  ? '실행 중인 대화가 없습니다.'
                  : sessionFilter === 'approval'
                    ? '승인을 기다리는 대화가 없습니다.'
                    : query.trim()
                      ? '검색과 일치하는 대화가 없습니다.'
                      : '아직 저장된 대화가 없습니다.'}
              </p>
            ) : (
              <ul className="sessions">
                {visibleSessions.map((entry) => (
                  <li
                    key={entry.id}
                    className={`${entry.id === session?.id ? 'current' : ''}${attentionIds.includes(entry.id) && entry.id !== session?.id ? ' needs-attention' : ''}${sessionFocusId === entry.id ? ' session-focus' : ''}`}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSessionMenu({ ...clampMenu(event.clientX, event.clientY, 176, 220), entry });
                    }}
                  >
                    {renamingId === entry.id ? (
                      <input
                        className="session-rename"
                        value={draft}
                        autoFocus
                        aria-label="세션 이름"
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitRename(entry.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRename(entry.id);
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            setRenamingId(null);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <button
                          type="button"
                          className="tree-item session-open"
                          onClick={(event) => {
                            if (event.metaKey || event.ctrlKey) {
                              event.preventDefault();
                              if (entry.id !== session?.id) void openSplitSession(entry.id);
                              return;
                            }
                            void openSession(entry.id);
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            setRenamingId(entry.id);
                            setDraft(entry.title);
                          }}
                          title={`${entry.title} · ⌘클릭으로 옆에 열기 · 두 번 눌러 이름 변경`}
                        >
                          <span className="session-copy">
                            <span className="session-title-row">
                              {pinnedIds.includes(entry.id) ? <span className="pin-mark" title="고정됨">★</span> : null}
                              <span className="session-title">{entry.title}</span>
                              {attentionIds.includes(entry.id) && entry.id !== session?.id ? (
                                <span className="attention-dot" title="확인 필요" />
                              ) : entry.live ? (
                                <span className="live-dot" title="연결됨" />
                              ) : null}
                              {entry.status === 'waiting-approval' || entry.status === 'running' ? (
                                <span className={`session-status ${entry.status}`}>
                                  {entry.status === 'waiting-approval' ? '승인' : '실행'}
                                </span>
                              ) : null}
                            </span>
                            <span className="session-meta">
                              {entry.preview ? (
                                <span className="session-preview">
                                  {entry.preview.length > 64 ? `${entry.preview.slice(0, 63)}…` : entry.preview}
                                </span>
                              ) : (
                                <span className="session-preview">새 대화</span>
                              )}
                              {entry.worktreeLabel ? <span className="worktree-pill">{entry.worktreeLabel}</span> : null}
                              {entry.updatedAt ? <span className="session-time">{relativeTime(entry.updatedAt)}</span> : null}
                            </span>
                          </span>
                        </button>
                        <div className="session-actions">
                          {entry.id !== session?.id ? (
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label="옆에 열기"
                              title="옆에 열기"
                              onClick={() => void openSplitSession(entry.id)}
                            >
                              ‖
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="이름 변경"
                            title="이름 변경"
                            onClick={() => {
                              setRenamingId(entry.id);
                              setDraft(entry.title);
                            }}
                          >
                            <IconPencil size={13} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label="대화 삭제"
                            title="삭제"
                            onClick={() => void deleteSession(entry.id)}
                          >
                            <IconTrash size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {sessionMenu ? (
              <div
                className="file-menu-backdrop"
                role="presentation"
                onClick={() => setSessionMenu(null)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setSessionMenu(null);
                }}
              >
                <ul className="file-menu" style={{ left: sessionMenu.x, top: sessionMenu.y }} role="menu">
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        togglePin(sessionMenu.entry.id);
                        setSessionMenu(null);
                      }}
                    >
                      {pinnedIds.includes(sessionMenu.entry.id) ? '고정 해제' : '고정'}
                    </button>
                  </li>
                  {sessionMenu.entry.id === session?.id ? (
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void exportConversation();
                          setSessionMenu(null);
                        }}
                      >
                        대화 복사
                      </button>
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setRenamingId(sessionMenu.entry.id);
                        setDraft(sessionMenu.entry.title);
                        setSessionMenu(null);
                      }}
                    >
                      이름 변경
                    </button>
                  </li>
                  {sessionMenu.entry.id !== session?.id ? (
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void openSplitSession(sessionMenu.entry.id);
                          setSessionMenu(null);
                        }}
                      >
                        옆에 열기
                      </button>
                    </li>
                  ) : (
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void forkSession();
                          setSessionMenu(null);
                        }}
                      >
                        이 대화 분기
                      </button>
                    </li>
                  )}
                  {sessionMenu.entry.worktreePath ? (
                    <li>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          void navigator.clipboard.writeText(sessionMenu.entry.worktreePath ?? '');
                          useStore.getState().notify('워크트리 경로를 복사했습니다.');
                          setSessionMenu(null);
                        }}
                      >
                        워크트리 경로 복사
                      </button>
                    </li>
                  ) : null}
                  <li>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        void deleteSession(sessionMenu.entry.id);
                        setSessionMenu(null);
                      }}
                    >
                      삭제
                    </button>
                  </li>
                </ul>
              </div>
            ) : null}
            {sessionRecord ? (
              <details className="session-more">
                <summary>이 대화</summary>
                <div className="session-more-actions">
                  <button type="button" className="link" onClick={() => void forkSession()}>
                    이 대화 분기
                  </button>
                  <button type="button" className="link" onClick={() => void exportRaw()}>
                    원본 로그 복사
                  </button>
                </div>
              </details>
            ) : null}
          </>
        ) : null}

        {tab === 'files' ? (
          workspace ? (
            <>
              <div className="sidebar-chrome">
                <input
                  ref={fileSearchRef}
                  className="session-search"
                  value={fileQuery}
                  onChange={(event) => setFileQuery(event.target.value)}
                  placeholder="파일 검색"
                  aria-label="파일 검색"
                />
              </div>
              {media.length > 0 ? (
                <section className="media-strip">
                  <h2>생성물</h2>
                  <ul className="gallery">
                    {media.map((entry, index) => (
                      <li key={`${entry.relPath ?? entry.dataUrl ?? index}`}>
                        <MediaView src={entry.dataUrl ?? entry.relPath ?? ''} alt={entry.relPath ?? '생성 결과'} />
                        {entry.relPath ? (
                          <button type="button" className="link" onClick={() => void previewFile(entry.relPath ?? '')}>
                            {entry.relPath}
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {fileQuery.trim() ? (
                fileHits.length === 0 ? (
                  <p className="muted small">일치하는 파일이 없습니다.</p>
                ) : (
                  <ul className="sessions">
                    {fileHits.map((hit) => (
                      <li
                        key={hit.relPath}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(RELPATH_MIME, hit.relPath);
                          event.dataTransfer.setData('text/plain', hit.relPath);
                          event.dataTransfer.effectAllowed = 'copy';
                        }}
                      >
                        <button type="button" className="tree-item" onClick={() => void previewFile(hit.relPath)}>
                          <IconFile size={14} />
                          <span className="session-title">{hit.relPath}</span>
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="첨부"
                          aria-label={`${hit.name} 첨부`}
                          onClick={() => attachFromTree(hit.relPath)}
                        >
                          <IconPlus size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <>
                  {recentFiles.length > 0 ? (
                    <section className="media-strip">
                      <h2>최근</h2>
                      <ul className="sessions compact-files">
                        {recentFiles.slice(0, 5).map((relPath) => (
                          <li key={relPath}>
                            <button type="button" className="tree-item" onClick={() => void previewFile(relPath)}>
                              <IconFile size={14} />
                              <span className="session-title">{relPath}</span>
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              title="첨부"
                              aria-label={`${relPath} 첨부`}
                              onClick={() => attachFromTree(relPath)}
                            >
                              <IconPlus size={12} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                  <FileTree relPath="" depth={0} />
                </>
              )}
            </>
          ) : (
            <p className="muted small">폴더를 열어 주세요.</p>
          )
        ) : null}

        {tab === 'tasks' ? (
          <>
            {plan && plan.kind === 'plan' ? (
              <section className="card plan compact">
                <h3>계획</h3>
                <ol>
                  {plan.entries.map((entry, index) => (
                    <li key={`${plan.id}-${index}`} className={entry.status}>
                      {entry.content}
                    </li>
                  ))}
                </ol>
                <button type="button" className="primary" onClick={() => void continuePlan()}>
                  이 계획으로 진행
                </button>
              </section>
            ) : null}
            {subagents.length + tasks.length > 0 ? (
              <ul className="sessions">
                {subagents.map((item) =>
                  item.kind === 'subagent' ? (
                    <li key={item.id}>
                      <span className="session-title">{item.title}</span>
                      <span className="muted small">{TASK_STATUS[item.status]}</span>
                    </li>
                  ) : null,
                )}
                {tasks.map((item) =>
                  item.kind === 'task' ? (
                    <li key={item.id}>
                      <span className="session-title">{item.title}</span>
                      <span className="muted small">{TASK_STATUS[item.status]}</span>
                    </li>
                  ) : null,
                )}
              </ul>
            ) : plan && plan.kind === 'plan' ? null : (
              <p className="muted small">아직 계획이나 백그라운드 작업이 없습니다.</p>
            )}
          </>
        ) : null}

        {tab === 'changes' ? (
          <>
            <button type="button" className="new-chat" onClick={() => void setReviewOpen(true)}>
              리뷰 패널 열기
            </button>
            {changes.length === 0 ? (
              <p className="muted small">이번 턴에 기록된 파일은 없습니다. 작업 트리·스테이징·브랜치는 리뷰에서 볼 수 있습니다.</p>
            ) : (
              <ul className="changes">
                {changes.map((change) => (
                  <li key={change.relPath} className="change-row">
                    <button type="button" className="tree-item" onClick={() => void showDiff(change.relPath)}>
                      <span className={`status ${change.status}`}>{change.status[0]?.toUpperCase()}</span>
                      <span className="session-title">{change.relPath}</span>
                      <span className="diff-stats">
                        <span className="add">+{change.additions}</span>{' '}
                        <span className="del">-{change.deletions}</span>
                      </span>
                    </button>
                    {change.revertable ? (
                      <button
                        type="button"
                        className="icon-btn"
                        title="되돌리기"
                        aria-label={`${change.relPath} 되돌리기`}
                        onClick={() => void revert(change.relPath)}
                      >
                        <IconUndo size={13} />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>
    </aside>
  );
}
