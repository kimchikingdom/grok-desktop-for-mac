import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

export type VirtualLayout = {
  keys: string[];
  offsets: number[];
  total: number;
};

type VirtualListProps<T> = {
  items: T[];
  getKey: (item: T) => string;
  estimateSize: (item: T) => number;
  renderItem: (item: T) => ReactNode;
  scrollRef: RefObject<HTMLElement | null>;
  overscan?: number;
  onLayout?: (layout: VirtualLayout) => void;
};

export function VirtualList<T>({
  items,
  getKey,
  estimateSize,
  renderItem,
  scrollRef,
  overscan = 800,
  onLayout,
}: VirtualListProps<T>): React.JSX.Element {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const measured = useRef(new Map<string, number>());
  const [, bump] = useState(0);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const onScroll = (event: Event) => {
      const target = event.currentTarget as HTMLElement;
      setScrollTop(target.scrollTop);
    };
    const onResize = () => setViewport(node.clientHeight);
    setViewport(node.clientHeight);
    setScrollTop(node.scrollTop);
    node.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onResize);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollRef]);

  const { offsets, total, start, end } = useMemo(() => {
    const offsets: number[] = [];
    let cursor = 0;
    for (const item of items) {
      offsets.push(cursor);
      cursor += measured.current.get(getKey(item)) ?? estimateSize(item);
    }
    const startPx = Math.max(0, scrollTop - overscan);
    const endPx = scrollTop + viewport + overscan;
    let start = 0;
    let end = items.length;
    for (let index = 0; index < offsets.length; index += 1) {
      const top = offsets[index] ?? 0;
      const bottom = index + 1 < offsets.length ? (offsets[index + 1] ?? cursor) : cursor;
      if (bottom < startPx) start = index + 1;
      if (top > endPx) {
        end = index;
        break;
      }
    }
    return { offsets, total: cursor, start, end };
  }, [estimateSize, getKey, items, overscan, scrollTop, viewport]);

  useEffect(() => {
    onLayout?.({ keys: items.map((item) => getKey(item)), offsets, total });
  }, [getKey, items, offsets, onLayout, total]);

  return (
    <div className="virtual-list" style={{ height: total, position: 'relative' }}>
      {items.slice(start, end).map((item, sliceIndex) => {
        const index = start + sliceIndex;
        const key = getKey(item);
        return (
          <div
            key={key}
            className="virtual-row"
            style={{ position: 'absolute', top: offsets[index] ?? 0, left: 0, right: 0 }}
            ref={(node) => {
              if (!node) return;
              const height = Math.round(node.getBoundingClientRect().height);
              if (height > 0 && measured.current.get(key) !== height) {
                measured.current.set(key, height);
                bump((value) => value + 1);
              }
            }}
          >
            {renderItem(item)}
          </div>
        );
      })}
    </div>
  );
}
