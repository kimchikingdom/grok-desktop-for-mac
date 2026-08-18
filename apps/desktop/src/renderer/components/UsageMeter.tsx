import type { UsageSnapshot } from '@grok-desktop/shared';

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * The CLI exposes no usage endpoint, so this shows only what is actually known:
 * the rolling-window numbers once the API has reported them, and otherwise the
 * model's context size and the turns taken in this session.
 */
export function UsageMeter({
  usage,
  onOpenUsage,
}: {
  usage: UsageSnapshot | null;
  onOpenUsage: () => void;
}): React.JSX.Element | null {
  if (!usage) return null;

  const quota = usage.quota;
  if (!quota) return null;

  const ratio = Math.min(1, quota.usedTokens / Math.max(1, quota.limitTokens));
  const remaining = Math.max(0, quota.limitTokens - quota.usedTokens);
  const level = ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';
  return (
    <button
      type="button"
      className="usage"
      onClick={onOpenUsage}
      title={`24시간 롤링 기준 ${quota.usedTokens.toLocaleString()} / ${quota.limitTokens.toLocaleString()} 토큰 (${new Date(quota.observedAt).toLocaleTimeString()} 기준). 클릭하면 사용량 정책을 엽니다.`}
    >
      <span>
        {remaining > 0 ? `잔여 ${formatTokens(remaining)}` : '한도 도달'} · {formatTokens(quota.limitTokens)}
      </span>
      <span className={`usage-bar ${level}`}>
        <span style={{ width: `${Math.round(ratio * 100)}%` }} />
      </span>
    </button>
  );
}
