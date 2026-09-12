import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

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

/**
 * One row. It keeps watching its own height: a row can grow long after it is
 * rendered — a web font lands, an image decodes, someone opens the thought
 * block — and a stale height would let the next row overlap this one's text.
 */
function VirtualRow({
  top,
  measure,
  children,
}: {
  top: number;
  measure: (height: number) => void;
  children: ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(measure);
  latest.current = measure;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const report = () => latest.current(Math.round(node.getBoundingClientRect().height));
    report();
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="virtual-row" style={{ position: 'absolute', top, left: 0, right: 0 }} ref={ref}>
      {children}
    </div>
  );
}

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
  // Heights live in state, not a ref: the offsets below are memoised, and a ref
  // would leave them stale when a row is remeasured without anything else
  // changing — the rows would then overlap.
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());

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

  const remember = useCallback((key: string, height: number) => {
    if (height <= 0) return;
    setMeasured((current) => {
      if (current.get(key) === height) return current;
      const next = new Map(current);
      next.set(key, height);
      return next;
    });
  }, []);

  const { offsets, total, start, end } = useMemo(() => {
    const offsets: number[] = [];
    let cursor = 0;
    for (const item of items) {
      offsets.push(cursor);
      cursor += measured.get(getKey(item)) ?? estimateSize(item);
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
  }, [estimateSize, getKey, items, measured, overscan, scrollTop, viewport]);

  useEffect(() => {
    onLayout?.({ keys: items.map((item) => getKey(item)), offsets, total });
  }, [getKey, items, offsets, onLayout, total]);

  return (
    <div className="virtual-list" style={{ height: total, position: 'relative' }}>
      {items.slice(start, end).map((item, sliceIndex) => {
        const index = start + sliceIndex;
        const key = getKey(item);
        return (
          <VirtualRow key={key} top={offsets[index] ?? 0} measure={(height) => remember(key, height)}>
            {renderItem(item)}
          </VirtualRow>
        );
      })}
    </div>
  );
}
