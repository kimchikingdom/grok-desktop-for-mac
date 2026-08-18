import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import { inspectWorkspaceRoot } from '@grok-desktop/security';
import type {
  ChooseResult,
  PermissionProfile,
  WorkspaceCandidate,
  WorkspaceSummary,
} from '@grok-desktop/shared';
import { logger } from './logger.js';
import type { MetadataStore } from './store.js';

export function toSummary(workspace: {
  id: string;
  displayName: string;
  rootPath: string;
  canonicalRootPath: string;
  permissionProfile: PermissionProfile;
  customInstructions?: string;
  sandbox?: WorkspaceSummary['sandbox'];
  lastSessionId?: string;
  lastOpenedAt: string;
}): WorkspaceSummary {
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    rootPath: workspace.rootPath,
    canonicalRootPath: workspace.canonicalRootPath,
    permissionProfile: workspace.permissionProfile,
    customInstructions: workspace.customInstructions,
    sandbox: workspace.sandbox,
    lastSessionId: workspace.lastSessionId,
    lastOpenedAt: workspace.lastOpenedAt,
  };
}

async function inspect(selectedPath: string): Promise<WorkspaceCandidate> {
  const result = await inspectWorkspaceRoot(selectedPath);
  return {
    rootPath: selectedPath,
    canonicalRootPath: result.canonicalRoot,
    displayName: path.basename(result.canonicalRoot) || result.canonicalRoot,
    verdict: result.verdict,
    reasons: result.reasons,
  };
}

function open(
  store: MetadataStore,
  candidate: WorkspaceCandidate,
  profile: PermissionProfile,
): ChooseResult {
  const record = store.upsertWorkspace({
    rootPath: candidate.rootPath,
    canonicalRootPath: candidate.canonicalRootPath,
    displayName: candidate.displayName,
    permissionProfile: profile,
  });
  logger.info('작업공간을 열었습니다.', {
    root: record.canonicalRootPath,
    profile: record.permissionProfile,
  });
  return { status: 'opened', workspace: toSummary(record) };
}

/** Last dialog (or recent) path waiting for an explicit warn confirmation. */
let pendingWarnRoot: string | null = null;

/**
 * Folder selection always goes through the native dialog (spec 6.2). The
 * renderer can only re-confirm a path the user just picked, never inject one:
 * `confirmedPath` is re-inspected and rejected unless it matches the pending
 * warned folder from this process.
 */
export async function chooseWorkspace(
  store: MetadataStore,
  window: BrowserWindow,
  args: { confirmedPath?: string; permissionProfile?: PermissionProfile },
): Promise<ChooseResult> {
  const profile = args.permissionProfile ?? 'ask';

  let selectedPath = args.confirmedPath;
  if (!selectedPath) {
    const result = await dialog.showOpenDialog(window, {
      title: '작업 폴더 선택',
      properties: ['openDirectory', 'treatPackageAsDirectory'],
      buttonLabel: '이 폴더 열기',
    });
    if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
    selectedPath = result.filePaths[0];
  }

  if (!selectedPath) return { status: 'cancelled' };

  const candidate = await inspect(selectedPath).catch((error: unknown) => {
    logger.warn('폴더 검사 실패', { selectedPath, reason: String(error) });
    return null;
  });

  if (!candidate) {
    return {
      status: 'blocked',
      candidate: {
        rootPath: selectedPath,
        canonicalRootPath: selectedPath,
        displayName: path.basename(selectedPath),
        verdict: 'blocked',
        reasons: ['폴더를 읽을 수 없습니다.'],
      },
    };
  }

  if (candidate.verdict === 'blocked') {
    logger.security('차단된 경로 선택을 거부했습니다.', {
      root: candidate.canonicalRootPath,
      reasons: candidate.reasons.join(' / '),
    });
    return { status: 'blocked', candidate };
  }

  if (candidate.verdict === 'warn' && !args.confirmedPath) {
    pendingWarnRoot = candidate.canonicalRootPath;
    return { status: 'needs-confirmation', candidate };
  }

  if (args.confirmedPath) {
    const confirmed = candidate.canonicalRootPath;
    if (!pendingWarnRoot || pendingWarnRoot !== confirmed) {
      logger.security('확인되지 않은 경로를 열려고 했습니다.', { root: confirmed });
      return { status: 'blocked', candidate: { ...candidate, verdict: 'blocked', reasons: ['이 폴더는 방금 선택한 경고 폴더가 아닙니다.'] } };
    }
    pendingWarnRoot = null;
  }

  return open(store, candidate, profile);
}

export async function openRecentWorkspace(
  store: MetadataStore,
  args: { workspaceId: string; permissionProfile?: PermissionProfile },
): Promise<ChooseResult> {
  const record = store.getWorkspace(args.workspaceId);
  if (!record) throw new Error('최근 목록에서 작업공간을 찾을 수 없습니다.');

  const candidate = await inspect(record.canonicalRootPath).catch(() => null);
  if (!candidate || candidate.verdict === 'blocked') {
    return {
      status: 'blocked',
      candidate: candidate ?? {
        rootPath: record.rootPath,
        canonicalRootPath: record.canonicalRootPath,
        displayName: record.displayName,
        verdict: 'blocked',
        reasons: ['폴더가 삭제되었거나 접근할 수 없습니다.'],
      },
    };
  }

  if (candidate.verdict === 'warn') {
    pendingWarnRoot = candidate.canonicalRootPath;
    return { status: 'needs-confirmation', candidate };
  }

  return open(store, candidate, args.permissionProfile ?? record.permissionProfile);
}

export async function listRecentWorkspaces(store: MetadataStore): Promise<WorkspaceSummary[]> {
  const records = store.listWorkspaces();
  const summaries: WorkspaceSummary[] = [];
  for (const record of records) {
    const candidate = await inspect(record.canonicalRootPath).catch(() => null);
    summaries.push({ ...toSummary(record), missing: candidate === null });
  }
  return summaries;
}
