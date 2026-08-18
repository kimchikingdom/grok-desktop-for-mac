import { useEffect, useState } from 'react';
import type { InstallInstructions } from '@grok-desktop/shared';
import appIcon from '../assets/app-icon.png';
import { IconCheck, IconFolder } from '../icons.js';
import { useStore } from '../store.js';

export function Onboarding(): React.JSX.Element {
  const runtime = useStore((state) => state.runtime);
  const auth = useStore((state) => state.auth);
  const recents = useStore((state) => state.recents);
  const busy = useStore((state) => state.busy);
  const pendingConfirmation = useStore((state) => state.pendingConfirmation);
  const refreshRuntime = useStore((state) => state.refreshRuntime);
  const startLogin = useStore((state) => state.startLogin);
  const chooseFolder = useStore((state) => state.chooseFolder);
  const openRecent = useStore((state) => state.openRecent);
  const openExternal = useStore((state) => state.openExternal);
  const [install, setInstall] = useState<InstallInstructions | null>(null);

  useEffect(() => {
    if (runtime?.state === 'not-installed') {
      void window.grokDesktop.runtime.installInstructions().then(setInstall);
    }
  }, [runtime?.state]);

  const installed = runtime !== null && runtime.state !== 'not-installed';
  const authenticated = auth?.authenticated ?? false;

  return (
    <main className="onboarding">
      <div className="onboarding-inner">
        <div className="brand">
          <span className="logo-wrap">
            <img src={appIcon} width={64} height={64} alt="" />
          </span>
          <h1>Grok Desktop</h1>
          <p>선택한 폴더 안에서만 동작하는 로컬 에이전트. 파일 수정과 명령 실행은 항상 승인을 거칩니다.</p>
        </div>

        <ol className="steps">
          <li className={installed ? 'done' : 'active'}>
            <span className="step-index">{installed ? <IconCheck size={14} /> : '1'}</span>
            <h2>Grok Build CLI</h2>
            {installed ? (
              <p>
                감지됨: <code>{runtime?.binaryPath}</code> (버전 {runtime?.version ?? '알 수 없음'})
              </p>
            ) : (
              <>
                <p>{runtime?.detail ?? 'grok 실행 파일을 찾지 못했습니다.'}</p>
                <p className="muted">
                  아래 명령을 터미널에서 직접 실행해 주세요. 앱은 설치 명령을 대신 실행하지 않습니다.
                </p>
                <code className="command">{install?.command ?? runtime?.installCommand}</code>
                <div className="actions">
                  <button type="button" onClick={() => void refreshRuntime()} disabled={busy}>
                    다시 확인
                  </button>
                  <button
                    type="button"
                    className="link"
                    onClick={() => void openExternal(install?.docsUrl ?? 'https://docs.x.ai/build/overview')}
                  >
                    설치 문서 열기
                  </button>
                </div>
              </>
            )}
          </li>

          <li className={authenticated ? 'done' : installed ? 'active' : ''}>
            <span className="step-index">{authenticated ? <IconCheck size={14} /> : '2'}</span>
            <h2>xAI 로그인</h2>
            {authenticated ? (
              <p>로그인되어 있습니다{auth?.method ? ` (${auth.method})` : ''}.</p>
            ) : (
              <>
                <p className="muted">
                  {auth?.detail ?? '브라우저에서 xAI 계정으로 로그인합니다. 앱은 비밀번호나 토큰을 저장하지 않습니다.'}
                </p>
                <div className="actions">
                  <button type="button" className="primary" onClick={() => void startLogin()} disabled={!installed || busy}>
                    브라우저로 로그인
                  </button>
                  <button type="button" onClick={() => void refreshRuntime()} disabled={busy}>
                    상태 새로고침
                  </button>
                </div>
                {auth?.loginUrl ? (
                  <div className="card warn">
                    <p>
                      {auth.loginCode ? (
                        <>
                          브라우저에 코드 <code>{auth.loginCode}</code> 를 입력해 주세요.
                        </>
                      ) : (
                        '브라우저에서 로그인을 완료해 주세요.'
                      )}
                    </p>
                    <div className="actions">
                      <button type="button" className="primary" onClick={() => void openExternal(auth.loginUrl!)}>
                        브라우저 다시 열기
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </li>

          <li className={installed && authenticated ? 'active' : ''}>
            <span className="step-index">3</span>
            <h2>작업 폴더 열기</h2>
            <p className="muted">홈 디렉터리 전체, 시스템 디렉터리, 자격 증명 폴더는 열 수 없습니다.</p>
            <div className="actions">
              <button
                type="button"
                className="primary with-icon"
                onClick={() => void chooseFolder()}
                disabled={!installed || !authenticated || busy}
              >
                <IconFolder size={14} />
                폴더 선택
              </button>
            </div>

            {pendingConfirmation ? (
              <div className="card warn">
                <h3>이 폴더를 열까요?</h3>
                <code>{pendingConfirmation.canonicalRootPath}</code>
                <ul className="reasons">
                  {pendingConfirmation.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => void chooseFolder(pendingConfirmation.canonicalRootPath)}
                  >
                    확인하고 열기
                  </button>
                </div>
              </div>
            ) : null}

            {recents.length > 0 ? (
              <ul className="recents">
                {recents.map((recent) => (
                  <li key={recent.id}>
                    <button
                      type="button"
                      className="recent-item"
                      disabled={recent.missing || !installed || !authenticated}
                      onClick={() => void openRecent(recent.id)}
                    >
                      <IconFolder size={16} />
                      <span>
                        <span className="name">{recent.displayName}</span>
                        <span className="path">{recent.canonicalRootPath}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        </ol>

        <p className="muted small onboarding-foot">
          앱은 선택한 폴더 밖의 파일을 읽지 않으며, 읽은 파일과 실행한 명령을 화면에 모두 표시합니다.
        </p>
      </div>
    </main>
  );
}
