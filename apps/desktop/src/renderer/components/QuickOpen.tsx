import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileHit } from '@grok-desktop/shared';
import { filterPaletteCommands } from '../command-palette.js';
import { IconFile } from '../icons.js';
import { useStore } from '../store.js';

function runPaletteCommand(id: string): void {
  const store = useStore.getState();
  switch (id) {
    case 'new':
      void store.newSession();
      return;
    case 'worktree':
      void store.newSession('worktree');
      return;
    case 'review':
      store.setReviewOpen(true);
      return;
    case 'side-ask':
      store.setSideAskOpen(true);
      return;
    case 'files':
      store.openFileSearch();
      return;
    case 'fork':
      void store.forkSession();
      return;
    case 'export':
      void store.exportConversation();
      return;
    case 'copy':
      void store.copyLastAnswer();
      return;
    case 'ask':
    case 'plan':
    case 'agent':
      store.setMode(id);
      return;
    case 'continue-plan':
      void store.continuePlan();
      return;
    case 'cancel':
      void store.cancel();
      return;
    case 'restart':
      void store.restartSession();
      return;
    case 'settings':
      store.setSettingsOpen(true);
      return;
    case 'shortcuts':
      store.setShortcutsOpen(true);
      return;
    default:
      return;
  }
}

export function QuickOpen(): React.JSX.Element | null {
  const open = useStore((state) => state.fileSwitcherOpen);
  const mode = useStore((state) => state.fileSwitcherMode);
  const setOpen = useStore((state) => state.setFileSwitcherOpen);
  const workspace = useStore((state) => state.workspace);
  const changes = useStore((state) => state.changes);
  const recentFiles = useStore((state) => state.recentFiles);
  const sessions = useStore((state) => state.sessions);
  const previewFile = useStore((state) => state.previewFile);
  const attachFromTree = useStore((state) => state.attachFromTree);
  const copyPath = useStore((state) => state.copyPath);
  const openSession = useStore((state) => state.openSession);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<FileHit[]>([]);
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const commandMode = mode === 'commands' || query.startsWith('>');
  const commands = useMemo(() => filterPaletteCommands(query), [query]);

  const changeHits = useMemo(
    () =>
      changes
        .filter((change) => change.status !== 'deleted')
        .map((change) => ({
          relPath: change.relPath,
          name: change.relPath.split('/').pop() ?? change.relPath,
        })),
    [changes],
  );
  const recentHits = useMemo(
    () =>
      recentFiles.map((relPath) => ({
        relPath,
        name: relPath.split('/').pop() ?? relPath,
      })),
    [recentFiles],
  );
  const fileRows = query.trim() && !query.startsWith('>')
    ? hits
    : (() => {
        const seen = new Set<string>();
        const merged: FileHit[] = [];
        for (const hit of [...changeHits, ...recentHits, ...hits]) {
          if (seen.has(hit.relPath)) continue;
          seen.add(hit.relPath);
          merged.push(hit);
        }
        return merged;
      })();
  const sessionRows = useMemo(() => {
    const needle = query.replace(/^>/, '').trim().toLowerCase();
    if (!commandMode || !needle) return [];
    return sessions
      .filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) ||
          (entry.preview ?? '').toLowerCase().includes(needle) ||
          (entry.searchText ?? '').includes(needle),
      )
      .slice(0, 8)
      .map((entry) => ({ id: entry.id, title: entry.title, hint: entry.preview ?? '대화로 이동' }));
  }, [commandMode, query, sessions]);
  const commandRows = useMemo(
    () => [
      ...commands.map((command) => ({ kind: 'command' as const, id: command.id, title: command.title, hint: command.hint })),
      ...sessionRows.map((entry) => ({ kind: 'session' as const, id: entry.id, title: entry.title, hint: entry.hint })),
    ],
    [commands, sessionRows],
  );
  const count = commandMode ? commandRows.length : fileRows.length;

  useEffect(() => {
    if (!open) return;
    setQuery(mode === 'commands' ? '>' : '');
    setHits([]);
    setIndex(0);
    queueMicrotask(() => inputRef.current?.focus());
  }, [open, mode]);

  useEffect(() => {
    if (!open || !workspace || commandMode) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.grokDesktop.workspace
        .searchFiles({ workspaceId: workspace.id, query, limit: 24 })
        .then((found) => {
          if (!cancelled) {
            setHits(found);
            setIndex(0);
          }
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [commandMode, open, query, workspace]);

  useEffect(() => {
    setIndex(0);
  }, [commandMode, query]);

  if (!open) return null;

  const chooseFile = (hit: FileHit, action: 'preview' | 'attach' | 'copy') => {
    if (action === 'attach') attachFromTree(hit.relPath);
    else if (action === 'copy') void copyPath(hit.relPath);
    else void previewFile(hit.relPath);
    setOpen(false);
  };

  const chooseCommand = (id: string) => {
    setOpen(false);
    runPaletteCommand(id);
  };

  const choosePaletteRow = (row: (typeof commandRows)[number]) => {
    if (row.kind === 'session') {
      setOpen(false);
      void openSession(row.id);
      return;
    }
    chooseCommand(row.id);
  };

  return (
    <div className="modal-backdrop quick-open-backdrop" onClick={() => setOpen(false)}>
      <section
        className="modal quick-open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-open-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id="quick-open-title">{commandMode ? '명령' : '파일 열기'}</h2>
          <button type="button" className="link" onClick={() => setOpen(false)}>
            닫기
          </button>
        </header>
        <input
          ref={inputRef}
          className="session-search"
          value={query}
          placeholder={commandMode ? '명령 검색 · > 로 명령' : '파일 이름 또는 경로 · > 명령'}
          aria-label={commandMode ? '명령 검색' : '파일 검색'}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing && event.key !== 'Escape') return;
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              return;
            }
            if (event.key === 'ArrowDown' && count > 0) {
              event.preventDefault();
              setIndex((value) => (value + 1) % count);
              return;
            }
            if (event.key === 'ArrowUp' && count > 0) {
              event.preventDefault();
              setIndex((value) => (value - 1 + count) % count);
              return;
            }
            if (commandMode) {
              const row = commandRows[index];
              if (event.key === 'Enter' && row) {
                event.preventDefault();
                choosePaletteRow(row);
              }
              return;
            }
            const current = fileRows[index];
            if (!current) return;
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              chooseFile(current, 'attach');
              return;
            }
            if (event.key.toLowerCase() === 'c' && (event.metaKey || event.ctrlKey)) {
              const field = event.currentTarget;
              if (field.selectionStart !== field.selectionEnd) return;
              event.preventDefault();
              chooseFile(current, 'copy');
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              chooseFile(current, 'preview');
            }
          }}
        />
        {count === 0 ? (
          <p className="muted small">
            {commandMode ? '일치하는 명령이 없습니다.' : query.trim() ? '일치하는 파일이 없습니다.' : '최근 변경이 없습니다. 이름을 입력하세요.'}
          </p>
        ) : commandMode ? (
          <ul className="quick-open-list" role="listbox" aria-label="명령 목록">
            {commandRows.map((row, rowIndex) => (
              <li key={`${row.kind}-${row.id}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={rowIndex === index}
                  className={rowIndex === index ? 'active' : ''}
                  onMouseEnter={() => setIndex(rowIndex)}
                  onClick={() => choosePaletteRow(row)}
                >
                  <span className="session-copy">
                    <span className="session-title">{row.kind === 'session' ? `대화 · ${row.title}` : row.title}</span>
                    <span className="session-preview">{row.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="quick-open-list" role="listbox" aria-label="파일 목록">
            {fileRows.map((hit, rowIndex) => (
              <li key={hit.relPath}>
                <button
                  type="button"
                  role="option"
                  aria-selected={rowIndex === index}
                  className={rowIndex === index ? 'active' : ''}
                  onMouseEnter={() => setIndex(rowIndex)}
                  onClick={() => chooseFile(hit, 'preview')}
                >
                  <IconFile size={14} />
                  <span className="session-copy">
                    <span className="session-title">{hit.name}</span>
                    <span className="session-preview">{hit.relPath}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">
          {commandMode ? 'Enter 실행 · ⌘P 파일' : 'Enter 미리보기 · ⌘Enter 첨부 · ⌘⇧P 명령'}
        </p>
      </section>
    </div>
  );
}
