import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { FileHit, PromptToolFlag, WorkMode } from '@grok-desktop/shared';
import { resolveComposerAction } from '../composer-keys.js';
import { IconClose, IconFile, IconPlus, IconSend, IconStop } from '../icons.js';
import { MediaView } from './MediaView.js';
import {
  filterSlashCommands,
  groupedSlashCommands,
  modeForSlash,
  parseLeadingSlash,
  slashQueryFromDraft,
  toolForSlash,
  type SlashCommand,
} from '../slash-commands.js';
import { useStore } from '../store.js';

function extractMentions(text: string): string[] {
  return [...text.matchAll(/@([\w./-]+)/g)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

const MODES: { id: WorkMode; label: string; hint: string }[] = [
  { id: 'ask', label: '질문', hint: '읽기 전용으로 질문에 답합니다.' },
  { id: 'plan', label: '계획', hint: '변경 없이 계획만 제시합니다.' },
  { id: 'agent', label: '에이전트', hint: '승인을 받아 파일을 수정하고 명령을 실행합니다.' },
];

const TOOL_CHIPS: { id: PromptToolFlag; label: string; hint: string }[] = [
  { id: 'think', label: '깊게 생각', hint: '이번 한 턴만 추론을 먼저 정리합니다.' },
  { id: 'deep-research', label: '조사', hint: '이번 한 턴만 심층 조사를 켭니다.' },
  { id: 'imagine', label: '이미지', hint: '이번 한 턴만 이미지를 생성합니다.' },
  { id: 'imagine-video', label: '영상', hint: '이번 한 턴만 영상을 생성합니다.' },
];

export function Composer(): React.JSX.Element {
  const text = useStore((state) => state.draft);
  const setText = useStore((state) => state.setDraft);
  const slashQuery = slashQueryFromDraft(text);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentions, setMentions] = useState<FileHit[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const voiceBaseRef = useRef('');
  const send = useStore((state) => state.send);
  const enqueue = useStore((state) => state.enqueue);
  const removeQueued = useStore((state) => state.removeQueued);
  const restoreQueued = useStore((state) => state.restoreQueued);
  const promoteQueued = useStore((state) => state.promoteQueued);
  const sendQueuedNow = useStore((state) => state.sendQueuedNow);
  const cancel = useStore((state) => state.cancel);
  const status = useStore((state) => state.status);
  const session = useStore((state) => state.session);
  const workspace = useStore((state) => state.workspace);
  const queue = useStore((state) => state.queue);
  const attachments = useStore((state) => state.attachments);
  const tools = useStore((state) => state.tools);
  const addAttachments = useStore((state) => state.addAttachments);
  const removeAttachment = useStore((state) => state.removeAttachment);
  const toggleTool = useStore((state) => state.toggleTool);
  const pickAttachments = useStore((state) => state.pickAttachments);
  const dropFiles = useStore((state) => state.dropFiles);
  const pasteImages = useStore((state) => state.pasteImages);
  const mode = useStore((state) => state.mode);
  const setMode = useStore((state) => state.setMode);
  const newSession = useStore((state) => state.newSession);
  const deleteSession = useStore((state) => state.deleteSession);
  const renameSession = useStore((state) => state.renameSession);
  const exportConversation = useStore((state) => state.exportConversation);
  const copyLastAnswer = useStore((state) => state.copyLastAnswer);
  const setShortcutsOpen = useStore((state) => state.setShortcutsOpen);
  const forkSession = useStore((state) => state.forkSession);
  const askConfirm = useStore((state) => state.askConfirm);
  const continuePlan = useStore((state) => state.continuePlan);
  const items = useStore((state) => state.items);
  const sideAskOpen = useStore((state) => state.sideAskOpen);
  const setSideAskOpen = useStore((state) => state.setSideAskOpen);
  const sideAsk = useStore((state) => state.sideAsk);
  const [sideDraft, setSideDraft] = useState('');
  const sideRef = useRef<HTMLTextAreaElement>(null);
  const plan = [...items].reverse().find((item) => item.kind === 'plan');
  const busy = status === 'running' || status === 'waiting-approval';
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const showToolChips = toolsOpen || tools.length > 0;

  useLayoutEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 240)}px`;
  }, [text]);

  useEffect(() => {
    const token = text.match(/(?:^|\s)@([\w./-]*)$/);
    if (!token || !workspace) {
      setMentions([]);
      return;
    }
    const query = token[1] ?? '';
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void window.grokDesktop.workspace
        .searchFiles({ workspaceId: workspace.id, query, limit: 8 })
        .then((hits) => {
          if (cancelled) return;
          if (!query) {
            const recents = useStore.getState().recentFiles.map((relPath) => ({
              relPath,
              name: relPath.split('/').pop() ?? relPath,
            }));
            const seen = new Set(recents.map((hit) => hit.relPath));
            setMentions([...recents, ...hits.filter((hit) => !seen.has(hit.relPath))].slice(0, 8));
          } else {
            setMentions(hits);
          }
          setMentionIndex(0);
        })
        .catch(() => {
          if (!cancelled) setMentions([]);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text, workspace]);

  useEffect(() => {
    const Speech = (window as Window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    setVoiceSupported(typeof Speech === 'function');
    return () => recognitionRef.current?.stop();
  }, []);

  const slashMatches = slashQuery === null ? [] : filterSlashCommands(slashQuery);
  const slashGroups = groupedSlashCommands(slashMatches);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  useEffect(() => {
    if (!sideAskOpen) return;
    setSideDraft('');
    queueMicrotask(() => sideRef.current?.focus());
  }, [sideAskOpen]);

  useEffect(() => {
    const root = paletteRef.current;
    const selected = root?.querySelector<HTMLButtonElement>('button[aria-selected="true"]');
    if (!root || !selected) return;
    const rootBox = root.getBoundingClientRect();
    const itemBox = selected.getBoundingClientRect();
    if (itemBox.top < rootBox.top) root.scrollTop -= rootBox.top - itemBox.top;
    else if (itemBox.bottom > rootBox.bottom) root.scrollTop += itemBox.bottom - rootBox.bottom;
  }, [slashIndex, slashQuery]);

  const applySlash = (command: SlashCommand, executeLocal = false) => {
    setSlashIndex(0);
    if (command.local && executeLocal && !command.needsRest) {
      setText('');
      void runLocalCommand(command.id, '');
      return;
    }
    setText(`${command.title} `);
    textareaRef.current?.focus();
  };

  const applyMention = (hit: FileHit) => {
    setText(text.replace(/(?:^|\s)@([\w./-]*)$/, (chunk) => `${chunk.startsWith(' ') ? ' ' : ''}@${hit.relPath} `));
    addAttachments([hit.relPath]);
    setMentions([]);
    textareaRef.current?.focus();
  };

  const runLocalCommand = async (id: string, rest: string) => {
    const mode = modeForSlash(id);
    if (mode) {
      setMode(mode);
      return;
    }
    switch (id) {
      case 'new':
        await newSession();
        return;
      case 'delete':
        if (session && (await askConfirm('대화 삭제', '이 대화를 삭제할까요?'))) await deleteSession(session.id);
        return;
      case 'export':
        await exportConversation();
        return;
      case 'copy':
        await copyLastAnswer();
        return;
      case 'help':
        setShortcutsOpen(true);
        return;
      case 'fork':
        await forkSession();
        return;
      case 'review':
        void useStore.getState().setReviewOpen(true);
        return;
      case 'open':
        useStore.getState().setFileSwitcherOpen(true);
        return;
      case 'btw':
        if (!rest.trim()) {
          useStore.getState().setSideAskOpen(true);
          return;
        }
        useStore.getState().sideAsk(rest);
        return;
      case 'rename':
        if (!rest.trim()) {
          useStore.getState().notify('/rename 뒤에 새 이름을 적어 주세요.', 'warn');
          setText('/rename ');
          return;
        }
        if (session) await renameSession(session.id, rest);
        return;
      default:
        return;
    }
  };

  const commit = (action: 'send' | 'queue') => {
    const trimmed = text.trim();
    if (!trimmed || !session) return;
    const parsed = parseLeadingSlash(trimmed);
    if (parsed) {
      const local = filterSlashCommands(parsed.id).find((entry) => entry.id === parsed.id && entry.local);
      if (local) {
        setText('');
        void runLocalCommand(parsed.id, parsed.rest);
        return;
      }
    }
    const mentioned = extractMentions(trimmed);
    const nextAttachments = [...new Set([...attachments, ...mentioned])];
    const nextTools = [...tools];
    const slashTool = parsed ? toolForSlash(parsed.id) : undefined;
    if (slashTool && !nextTools.includes(slashTool)) nextTools.push(slashTool);
    if (action === 'queue') {
      enqueue(trimmed, nextAttachments, nextTools);
      setText('');
      setMentions([]);
      return;
    }
    const sessionId = session.id;
    setText('');
    setMentions([]);
    void send(trimmed, nextAttachments, nextTools).then((ok) => {
      if (ok) return;
      const state = useStore.getState();
      if (state.session?.id !== sessionId) return;
      if (!state.draft.trim()) setText(trimmed);
      if (nextAttachments.length > 0) addAttachments(nextAttachments);
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && (slashQuery !== null || mentions.length > 0)) {
      event.preventDefault();
      event.stopPropagation();
      if (slashQuery !== null) setText('');
      setMentions([]);
      return;
    }
    if (slashMatches.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault();
      if (event.key === 'ArrowDown') setSlashIndex((index) => (index + 1) % slashMatches.length);
      else if (event.key === 'ArrowUp') setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
      else {
        const selected = slashMatches[slashIndex] ?? slashMatches[0];
        if (selected) applySlash(selected, false);
      }
      return;
    }
    if (mentions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Tab' || event.key === 'Enter')) {
      event.preventDefault();
      if (event.key === 'ArrowDown') setMentionIndex((index) => (index + 1) % mentions.length);
      else if (event.key === 'ArrowUp') setMentionIndex((index) => (index - 1 + mentions.length) % mentions.length);
      else {
        const selected = mentions[mentionIndex] ?? mentions[0];
        if (selected) applyMention(selected);
      }
      return;
    }

    const action = resolveComposerAction({
      key: event.key,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      isComposing: event.nativeEvent.isComposing,
      busy,
    });

    if (action === 'ignore' || action === 'newline') return;
    event.preventDefault();
    commit(action);
  };

  const toggleVoice = () => {
    const SpeechRecognition =
      (window as Window & { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      useStore.getState().notify('이 환경에서는 받아쓰기를 사용할 수 없습니다.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'ko-KR';
    recognition.continuous = false;
    recognition.interimResults = true;
    voiceBaseRef.current = text;
    recognition.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
      const last = event.results[event.results.length - 1];
      const piece = last?.[0]?.transcript;
      if (piece) setText(`${voiceBaseRef.current}${voiceBaseRef.current ? ' ' : ''}${piece}`.trim());
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
  };

  return (
    <div
      className={`composer${dropping ? ' dropping' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        const relPath = event.dataTransfer.getData('application/x-grok-relpath');
        if (relPath) {
          addAttachments([relPath]);
          return;
        }
        if (event.dataTransfer.files.length > 0) void dropFiles([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        if (event.clipboardData.getData('text/plain').trim()) return;
        const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
        if (images.length === 0) return;
        event.preventDefault();
        void pasteImages(images);
      }}
    >
      {plan && plan.kind === 'plan' ? (
        <div className="plan-bar">
          <span>
            계획 {plan.entries.filter((entry) => entry.status === 'completed').length}/{plan.entries.length}
          </span>
          <button type="button" className="link" onClick={() => void continuePlan()}>
            이 계획으로 진행
          </button>
        </div>
      ) : null}
      {sideAskOpen ? (
        <form
          className="side-ask"
          onSubmit={(event) => {
            event.preventDefault();
            if (sideDraft.trim()) sideAsk(sideDraft);
          }}
        >
          <header>
            <strong>옆 질문</strong>
            <span className="muted small">본 작업은 그대로 둡니다</span>
            <button type="button" className="link" onClick={() => setSideAskOpen(false)}>
              닫기
            </button>
          </header>
          <textarea
            ref={sideRef}
            value={sideDraft}
            rows={2}
            placeholder="지금 하던 일을 끊지 않고 물어볼 내용"
            onChange={(event) => setSideDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (sideDraft.trim()) sideAsk(sideDraft);
              }
            }}
          />
          <button type="submit" className="primary" disabled={!sideDraft.trim()}>
            묻기
          </button>
        </form>
      ) : null}
      {queue.length > 0 ? (
        <ul className="queue" aria-label="대기 중인 요청">
          {queue.map((item, index) => (
            <li key={item.id}>
              <span className="queue-index">{index + 1}</span>
              <button
                type="button"
                className="queue-text link"
                onClick={() => restoreQueued(item.id)}
                title="입력창으로 되돌리기"
              >
                {item.sideAsk ? `옆 질문: ${item.text}` : item.text}
              </button>
              {index > 0 ? (
                <button
                  type="button"
                  className="icon-btn"
                  title="맨 앞으로"
                  aria-label="맨 앞으로"
                  onClick={() => promoteQueued(item.id)}
                >
                  ↑
                </button>
              ) : null}
              <button
                type="button"
                className="icon-btn"
                title={busy ? '다음으로 보내기' : '지금 보내기'}
                aria-label={busy ? '다음으로 보내기' : '지금 보내기'}
                onClick={() => sendQueuedNow(item.id)}
              >
                ▶
              </button>
              <button type="button" className="icon-btn" onClick={() => removeQueued(item.id)} aria-label="대기열에서 제거">
                <IconClose size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="composer-stack">
        {slashQuery !== null ? (
          <div className="slash-palette" ref={paletteRef} role="listbox" aria-label="슬래시 명령">
            <header className="slash-palette-head">
              <strong>명령</strong>
              <span className="muted small">↑↓ 이동 · Enter 선택 · Esc 닫기</span>
            </header>
            {slashGroups.length === 0 ? (
              <p className="muted small slash-empty">일치하는 명령이 없습니다.</p>
            ) : null}
            {slashGroups.map((group) => (
              <section key={group.id} className="slash-group">
                <h3>{group.label}</h3>
                <ul className="suggest">
                  {group.items.map((command) => {
                    const index = slashMatches.findIndex((entry) => entry.id === command.id);
                    return (
                      <li key={command.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={index === slashIndex}
                          className={index === slashIndex ? 'active' : ''}
                          onMouseEnter={() => setSlashIndex(index)}
                          onClick={() => applySlash(command, Boolean(command.local))}
                        >
                          <strong>{command.title}</strong>
                          <span className="muted">{command.hint}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        ) : null}

        {mentions.length > 0 ? (
          <ul className="suggest mention-palette" role="listbox" aria-label="파일 제안">
            {mentions.map((hit, index) => (
              <li key={hit.relPath}>
                <button type="button" className={index === mentionIndex ? 'active' : ''} onClick={() => applyMention(hit)}>
                  <strong>@{hit.name}</strong>
                  <span className="muted">{hit.relPath}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="composer-box">
        {attachments.length > 0 ? (
          <ul className="attach-chips" aria-label="첨부 파일">
            {attachments.map((relPath) => (
              <li key={relPath}>
                {/\.(png|jpe?g|gif|webp)$/i.test(relPath) ? (
                  <MediaView src={relPath} alt={relPath} />
                ) : (
                  <IconFile size={12} />
                )}
                <span>{relPath}</span>
                <button type="button" className="icon-btn" aria-label={`${relPath} 제거`} onClick={() => removeAttachment(relPath)}>
                  <IconClose size={11} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            if (event.clipboardData.getData('text/plain').trim()) return;
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
            if (images.length === 0) return;
            event.preventDefault();
            void pasteImages(images);
          }}
          placeholder={busy ? '실행 중에도 이어서 적으면 대기열에 넣습니다' : '무엇이든 물어보세요'}
          rows={2}
          disabled={!session}
        />

        <div className="composer-actions">
          <div className="composer-tools">
            <button type="button" className="icon-btn" title="파일 첨부" aria-label="파일 첨부" onClick={() => void pickAttachments()}>
              <IconPlus size={15} />
            </button>
            <button
              type="button"
              className={`icon-btn ${slashQuery !== null ? 'active' : ''}`}
              title="명령 목록"
              aria-label="명령 목록"
              aria-expanded={slashQuery !== null}
              disabled={!session}
              onClick={() => {
                setText(slashQuery === null ? '/' : '');
                textareaRef.current?.focus();
              }}
            >
              /
            </button>
            <button
              type="button"
              className={`chip ${showToolChips ? 'active' : ''}`}
              title="이번 턴 도구"
              aria-expanded={showToolChips}
              onClick={() => setToolsOpen((open) => !open)}
            >
              도구
            </button>
            {showToolChips
              ? TOOL_CHIPS.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`chip ${tools.includes(chip.id) ? 'active' : ''}`}
                    title={chip.hint}
                    aria-pressed={tools.includes(chip.id)}
                    onClick={() => toggleTool(chip.id)}
                  >
                    {chip.label}
                  </button>
                ))
              : null}
            {voiceSupported ? (
              <button
                type="button"
                className={`chip ${listening ? 'active' : ''}`}
                title="받아쓰기"
                aria-pressed={listening}
                onClick={toggleVoice}
              >
                {listening ? '듣는 중' : '받아쓰기'}
              </button>
            ) : null}
          </div>
          <div className="actions">
            <div className="modes composer-modes" role="tablist" aria-label="작업 모드">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === entry.id}
                  className={mode === entry.id ? 'active' : ''}
                  title={entry.hint}
                  onClick={() => setMode(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            {busy ? (
              <>
                <button type="button" onClick={() => commit('queue')} disabled={!text.trim()}>
                  대기열
                </button>
                <button type="button" className="danger stop-btn" onClick={() => void cancel()}>
                  <IconStop size={12} />
                  중단
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary send-btn"
                aria-label="전송"
                onClick={() => commit('send')}
                disabled={!session || !text.trim()}
              >
                <IconSend size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
};
