import { classifyCommand, classifySensitivity, commandGrantKey } from '@grok-desktop/security';
import type { PermissionProfile, RiskLevel, ToolKind, ToolLocation } from '@grok-desktop/shared';

export type PermissionEvaluation = {
  decision: 'auto-allow' | 'auto-deny' | 'ask';
  risk: RiskLevel;
  reasons: string[];
  /** Key used for "allow this tool for the rest of the session". */
  grantKey: string;
  /** Command families that must be approved every time (spec 6.5). */
  alwaysAsk: boolean;
};

export type EvaluationInput = {
  profile: PermissionProfile;
  kind: ToolKind;
  locations: ToolLocation[];
  command?: string;
  sessionGrants: ReadonlySet<string>;
};

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
const higher = (a: RiskLevel, b: RiskLevel): RiskLevel => (RISK_ORDER[a] >= RISK_ORDER[b] ? a : b);

export function grantKeyFor(kind: ToolKind, specifier?: string): string {
  return specifier ? `tool:${kind}:${specifier}` : `tool:${kind}`;
}

const MUTATING_KINDS: ToolKind[] = ['edit', 'delete', 'move', 'execute', 'fetch', 'other'];

/**
 * Layer one of the dual control described in spec 7.3. The Grok CLI sandbox is
 * layer two; neither is trusted to be sufficient on its own.
 */
export function evaluatePermission(input: EvaluationInput): PermissionEvaluation {
  const reasons: string[] = [];
  let grantKey = grantKeyFor(input.kind);
  let risk: RiskLevel = 'low';
  let alwaysAsk = false;

  const mutatingFiles = input.kind === 'edit' || input.kind === 'delete' || input.kind === 'move';
  if (mutatingFiles && input.locations.length === 0) {
    return {
      decision: 'auto-deny',
      risk: 'high',
      alwaysAsk: true,
      grantKey,
      reasons: ['대상 경로가 없는 파일 변경은 허용하지 않습니다.'],
    };
  }

  const outside = input.locations.filter((location) => !location.insideWorkspace);
  if (outside.length > 0) {
    return {
      decision: 'auto-deny',
      risk: 'critical',
      alwaysAsk: true,
      grantKey,
      reasons: [
        `작업공간 밖의 경로에 접근하려 했습니다: ${outside.map((location) => location.path).join(', ')}`,
      ],
    };
  }

  const sensitiveReasons = input.locations.flatMap(
    (location) => classifySensitivity(location.relPath ?? location.path).reasons,
  );
  const touchesSensitive = sensitiveReasons.length > 0;
  const rel = input.locations.find((location) => location.relPath)?.relPath;
  if (touchesSensitive) {
    risk = higher(risk, 'high');
    alwaysAsk = true;
    reasons.push(...new Set(sensitiveReasons));
  }
  if (rel && (input.kind === 'edit' || input.kind === 'move' || input.kind === 'delete' || touchesSensitive)) {
    grantKey = grantKeyFor(input.kind, rel);
  }

  if (input.kind === 'execute') {
    const classification = classifyCommand(input.command ?? '');
    risk = higher(risk, classification.risk);
    alwaysAsk = alwaysAsk || classification.alwaysAsk;
    reasons.push(...classification.reasons);
    grantKey = grantKeyFor('execute', commandGrantKey(input.command ?? ''));
  } else if (input.kind === 'delete') {
    risk = higher(risk, 'high');
    alwaysAsk = true;
    reasons.push('파일 삭제는 되돌리기 어려우므로 항상 확인합니다.');
  } else if (input.kind === 'edit' || input.kind === 'move') {
    risk = higher(risk, 'medium');
    reasons.push(
      input.kind === 'edit' ? '작업공간 안의 파일을 수정합니다.' : '작업공간 안의 파일을 이동합니다.',
    );
  } else if (input.kind === 'fetch') {
    risk = higher(risk, 'high');
    alwaysAsk = true;
    reasons.push('외부 네트워크에서 데이터를 가져옵니다.');
  } else {
    reasons.push('읽기 계열 작업입니다.');
  }

  if (input.profile === 'read-only' && MUTATING_KINDS.includes(input.kind)) {
    return {
      decision: 'auto-deny',
      risk: higher(risk, 'high'),
      alwaysAsk,
      grantKey,
      reasons: ['읽기 전용 작업공간에서는 파일 변경과 명령 실행을 허용하지 않습니다.', ...reasons],
    };
  }

  const isReadLike = input.kind === 'read' || input.kind === 'search' || input.kind === 'think';
  if (isReadLike && !touchesSensitive) {
    return { decision: 'auto-allow', risk, alwaysAsk, grantKey, reasons };
  }

  if (!alwaysAsk && input.sessionGrants.has(grantKey)) {
    return {
      decision: 'auto-allow',
      risk,
      alwaysAsk,
      grantKey,
      reasons: ['이 세션에서 같은 도구를 이미 허용했습니다.', ...reasons],
    };
  }

  if (
    input.profile === 'trusted' &&
    !alwaysAsk &&
    (input.kind === 'edit' || input.kind === 'move') &&
    !touchesSensitive
  ) {
    return {
      decision: 'auto-allow',
      risk,
      alwaysAsk,
      grantKey,
      reasons: ['신뢰하는 작업공간의 일반 파일 수정입니다.', ...reasons],
    };
  }

  return { decision: 'ask', risk, alwaysAsk, grantKey, reasons };
}
