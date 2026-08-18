import { GROK_USAGE_URL, type SessionStatus } from '@grok-desktop/shared';
import { IconFile, IconFolder, IconGear } from '../icons.js';
import { useStore } from '../store.js';
import { UsageMeter } from './UsageMeter.js';

const PROFILE_LABEL: Record<string, string> = {
  'read-only': '읽기 전용',
  ask: '변경 시 승인',
  trusted: '신뢰하는 작업공간',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: '대기 중',
  starting: '시작 중',
  running: '작업 중',
  'waiting-approval': '승인 대기',
  failed: '오류',
  closed: '종료됨',
};

export function Header(): React.JSX.Element {
  const workspace = useStore((state) => state.workspace);
  const status = useStore((state) => state.status);
  const models = useStore((state) => state.models);
  const currentModelId = useStore((state) => state.currentModelId);
  const setModel = useStore((state) => state.setModel);
  const usage = useStore((state) => state.usage);
  const busy = useStore((state) => state.busy);
  const openExternal = useStore((state) => state.openExternal);
  const chooseFolder = useStore((state) => state.chooseFolder);
  const reviewOpen = useStore((state) => state.reviewOpen);
  const setReviewOpen = useStore((state) => state.setReviewOpen);
  const changes = useStore((state) => state.changes);
  const additions = changes.reduce((sum, change) => sum + change.additions, 0);
  const deletions = changes.reduce((sum, change) => sum + change.deletions, 0);
  const session = useStore((state) => state.session);
  const gitBranch = useStore((state) => state.gitBranch);

  return (
    <header className="app-header">
      <div className="project">
        <div className="project-copy">
          <strong>{workspace?.displayName ?? 'Grok'}</strong>
          {workspace ? (
            <span className="meta" title={workspace.canonicalRootPath}>
              {gitBranch ? (
                <button
                  type="button"
                  className="branch-name"
                  title="브랜치 이름 복사"
                  onClick={() => {
                    void navigator.clipboard.writeText(gitBranch).then(() => {
                      useStore.getState().notify(`${gitBranch} 브랜치를 복사했습니다.`);
                    });
                  }}
                >
                  {gitBranch}
                </button>
              ) : null}
              {gitBranch ? ' · ' : ''}
              {PROFILE_LABEL[workspace.permissionProfile]}
              {session?.worktreeLabel ? ` · 워크트리 ${session.worktreeLabel}` : ''}
            </span>
          ) : null}
        </div>
      </div>

      <div className="header-right">
        {status === 'running' || status === 'waiting-approval' || status === 'failed' || status === 'starting' ? (
          <span className={`status-pill ${status}`}>{STATUS_LABEL[status]}</span>
        ) : null}
        <button
          type="button"
          className={`link change-stats ${reviewOpen ? 'active' : ''}`}
          aria-pressed={reviewOpen}
          title="변경 리뷰"
          onClick={() => void setReviewOpen(!reviewOpen)}
        >
          {changes.length > 0 ? (
            <>
              <span className="add">+{additions}</span>
              <span className="del">−{deletions}</span>
            </>
          ) : (
            '리뷰'
          )}
        </button>
        <UsageMeter usage={usage} onOpenUsage={() => void openExternal(GROK_USAGE_URL)} />

        {models.length > 0 ? (
          <label className="model-picker" title="모델을 바꾸면 에이전트를 다시 시작하고 대화를 이어갑니다.">
            <span className="visually-hidden">모델</span>
            <select
              value={currentModelId ?? ''}
              disabled={busy || status === 'running' || status === 'waiting-approval'}
              onChange={(event) => void setModel(event.target.value)}
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <button
          type="button"
          className="icon-btn"
          title="파일 열기 (⌘P)"
          aria-label="파일 열기"
          onClick={() => useStore.getState().setFileSwitcherOpen(true)}
        >
          <IconFile size={15} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="다른 폴더 열기"
          aria-label="다른 폴더 열기"
          onClick={() => void chooseFolder()}
        >
          <IconFolder size={16} />
        </button>
        <button
          type="button"
          className="icon-btn header-help"
          title="단축키"
          aria-label="단축키"
          onClick={() => useStore.getState().setShortcutsOpen(true)}
        >
          ?
        </button>
        <button
          type="button"
          className="icon-btn"
          title="설정"
          aria-label="설정"
          onClick={() => useStore.getState().setSettingsOpen(true)}
        >
          <IconGear size={15} />
        </button>
      </div>
    </header>
  );
}
