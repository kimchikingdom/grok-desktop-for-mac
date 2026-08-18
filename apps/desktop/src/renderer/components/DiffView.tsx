import { useMemo } from 'react';
import type { DiffPreview } from '@grok-desktop/shared';

type Line = { text: string; type: 'add' | 'del' | 'meta' | 'context' };

function parse(unifiedDiff: string): Line[] {
  return unifiedDiff.split('\n').map((text) => {
    if (text.startsWith('+++') || text.startsWith('---') || text.startsWith('@@') || text.startsWith('Index:')) {
      return { text, type: 'meta' as const };
    }
    if (text.startsWith('+')) return { text, type: 'add' as const };
    if (text.startsWith('-')) return { text, type: 'del' as const };
    return { text, type: 'context' as const };
  });
}

export function DiffView({
  preview,
  view = 'unified',
  onComment,
}: {
  preview: DiffPreview;
  view?: 'unified' | 'split';
  onComment?: (line: string) => void;
}): React.JSX.Element {
  const lines = useMemo(() => parse(preview.unifiedDiff), [preview.unifiedDiff]);

  if (preview.binary) {
    return <p className="muted">바이너리 파일이라 diff를 표시하지 않습니다.</p>;
  }

  if (view === 'split') {
    const left = lines.filter((line) => line.type !== 'add');
    const right = lines.filter((line) => line.type !== 'del');
    return (
      <div className="diff diff-split">
        <pre className="diff-pane">
          {left.map((line, index) => (
            <span
              key={index}
              className={`diff-line ${line.type}${onComment ? ' commentable' : ''}`}
              onClick={() => onComment?.(line.text)}
            >
              {line.text || ' '}
            </span>
          ))}
        </pre>
        <pre className="diff-pane">
          {right.map((line, index) => (
            <span key={index} className={`diff-line ${line.type}`}>
              {line.text || ' '}
            </span>
          ))}
        </pre>
      </div>
    );
  }

  return (
    <pre className="diff">
      {lines.map((line, index) => (
        <span
          key={index}
          className={`diff-line ${line.type}${onComment ? ' commentable' : ''}`}
          onClick={() => onComment?.(line.text)}
        >
          {line.text || ' '}
        </span>
      ))}
    </pre>
  );
}

export function DiffStats({ preview }: { preview: DiffPreview }): React.JSX.Element {
  return (
    <span className="diff-stats">
      <span className="add">+{preview.additions}</span> <span className="del">-{preview.deletions}</span>
      {preview.truncated ? <span className="muted"> (일부만 표시)</span> : null}
    </span>
  );
}
