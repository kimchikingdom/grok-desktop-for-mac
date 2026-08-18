import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GROK_USAGE_URL } from '@grok-desktop/shared';
import { useStore } from '../store.js';
import { ApprovalCard } from './ApprovalCard.js';
import { Markdown } from './Markdown.js';
import { ToolCard } from './ToolCard.js';
import { VirtualList, type VirtualLayout } from './VirtualList.js';
import type { ChatItem } from '../store.js';
import { splitLinkableText } from '../path-links.js';
import { activeTurnIndex, findChatHits, offsetForId, turnMarksFromItems, type TurnMark } from '../turn-nav.js';

const SAMPLES = [
  '이 프로젝트 구조를 설명해줘',
  'src 폴더에서 인증 관련 코드를 찾아줘',
  'README에 설치 방법 섹션을 추가해줘',
];

function recoveryFor(code: string): Array<'restart' | 'relogin' | 'usage'> {
  if (code === 'auth-required') return ['relogin', 'restart'];
  if (code === 'quota-exceeded') return ['usage', 'relogin'];
  if (code === 'agent-exited' || code === 'timeout' || code === 'network' || code === 'prompt-failed') {
    return ['restart'];
  }
  return [];
}

export function ChatStream({ source = 'primary' }: { source?: 'primary' | 'split' }): React.JSX.Element {
  const primaryItems = useStore((state) => state.items);
  const splitItems = useStore((state) => state.splitItems);
  const allItems = source === 'split' ? splitItems : primaryItems;
  const viewMode = useStore((state) => state.viewMode);
  const rewindTo = useStore((state) => state.rewindTo);
  const editUserMessage = useStore((state) => state.editUserMessage);
  const items =
    viewMode === 'summary'
      ? allItems.filter(
          (item) =>
            item.kind === 'user' ||
            item.kind === 'message' ||
            item.kind === 'error' ||
            item.kind === 'permission',
        )
      : viewMode === 'normal'
        ? allItems.filter((item) => item.kind !== 'tool' || item.call.status !== 'completed')
        : allItems;
  const primaryStatus = useStore((state) => state.status);
  const splitStatus = useStore((state) => state.splitStatus);
  const status = source === 'split' ? splitStatus : primaryStatus;
  const send = useStore((state) => state.send);
  const dropFiles = useStore((state) => state.dropFiles);
  const session = useStore((state) => state.session);
  const regenerate = useStore((state) => state.regenerate);
  const copyLastAnswer = useStore((state) => state.copyLastAnswer);
  const continuePlan = useStore((state) => state.continuePlan);
  const setViewMode = useStore((state) => state.setViewMode);
  const storeFollow = useStore((state) => state.followOutput);
  const setStoreFollow = useStore((state) => state.setFollowOutput);
  const [splitFollow, setSplitFollow] = useState(true);
  const followOutput = source === 'split' ? splitFollow : storeFollow;
  const setFollowOutput = source === 'split' ? setSplitFollow : setStoreFollow;
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<VirtualLayout>({ keys: [], offsets: [], total: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const pendingJump = useRef<string | null>(null);
  const jumping = useRef(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const findHits = useMemo(() => findChatHits(items, findQuery), [findQuery, items]);
  const marks = useMemo(() => turnMarksFromItems(items), [items]);
  const active = activeTurnIndex(marks, layout.keys, layout.offsets, scrollTop, viewport);
  const getKey = useCallback((item: ChatItem) => item.id, []);
  const estimateSize = useCallback(
    (item: ChatItem) => (item.kind === 'user' ? 88 : item.kind === 'tool' ? 72 : 160),
    [],
  );
  const onLayout = useCallback((next: VirtualLayout) => {
    setLayout((prev) =>
      prev.total === next.total &&
      prev.keys.length === next.keys.length &&
      prev.keys.every((key, index) => key === next.keys[index]) &&
      prev.offsets.every((offset, index) => offset === next.offsets[index])
        ? prev
        : next,
    );
  }, []);

  const scrollToOffset = useCallback((top: number, smooth: boolean) => {
    const node = streamRef.current;
    if (!node) return;
    const pad = Number.parseFloat(getComputedStyle(node).paddingTop) || 0;
    jumping.current = true;
    node.scrollTo({ top: Math.max(0, top + pad - 12), behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  const jumpTo = useCallback(
    (id: string) => {
      const top = offsetForId(layout.keys, layout.offsets, id);
      if (top === undefined) return;
      pendingJump.current = id;
      setFollowOutput(false);
      scrollToOffset(top, true);
    },
    [layout.keys, layout.offsets, scrollToOffset, setFollowOutput],
  );

  const jumpRelative = useCallback(
    (delta: number) => {
      if (marks.length === 0) return;
      const next = Math.min(marks.length - 1, Math.max(0, (active < 0 ? 0 : active) + delta));
      const mark = marks[next];
      if (mark) jumpTo(mark.id);
    },
    [active, jumpTo, marks],
  );

  const lastText =
    [...items].reverse().find((item) => item.kind === 'message' && item.channel === 'answer')?.kind === 'message'
      ? [...items].reverse().find((item) => item.kind === 'message' && item.channel === 'answer')
      : null;
  const streamTail = lastText && lastText.kind === 'message' ? lastText.text.length : 0;

  useEffect(() => {
    if (!followOutput) return;
    bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [items.length, streamTail, status, followOutput]);

  useEffect(() => {
    const node = streamRef.current;
    if (!node) return;
    const sync = () => {
      setScrollTop(node.scrollTop);
      setViewport(node.clientHeight);
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setLayout({ keys: [], offsets: [], total: 0 });
    setScrollTop(0);
    pendingJump.current = null;
    setFindOpen(false);
    setFindQuery('');
    setFindIndex(0);
  }, [session?.id, source]);

  useEffect(() => {
    const id = pendingJump.current;
    if (!id) return;
    const top = offsetForId(layout.keys, layout.offsets, id);
    if (top === undefined) return;
    scrollToOffset(top, false);
  }, [layout, scrollToOffset]);

  const jumpedApproval = useRef<string | null>(null);
  useEffect(() => {
    if (source !== 'primary' || status !== 'waiting-approval') {
      if (status !== 'waiting-approval') jumpedApproval.current = null;
      return;
    }
    const pending = [...items].reverse().find((item) => item.kind === 'permission' && !item.decision);
    if (!pending || jumpedApproval.current === pending.id) return;
    jumpedApproval.current = pending.id;
    jumpTo(pending.id);
  }, [items, jumpTo, source, status]);

  useEffect(() => {
    if (source !== 'primary') return;
    const onFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.key.toLowerCase() !== 'f') return;
      const state = useStore.getState();
      if (state.settingsOpen || state.shortcutsOpen || state.confirm || state.fileSwitcherOpen) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          '.file-preview, .side-ask, .session-search, .session-rename, .review-panel, .modal, .quick-open, [data-session-search]',
        )
      ) {
        return;
      }
      event.preventDefault();
      setFindOpen(true);
      queueMicrotask(() => findInputRef.current?.focus());
    };
    window.addEventListener('keydown', onFind);
    return () => window.removeEventListener('keydown', onFind);
  }, [source]);

  useEffect(() => {
    if (!findOpen) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setFindOpen(false);
      setFindQuery('');
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [findOpen]);

  useEffect(() => {
    if (source !== 'primary') return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.isComposing) return;
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (marks.length < 2) return;
      const state = useStore.getState();
      if (state.settingsOpen || state.shortcutsOpen || state.confirm) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      jumpRelative(event.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [jumpRelative, marks.length, source]);

  return (
    <div
      className="chat-stream-shell"
      onDragOver={(event) => {
        if (
          event.dataTransfer.types.includes('Files') ||
          event.dataTransfer.types.includes('application/x-grok-relpath') ||
          event.dataTransfer.types.includes('text/plain')
        ) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const relPath = event.dataTransfer.getData('application/x-grok-relpath');
        if (relPath) {
          useStore.getState().attachFromTree(relPath);
          return;
        }
        if (event.dataTransfer.files.length > 0) void dropFiles([...event.dataTransfer.files]);
      }}
    >
    {source === 'primary' && findOpen ? (
      <form
        className="chat-find"
        onSubmit={(event) => {
          event.preventDefault();
          if (findHits.length === 0) return;
          const next = (findIndex + 1) % findHits.length;
          setFindIndex(next);
          const id = findHits[next];
          if (id) jumpTo(id);
        }}
      >
        <input
          ref={findInputRef}
          value={findQuery}
          autoFocus
          placeholder="대화에서 찾기"
          aria-label="대화에서 찾기"
          onChange={(event) => {
            const value = event.target.value;
            setFindQuery(value);
            setFindIndex(0);
            const hit = findChatHits(items, value)[0];
            if (hit) jumpTo(hit);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setFindOpen(false);
              setFindQuery('');
            }
            if (event.key === 'Enter' && event.shiftKey) {
              event.preventDefault();
              if (findHits.length === 0) return;
              const next = (findIndex - 1 + findHits.length) % findHits.length;
              setFindIndex(next);
              const id = findHits[next];
              if (id) jumpTo(id);
            }
          }}
        />
        <span className="muted small">
          {findQuery.trim() ? `${findHits.length === 0 ? 0 : findIndex + 1}/${findHits.length}` : ''}
        </span>
        <button type="submit" className="link" disabled={findHits.length === 0}>
          다음
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setFindOpen(false);
            setFindQuery('');
          }}
        >
          닫기
        </button>
      </form>
    ) : null}
    {source === 'primary' && allItems.length > 0 ? (
      <div className="chat-toolbar">
        <div className="view-density" role="tablist" aria-label="보기 밀도">
          {(
            [
              { id: 'summary', label: '요약' },
              { id: 'normal', label: '보통' },
              { id: 'verbose', label: '자세히' },
            ] as const
          ).map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              className={viewMode === entry.id ? 'active' : ''}
              aria-selected={viewMode === entry.id}
              onClick={() => setViewMode(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>
    ) : null}
    <div
      className="chat-stream"
      ref={streamRef}
      aria-live="polite"
      onScroll={() => {
        const node = streamRef.current;
        if (!node) return;
        if (jumping.current) jumping.current = false;
        else pendingJump.current = null;
        setScrollTop(node.scrollTop);
        setViewport(node.clientHeight);
        const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        setFollowOutput(atBottom);
      }}
    >
      {allItems.length === 0 && source === 'split' ? (
        <p className="muted small">이 대화는 비어 있습니다.</p>
      ) : null}

      {allItems.length === 0 && source === 'primary' ? (
        <div className="empty">
          <h2>무엇을 도와드릴까요?</h2>
          <ul className="samples">
            {SAMPLES.map((sample) => (
              <li key={sample}>
                <button type="button" disabled={!session} onClick={() => void send(sample, [])}>
                  {sample}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {items.length > 0 ? (
        <VirtualList
          items={items}
          scrollRef={streamRef}
          getKey={getKey}
          estimateSize={estimateSize}
          onLayout={onLayout}
          renderItem={(item) =>
            renderChatItem(
              item,
              rewindTo,
              editUserMessage,
              continuePlan,
              source === 'primary',
              findQuery,
              findHits[findIndex],
            )
          }
        />
      ) : null}

      {source === 'primary' && status === 'idle' && items.some((item) => item.kind === 'user') ? (
        <div className="message-actions trail">
          <button type="button" className="link" onClick={() => void copyLastAnswer()}>
            답변 복사
          </button>
          <button type="button" className="link" onClick={() => void regenerate()}>
            다시 생성
          </button>
        </div>
      ) : null}

      {status === 'waiting-approval' ? (
        <p className="running-row" role="alert">
          {source === 'split'
            ? '이 대화가 승인을 기다립니다. 앞으로를 눌러 여기서 처리하세요.'
            : 'Y 한 번 허용 · S 세션 허용 · N 거부'}
        </p>
      ) : null}

      {status === 'running' ? (
        <p className="running-row">
          <span className="dots" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Grok이 작업 중입니다
        </p>
      ) : null}
      {status === 'failed' ? (
        <section className="card error">
          <h3>연결이 끊겼습니다</h3>
          <p>이전 대화는 남아 있습니다. 다시 연결하면 이어서 요청할 수 있습니다.</p>
          <ReconnectButton />
        </section>
      ) : null}
      <div ref={bottomRef} />
      {!followOutput && allItems.length > 0 ? (
        <button
          type="button"
          className="jump-latest"
          onClick={() => {
            setFollowOutput(true);
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
        >
          최신으로
        </button>
      ) : null}
    </div>
    {marks.length >= 2 ? (
      <TurnRail
        marks={marks}
        active={active}
        layout={layout}
        scrollTop={scrollTop}
        viewport={viewport}
        onJump={jumpTo}
        onStep={jumpRelative}
      />
    ) : null}
    </div>
  );
}

function TurnRail({
  marks,
  active,
  layout,
  scrollTop,
  viewport,
  onJump,
  onStep,
}: {
  marks: TurnMark[];
  active: number;
  layout: VirtualLayout;
  scrollTop: number;
  viewport: number;
  onJump: (id: string) => void;
  onStep: (delta: number) => void;
}): React.JSX.Element {
  const span = Math.max(layout.total, 1);
  const thumbTop = Math.min(100, Math.max(0, (scrollTop / span) * 100));
  const thumbHeight = Math.min(100, Math.max(6, (viewport / span) * 100));
  return (
    <nav className="turn-rail" aria-label="대화 위치">
      <button type="button" className="turn-step" title="이전 (⌥↑)" aria-label="이전 메시지로" onClick={() => onStep(-1)}>
        ↑
      </button>
      <div className="turn-track">
        <span className="turn-thumb" style={{ top: `${thumbTop}%`, height: `${thumbHeight}%` }} />
        {marks.map((mark, index) => {
          const top = offsetForId(layout.keys, layout.offsets, mark.id) ?? 0;
          return (
            <button
              key={mark.id}
              type="button"
              className={`turn-tick ${mark.kind}${index === active ? ' active' : ''}`}
              style={{ top: `${(top / span) * 100}%` }}
              title={mark.label}
              aria-label={`${index + 1}번째 ${mark.kind === 'user' ? '질문' : mark.kind === 'answer' ? '답변' : '오류'}: ${mark.label}`}
              aria-current={index === active ? 'true' : undefined}
              onClick={() => onJump(mark.id)}
            />
          );
        })}
      </div>
      <button type="button" className="turn-step" title="다음 (⌥↓)" aria-label="다음 메시지로" onClick={() => onStep(1)}>
        ↓
      </button>
    </nav>
  );
}

function UserText({ text }: { text: string }): React.JSX.Element {
  const previewFile = useStore((state) => state.previewFile);
  return (
    <>
      {splitLinkableText(text).map((part, index) =>
        part.relPath ? (
          <button
            key={`${part.relPath}-${index}`}
            type="button"
            className="path-link on-user"
            title={`${part.relPath} 미리보기`}
            onClick={() => void previewFile(part.relPath ?? '', part.line)}
          >
            {part.value}
          </button>
        ) : (
          <span key={`t-${index}`}>{part.value}</span>
        ),
      )}
    </>
  );
}

function renderChatItem(
  item: ChatItem,
  rewindTo: (id: string) => Promise<void>,
  editUserMessage: (id: string) => Promise<void>,
  continuePlan: () => Promise<void>,
  interactive: boolean,
  findQuery: string,
  currentFindId?: string,
): React.JSX.Element | null {
  const findClass =
    findQuery.trim() &&
    ((item.kind === 'user' || item.kind === 'message') && item.text.toLowerCase().includes(findQuery.trim().toLowerCase())
      ? item.id === currentFindId
        ? ' find-current'
        : ' find-hit'
      : item.kind === 'error' && item.message.toLowerCase().includes(findQuery.trim().toLowerCase())
        ? item.id === currentFindId
          ? ' find-current'
          : ' find-hit'
        : '');
  switch (item.kind) {
    case 'user':
      return (
        <div className={`bubble user${findClass}`}>
          <UserText text={item.text} />
          {item.attachments && item.attachments.length > 0 ? (
            <ul className="bubble-files">
              {item.attachments.map((relPath) => (
                <li key={relPath}>
                  <UserText text={relPath} />
                </li>
              ))}
            </ul>
          ) : null}
          {interactive ? (
            <div className="message-actions">
              <button type="button" className="link" onClick={() => void editUserMessage(item.id)}>
                수정
              </button>
              <button type="button" className="link" onClick={() => void rewindTo(item.id)}>
                여기까지 되돌리기
              </button>
            </div>
          ) : null}
        </div>
      );
    case 'message':
      return item.channel === 'thought' ? (
        <details className="thought">
          <summary>생각 과정</summary>
          <Markdown>{item.text}</Markdown>
        </details>
      ) : (
        <div className={`bubble agent${findClass}`}>
          <Markdown>{item.text}</Markdown>
          <div className="message-actions">
            <button type="button" className="link" onClick={() => void navigator.clipboard.writeText(item.text)}>
              복사
            </button>
          </div>
        </div>
      );
    case 'tool':
      return <ToolCard call={item.call} />;
    case 'permission':
      return <ApprovalCard request={item.request} decision={item.decision} interactive={interactive} />;
    case 'plan':
      return (
        <section className="card plan">
          <h3>작업 계획</h3>
          <ol>
            {item.entries.map((entry, index) => (
              <li key={`${item.id}-${index}`} className={entry.status}>
                {entry.content}
              </li>
            ))}
          </ol>
          {interactive ? (
            <button type="button" className="primary" onClick={() => void continuePlan()}>
              이 계획으로 진행
            </button>
          ) : null}
        </section>
      );
    case 'subagent':
      return (
        <section className={`card task-card ${item.status}`}>
          <h3>서브에이전트 · {item.title}</h3>
          <p className="muted small">{item.status === 'running' ? '실행 중' : item.status === 'failed' ? '실패' : '완료'}</p>
          {item.detail ? <p>{item.detail}</p> : null}
        </section>
      );
    case 'task':
      return (
        <section className={`card task-card ${item.status}`}>
          <h3>백그라운드 · {item.title}</h3>
          <p className="muted small">{item.status === 'running' ? '실행 중' : '완료'}</p>
        </section>
      );
    case 'error':
      return (
        <div className={findClass.trim()}>
          <ErrorCard code={item.code} message={item.message} detail={item.detail} />
        </div>
      );
    default:
      return null;
  }
}

function ReconnectButton(): React.JSX.Element {
  const restartSession = useStore((state) => state.restartSession);
  const busy = useStore((state) => state.busy);
  return (
    <div className="actions">
      <button type="button" className="primary" onClick={() => void restartSession()} disabled={busy}>
        다시 연결
      </button>
    </div>
  );
}

function ErrorCard({
  code,
  message,
  detail,
}: {
  code: string;
  message: string;
  detail?: string;
}): React.JSX.Element {
  const restartSession = useStore((state) => state.restartSession);
  const startLogin = useStore((state) => state.startLogin);
  const openExternal = useStore((state) => state.openExternal);
  const busy = useStore((state) => state.busy);
  const actions = recoveryFor(code);

  return (
    <section className="card error">
      <h3>문제가 발생했습니다</h3>
      <p>{message}</p>
      {detail ? <pre className="terminal">{detail}</pre> : null}
      <p className="muted">코드: {code}</p>
      {actions.length > 0 ? (
        <div className="actions">
          {actions.includes('restart') ? (
            <button type="button" className="primary" onClick={() => void restartSession()} disabled={busy}>
              다시 연결
            </button>
          ) : null}
          {actions.includes('relogin') ? (
            <button type="button" onClick={() => void startLogin()} disabled={busy}>
              다시 로그인
            </button>
          ) : null}
          {actions.includes('usage') ? (
            <button type="button" className="link" onClick={() => void openExternal(GROK_USAGE_URL)}>
              사용량 보기
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
