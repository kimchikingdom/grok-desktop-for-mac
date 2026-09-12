import { useEffect, useState } from 'react';
import { useStore } from '../store.js';

const PROFILES = [
  { id: 'read-only' as const, label: '읽기 전용', hint: '파일 수정과 명령을 거부합니다.' },
  { id: 'ask' as const, label: '변경 시 승인', hint: '쓰기와 실행은 매번 묻습니다.' },
  { id: 'trusted' as const, label: '신뢰하는 작업공간', hint: '일반 수정은 허용하고, 위험한 작업만 묻습니다.' },
];

export function SettingsPanel(): React.JSX.Element | null {
  const open = useStore((state) => state.settingsOpen);
  const workspace = useStore((state) => state.workspace);
  const setSettingsOpen = useStore((state) => state.setSettingsOpen);
  const updateWorkspace = useStore((state) => state.updateWorkspace);
  const loadExtras = useStore((state) => state.loadExtras);
  const exportLog = useStore((state) => state.exportLog);
  const loadSessionInfo = useStore((state) => state.loadSessionInfo);
  const sessionInfo = useStore((state) => state.sessionInfo);
  const runtime = useStore((state) => state.runtime);
  const viewMode = useStore((state) => state.viewMode);
  const setViewMode = useStore((state) => state.setViewMode);
  const lastIsolation = useStore((state) => state.lastIsolation);
  const setLastIsolation = useStore((state) => state.setLastIsolation);
  const [draft, setDraft] = useState(workspace?.customInstructions ?? '');
  const [mcp, setMcp] = useState<{ name: string; enabled: boolean }[]>([]);
  const [skills, setSkills] = useState<{ name: string; source: string; enabled: boolean }[]>([]);
  const toggleExtra = useStore((state) => state.toggleExtra);

  useEffect(() => {
    if (open) {
      setDraft(workspace?.customInstructions ?? '');
      void loadExtras().then((extras) => {
        setMcp(extras.mcp);
        setSkills(extras.skills);
      });
      void loadSessionInfo();
    }
  }, [open, workspace?.customInstructions, loadExtras, loadSessionInfo]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setSettingsOpen]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
      <section className="modal card" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="settings-title">설정</h2>
          <button type="button" className="link" onClick={() => setSettingsOpen(false)}>
            닫기
          </button>
        </header>

        {!workspace ? (
          <p className="muted">폴더를 연 뒤에 권한과 지시사항을 바꿀 수 있습니다.</p>
        ) : null}

        <div className="field">
          <span className="label">대화 보기</span>
          <p className="muted small">채팅에 도구 결과를 얼마나 자세히 보여줄지 정합니다.</p>
          <div className="profile-picks">
            {(
              [
                { id: 'summary', label: '요약', hint: '메시지와 오류만' },
                { id: 'normal', label: '보통', hint: '진행 중인 도구만' },
                { id: 'verbose', label: '자세히', hint: '완료된 도구까지' },
              ] as const
            ).map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={viewMode === entry.id}
                className={viewMode === entry.id ? 'active' : ''}
                onClick={() => setViewMode(entry.id)}
              >
                <strong>{entry.label}</strong>
                <span className="muted small">{entry.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">새 대화</span>
          <p className="muted small">⌘N과 명령 팔레트의 새 대화에 씁니다. 사이드바 버튼은 그대로 고를 수 있습니다.</p>
          <div className="profile-picks">
            <button
              type="button"
              aria-pressed={lastIsolation === 'none'}
              className={lastIsolation === 'none' ? 'active' : ''}
              onClick={() => setLastIsolation('none')}
            >
              <strong>같은 폴더</strong>
              <span className="muted small">현재 작업 폴더를 같이 씁니다</span>
            </button>
            <button
              type="button"
              aria-pressed={lastIsolation === 'worktree'}
              className={lastIsolation === 'worktree' ? 'active' : ''}
              onClick={() => setLastIsolation('worktree')}
            >
              <strong>워크트리</strong>
              <span className="muted small">격리된 복사본에서 시작합니다</span>
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">Grok CLI</span>
          <p className="muted small">
            {runtime?.binaryPath ? `${runtime.binaryPath} (${runtime.version ?? '?'})` : '감지되지 않음'}
          </p>
          <button type="button" className="link" onClick={() => void exportLog()}>
            진단 로그 복사
          </button>
        </div>

        {sessionInfo ? (
          <div className="field">
            <span className="label">현재 세션</span>
            <p className="muted small">id {sessionInfo.id}</p>
            {sessionInfo.grokSessionId ? <p className="muted small">CLI {sessionInfo.grokSessionId}</p> : null}
            <p className="muted small">cwd {sessionInfo.cwd}</p>
            {sessionInfo.branch ? <p className="muted small">브랜치 {sessionInfo.branch}</p> : null}
            <p className="muted small">메시지 {sessionInfo.messageCount} · 모델 {sessionInfo.model ?? '기본'}</p>
            {sessionInfo.worktreeLabel ? <p className="muted small">워크트리 {sessionInfo.worktreeLabel}</p> : null}
          </div>
        ) : null}

        <div className="field">
          <span className="label">권한 프로필</span>
          <div className="profile-picks">
            {PROFILES.map((profile) => (
              <button
                key={profile.id}
                type="button"
                aria-pressed={workspace?.permissionProfile === profile.id}
                className={workspace?.permissionProfile === profile.id ? 'active' : ''}
                disabled={!workspace}
                onClick={() => void updateWorkspace({ permissionProfile: profile.id })}
              >
                <strong>{profile.label}</strong>
                <span className="muted small">{profile.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">CLI 샌드박스</span>
          <p className="muted small">다음 세션부터 `grok --sandbox`에 전달됩니다. 지금 열린 연결은 다시 시작해야 적용됩니다.</p>
          <div className="profile-picks">
            {(
              [
                { id: 'off', label: '끄기', hint: 'CLI 샌드박스를 쓰지 않습니다.' },
                { id: 'workspace', label: '작업공간', hint: '작업 폴더 안으로 제한합니다.' },
                { id: 'read-only', label: '읽기 전용', hint: '파일 쓰기를 막습니다.' },
                { id: 'strict', label: '엄격', hint: '네트워크와 쓰기를 강하게 제한합니다.' },
              ] as const
            ).map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={workspace?.sandbox === entry.id || (!workspace?.sandbox && entry.id === 'off')}
                className={workspace?.sandbox === entry.id || (!workspace?.sandbox && entry.id === 'off') ? 'active' : ''}
                disabled={!workspace}
                onClick={() => void updateWorkspace({ sandbox: entry.id })}
              >
                <strong>{entry.label}</strong>
                <span className="muted small">{entry.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label">프로젝트 지시사항</span>
          <p className="muted small">이 폴더의 모든 대화 앞에 붙습니다. grok.com의 커스텀 인스트럭션과 같은 역할입니다.</p>
          <textarea
            value={draft}
            rows={6}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!workspace}
            placeholder="예: 한국어로 답하고, 테스트 없이 코드를 바꾸지 마세요."
          />
          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={!workspace}
              onClick={() => void updateWorkspace({ customInstructions: draft.trim() || null })}
            >
              저장
            </button>
          </div>
        </div>

        <div className="field">
          <span className="label">스킬</span>
          <p className="muted small">`~/.grok/config.toml`의 `[skills] disabled`에 기록합니다. 적용하려면 연결을 다시 시작하세요.</p>
          {skills.length === 0 ? (
            <p className="muted small">SKILL.md가 있는 스킬 폴더가 없습니다.</p>
          ) : (
            <ul className="sessions">
              {skills.map((skill) => (
                <li key={`${skill.source}-${skill.name}`}>
                  <span className="session-title">{skill.name}</span>
                  <span className="muted small">{skill.source}</span>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      void toggleExtra('skill', skill.name, !skill.enabled).then((extras) => {
                        setMcp(extras.mcp);
                        setSkills(extras.skills);
                      })
                    }
                  >
                    {skill.enabled ? '끄기' : '켜기'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="field">
          <span className="label">MCP 서버 (`~/.grok/config.toml`)</span>
          <p className="muted small">해당 서버의 `enabled`만 바꿉니다. 적용하려면 연결을 다시 시작하세요.</p>
          {mcp.length === 0 ? (
            <p className="muted small">설정된 서버가 없습니다. CLI 설정 파일을 편집하세요.</p>
          ) : (
            <ul className="sessions">
              {mcp.map((server) => (
                <li key={server.name}>
                  <span className="session-title">{server.name}</span>
                  <span className="muted small">{server.enabled ? '사용' : '꺼짐'}</span>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      void toggleExtra('mcp', server.name, !server.enabled).then((extras) => {
                        setMcp(extras.mcp);
                        setSkills(extras.skills);
                      })
                    }
                  >
                    {server.enabled ? '끄기' : '켜기'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
