import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|mp4|webm)$/i;

export function MediaView({ src, alt }: { src: string; alt: string }): React.JSX.Element | null {
  const workspace = useStore((state) => state.workspace);
  const [dataUrl, setDataUrl] = useState<string | null>(
    /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) ? src : null,
  );
  const [kind, setKind] = useState<'image' | 'video'>(src.includes('video') || /\.(mp4|webm)$/i.test(src) ? 'video' : 'image');

  useEffect(() => {
    if (src.startsWith('data:') || src.startsWith('https://')) {
      const allowed = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src);
      setDataUrl(allowed ? src : null);
      return;
    }
    if (!workspace || !MEDIA_EXT.test(src)) return;
    let cancelled = false;
    void window.grokDesktop.workspace
      .readMedia({ workspaceId: workspace.id, relPath: src.replace(/^\.\//, '') })
      .then((preview) => {
        if (cancelled) return;
        setDataUrl(preview.dataUrl);
        setKind(preview.mimeType.startsWith('video/') ? 'video' : 'image');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [src, workspace]);

  if (src.startsWith('https://')) {
    return <span className="muted small">{alt || src}</span>;
  }
  if (!dataUrl) return alt ? <span className="muted small">{alt}</span> : null;
  if (kind === 'video') {
    return <video className="inline-media" src={dataUrl} controls />;
  }
  return (
    <button
      type="button"
      className="media-open"
      title="크게 보기"
      onClick={() => useStore.getState().openMediaLightbox({ src: dataUrl, alt })}
    >
      <img className="inline-media" src={dataUrl} alt={alt} />
    </button>
  );
}
