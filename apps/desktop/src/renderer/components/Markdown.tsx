import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStore } from '../store.js';
import { parseWorkspaceRef } from '../path-links.js';
import { MediaView } from './MediaView.js';

/**
 * Agent output is untrusted text: react-markdown is used without rehype-raw, so
 * embedded HTML is escaped rather than rendered, and links never navigate the
 * window — they are handed to the allow-listed external opener.
 */
export function Markdown({ children }: { children: string }): React.JSX.Element {
  const openExternal = useStore((state) => state.openExternal);
  const previewFile = useStore((state) => state.previewFile);
  const openPath = (relPath: string, line?: number) => {
    void previewFile(relPath, line);
  };
  return (
    <div className="markdown">
      <ReactMarkdown
        components={{
          a: ({ href, children: label }) => {
            const parsed = href ? parseWorkspaceRef(href) : null;
            return (
              <a
                href={href || '#'}
                onClick={(event) => {
                  event.preventDefault();
                  if (parsed) openPath(parsed.relPath, parsed.line);
                  else if (href) void openExternal(href);
                }}
              >
                {label}
              </a>
            );
          },
          code: ({ children: value, className }) => {
            if (className) return <code className={className}>{value}</code>;
            const text = flattenCode(value);
            if (text.includes('\n')) return <code>{value}</code>;
            const parsed = parseWorkspaceRef(text);
            if (!parsed) return <code>{value}</code>;
            return (
              <button
                type="button"
                className="path-link"
                title={`${parsed.relPath}${parsed.line ? `:${parsed.line}` : ''} 미리보기`}
                onClick={() => openPath(parsed.relPath, parsed.line)}
              >
                <code>{text}</code>
              </button>
            );
          },
          img: ({ src, alt }) => (src ? <MediaView src={src} alt={alt ?? ''} /> : null),
          pre: ({ children: code }) => <CopyablePre>{code}</CopyablePre>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function flattenCode(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(flattenCode).join('');
  return '';
}

function CopyablePre({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    const text = extractText(children);
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <div className="code-block">
      <button type="button" className="link code-copy" onClick={() => void onCopy()}>
        {copied ? '복사됨' : '복사'}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(extractText).join('');
  if ('props' in node) return extractText((node as { props?: { children?: React.ReactNode } }).props?.children);
  return '';
}
