import type { UsageSnapshot } from '@grok-desktop/shared';

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

/**
 * Only numbers that came from the CLI or the API: `grok usage` for what this
 * session actually spent, and the rolling-window figures a 429 body reports.
 * There is no endpoint for remaining subscription usage, so nothing here is a
 * guess and the gauge stays empty until a 429 supplies real limits.
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
  const session = usage.session;
  if (!quota && !session) return null;

  const ratio = quota ? Math.min(1, quota.usedTokens / Math.max(1, quota.limitTokens)) : 0;
  const remaining = quota ? Math.max(0, quota.limitTokens - quota.usedTokens) : 0;
  const level = !quota ? '' : ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : '';

  const lines: string[] = [];
  if (session) {
    lines.push(
      `이 대화에서 쓴 토큰 ${session.totalTokens.toLocaleString()} (입력 ${session.inputTokens.toLocaleString()} · 출력 ${session.outputTokens.toLocaleString()}${
        session.cachedReadTokens > 0 ? ` · 캐시 읽기 ${session.cachedReadTokens.toLocaleString()}` : ''
      }${session.reasoningTokens > 0 ? ` · 추론 ${session.reasoningTokens.toLocaleString()}` : ''})`,
      `${session.turnCount}턴 · 모델 호출 ${session.modelCalls}회${session.primaryModelId ? ` · ${session.primaryModelId}` : ''}`,
      `${new Date(session.updatedAt).toLocaleString()} 기준, grok CLI 기록`,
    );
  }
  if (usage.contextTokens) lines.push(`모델 컨텍스트 창 ${formatTokens(usage.contextTokens)}`);
  if (quota) {
    lines.push(
      `24시간 롤링 기준 ${quota.usedTokens.toLocaleString()} / ${quota.limitTokens.toLocaleString()} 토큰 (${new Date(quota.observedAt).toLocaleTimeString()} 기준)`,
    );
  } else {
    lines.push('남은 구독 사용량은 한도를 넘길 때만 API가 알려 줍니다.');
  }
  lines.push('클릭하면 사용량 정책을 엽니다.');

  return (
    <button type="button" className="usage" onClick={onOpenUsage} title={lines.join('\n')}>
      <span>
        {session ? `${formatTokens(session.totalTokens)} 토큰` : null}
        {session && quota ? ' · ' : null}
        {quota ? (remaining > 0 ? `잔여 ${formatTokens(remaining)}` : '한도 도달') : null}
      </span>
      {quota ? (
        <span className={`usage-bar ${level}`}>
          <span style={{ width: `${Math.round(ratio * 100)}%` }} />
        </span>
      ) : null}
    </button>
  );
}
