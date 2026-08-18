import type { PermissionRequestView, RiskLevel } from '@grok-desktop/shared';
import { iconForKind } from '../icons.js';
import { useStore } from '../store.js';
import { DiffStats, DiffView } from './DiffView.js';

const RISK_LABEL: Record<RiskLevel, string> = {
  low: '낮음',
  medium: '보통',
  high: '높음',
  critical: '매우 높음',
};

export function ApprovalCard({
  request,
  decision,
  interactive = true,
}: {
  request: PermissionRequestView;
  decision?: string;
  interactive?: boolean;
}): React.JSX.Element {
  const decide = useStore((state) => state.decide);
  const status = useStore((state) => state.status);
  const sessionOption = request.options.find((option) => option.kind === 'allow-session');
  const actionable = interactive && !decision && status === 'waiting-approval';
  const KindIcon = iconForKind(request.kind);

  return (
    <section className={`card approval risk-${request.risk}`} aria-label="승인 요청">
      <header>
        <span className="kind" aria-hidden>
          <KindIcon size={16} />
        </span>
        <div>
          <h3>{request.title}</h3>
          <p className="risk-tag">위험도 {RISK_LABEL[request.risk]}</p>
        </div>
      </header>

      {request.command ? (
        <div className="field">
          <span className="label">실행할 명령</span>
          <div className="command-row">
            <code className="command">{request.command}</code>
            <button
              type="button"
              className="link"
              onClick={() => void navigator.clipboard.writeText(request.command ?? '')}
            >
              복사
            </button>
          </div>
          <span className="muted">작업 디렉터리: {request.cwd}</span>
        </div>
      ) : null}

      {request.locations.length > 0 ? (
        <div className="field">
          <span className="label">대상</span>
          <ul className="paths">
            {request.locations.map((location) => (
              <li key={location.path} className={location.insideWorkspace ? '' : 'outside'}>
                {location.insideWorkspace && location.relPath ? (
                  <button
                    type="button"
                    className="path-link"
                    onClick={() => void useStore.getState().previewFile(location.relPath ?? '', location.line)}
                  >
                    {location.relPath}
                    {location.line ? `:${location.line}` : ''}
                  </button>
                ) : (
                  <>
                    {location.relPath ?? location.path}
                    {location.insideWorkspace ? '' : ' (작업공간 밖)'}
                    {location.line ? `:${location.line}` : ''}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {request.rationale ? (
        <div className="field">
          <span className="label">Grok이 제시한 이유</span>
          <p>{request.rationale}</p>
        </div>
      ) : null}

      {request.reasons.length > 0 ? (
        <ul className="reasons">
          {request.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {request.preview ? (
        <div className="field">
          <span className="label">
            변경 미리보기 <DiffStats preview={request.preview} />
          </span>
          <DiffView preview={request.preview} />
        </div>
      ) : null}

      {decision ? (
        <p className={`decision ${decision}`}>
          {decision === 'denied'
            ? '거부했습니다.'
            : decision === 'approved-session'
              ? '이 세션 동안 허용했습니다.'
              : decision === 'auto-allowed'
                ? '신뢰하는 작업공간에서 자동 허용했습니다.'
                : '한 번 허용했습니다.'}
        </p>
      ) : actionable ? (
        <div className="actions">
          <button type="button" className="primary" onClick={() => void decide(request.id, 'once')}>
            이번 한 번 허용 (Y)
          </button>
          {sessionOption ? (
            <button type="button" onClick={() => void decide(request.id, 'session')}>
              이 세션 동안 허용 (S)
            </button>
          ) : null}
          <button type="button" className="danger" onClick={() => void decide(request.id, 'deny')}>
            거부 (N)
          </button>
        </div>
      ) : !interactive && !decision ? (
        <p className="decision">이 대화로 전환하면 승인할 수 있습니다.</p>
      ) : (
        <p className="decision">이 승인 요청은 더 이상 유효하지 않습니다.</p>
      )}
    </section>
  );
}
