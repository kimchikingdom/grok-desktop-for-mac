import { useState } from 'react';
import { extractLocalhostUrls, type ToolCallView } from '@grok-desktop/shared';
import { IconChevron, iconForKind } from '../icons.js';
import { MediaView } from './MediaView.js';
import { useStore } from '../store.js';

const STATUS_LABEL: Record<ToolCallView['status'], string> = {
  pending: '대기 중',
  'in-progress': '실행 중',
  completed: '완료',
  failed: '실패',
  denied: '거부됨',
};

export function ToolCard({ call }: { call: ToolCallView }): React.JSX.Element {
  const [open, setOpen] = useState(call.kind === 'execute');
  const [copied, setCopied] = useState<'command' | 'output' | null>(null);
  const hasBody = Boolean(call.output || call.command || call.locations.length > 0);
  const KindIcon = iconForKind(call.kind);
  const previews = extractLocalhostUrls(`${call.output ?? ''}\n${call.command ?? ''}`);
  const openLocalhostPreview = useStore((state) => state.openLocalhostPreview);
  const previewFile = useStore((state) => state.previewFile);
  const copy = async (kind: 'command' | 'output', value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1200);
  };

  return (
    <section className={`card tool status-${call.status}`}>
      <button
        type="button"
        className="tool-header"
        onClick={() => setOpen(!open)}
        disabled={!hasBody}
        aria-expanded={hasBody ? open : undefined}
      >
        <span className="tool-kind" aria-hidden>
          <KindIcon size={14} />
        </span>
        <span className="tool-title">{call.title}</span>
        <span className={`badge ${call.status}`}>{STATUS_LABEL[call.status]}</span>
        {hasBody ? <IconChevron size={12} open={open} /> : null}
      </button>

      {open && hasBody ? (
        <div className="tool-body">
          {call.command ? (
            <div className="command-row">
              <code className="command">{call.command}</code>
              <button type="button" className="link" onClick={() => void copy('command', call.command ?? '')}>
                {copied === 'command' ? '복사됨' : '복사'}
              </button>
            </div>
          ) : null}
          {call.locations.length > 0 ? (
            <ul className="paths">
              {call.locations.map((location) => (
                <li key={location.path} className={location.insideWorkspace ? '' : 'outside'}>
                  {location.insideWorkspace && location.relPath ? (
                    <button
                      type="button"
                      className="path-link"
                      onClick={() => void previewFile(location.relPath ?? '', location.line)}
                    >
                      {location.relPath}
                      {location.line ? `:${location.line}` : ''}
                    </button>
                  ) : (
                    <>
                      {location.relPath ?? location.path}
                      {location.line ? `:${location.line}` : ''}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {call.media && call.media.length > 0 ? (
            <div className="tool-media">
              {call.media.map((entry, index) => (
                <MediaView
                  key={`${entry.relPath ?? entry.dataUrl ?? index}`}
                  src={entry.dataUrl ?? entry.relPath ?? ''}
                  alt={entry.relPath ?? '생성 결과'}
                />
              ))}
            </div>
          ) : null}
          {call.output ? (
            <div className="command-row">
              <pre className="terminal">{call.output}</pre>
              <button type="button" className="link" onClick={() => void copy('output', call.output ?? '')}>
                {copied === 'output' ? '복사됨' : '복사'}
              </button>
            </div>
          ) : null}
          {previews.length > 0 ? (
            <div className="actions">
              {previews.map((url) => (
                <button key={url} type="button" className="link" onClick={() => openLocalhostPreview(url)}>
                  미리보기 {url}
                </button>
              ))}
            </div>
          ) : null}
          {call.exitCode !== undefined ? <p className="muted">종료 코드: {call.exitCode}</p> : null}
          {call.error ? <p className="error-text">{call.error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
