import { createHash } from 'node:crypto';
import type { RiskLevel } from '@grok-desktop/shared';

export type CommandCategory =
  | 'delete'
  | 'install'
  | 'publish'
  | 'network'
  | 'privilege'
  | 'system-settings'
  | 'db-migration'
  | 'write'
  | 'test'
  | 'read';

export type CommandClassification = {
  risk: RiskLevel;
  categories: CommandCategory[];
  reasons: string[];
  /**
   * True for the command families spec 6.5 says must be approved every time,
   * even when the session already granted a blanket allowance for the tool.
   */
  alwaysAsk: boolean;
};

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER[a] >= RISK_ORDER[b] ? a : b;
}

/**
 * Split a command line on shell operators so each segment can be judged alone.
 * A bare `&` backgrounds the command before it, so what follows is a separate
 * command and has to be judged separately — otherwise `ls & curl …` reads as a
 * plain `ls`. `2>&1` and `&>` are redirections, not separators, so the `&` there
 * is left alone.
 */
export function splitCommandSegments(command: string): string[] {
  return command
    .split(/\|\||&&|[;\n|()]|(?<![>&])&(?![&>])/g)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function tokenize(segment: string): string[] {
  // Redirections do not have to be space-separated: `bash<<<"curl x"` is one
  // run of non-space characters, and without this the head would be read as the
  // nonsense binary `bash<<<"curl`.
  const spaced = segment.replace(/(<<<|<<|>>|[<>])/g, ' $1 ');
  const tokens = spaced.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  return tokens.map((token) => token.replace(/^['"]|['"]$/g, ''));
}

/**
 * Wrappers that run whatever command follows them. The head has to be found on
 * the far side, or `nohup curl …` looks like the unknown binary `nohup`.
 */
const COMMAND_WRAPPERS = new Set([
  'nohup', 'time', 'timeout', 'gtimeout', 'nice', 'ionice', 'stdbuf', 'setsid',
  'command', 'builtin', 'exec', 'xargs', 'watch', 'script', 'caffeinate',
]);

/** Drop leading `env`/`VAR=value` prefixes and wrappers to find the real executable. */
function headOf(tokens: string[]): { name: string; args: string[]; wrappedBy?: string } {
  let index = 0;
  let wrappedBy: string | undefined;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === undefined) break;
    if (token === 'env' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      index += 1;
      continue;
    }
    const bare = token.split('/').pop() ?? token;
    if (COMMAND_WRAPPERS.has(bare)) {
      wrappedBy ??= bare;
      index += 1;
      // Skip the wrapper's own flags and its numeric argument (`timeout 5 …`).
      while (index < tokens.length) {
        const next = tokens[index];
        if (next === undefined) break;
        if (next.startsWith('-') || /^\d+(\.\d+)?[smhd]?$/.test(next)) {
          index += 1;
          continue;
        }
        break;
      }
      continue;
    }
    break;
  }
  const name = tokens[index] ?? '';
  return { name: name.split('/').pop() ?? name, args: tokens.slice(index + 1), wrappedBy };
}

const NETWORK_BINARIES = new Set(['curl', 'wget', 'nc', 'ncat', 'telnet', 'ssh', 'scp', 'sftp', 'rsync', 'ftp', 'httpie', 'http']);
const PRIVILEGE_BINARIES = new Set(['sudo', 'su', 'doas', 'chmod', 'chown', 'chgrp', 'xattr', 'codesign', 'security']);
const SYSTEM_BINARIES = new Set(['launchctl', 'systemctl', 'systemsetup', 'scutil', 'networksetup', 'defaults', 'reg', 'diskutil', 'csrutil', 'spctl']);
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'poetry', 'uv', 'brew', 'cargo', 'gem', 'go', 'apt', 'apt-get', 'dnf', 'yum', 'pacman', 'nix-env', 'composer']);
const INSTALL_SUBCOMMANDS = new Set(['install', 'i', 'add', 'ci', 'upgrade', 'update', 'get', 'sync']);
const READ_ONLY_BINARIES = new Set(['ls', 'pwd', 'cat', 'head', 'tail', 'wc', 'echo', 'grep', 'rg', 'fd', 'which', 'file', 'stat', 'du', 'df', 'date', 'env', 'printenv', 'tree', 'jq', 'sort', 'uniq', 'diff']);
const TEST_BINARIES = new Set(['vitest', 'jest', 'mocha', 'pytest', 'tox', 'rspec', 'phpunit', 'ctest']);
const READ_ONLY_GIT = new Set(['status', 'diff', 'log', 'show', 'branch', 'blame', 'stash', 'remote', 'rev-parse', 'describe', 'ls-files']);

function classifySegment(segment: string): CommandClassification {
  const tokens = tokenize(segment);
  const { name, args, wrappedBy } = headOf(tokens);
  const categories = new Set<CommandCategory>();
  const reasons: string[] = [];
  let risk: RiskLevel = 'low';
  let alwaysAsk = false;

  const arg0 = args[0];
  const joinedArgs = args.join(' ');

  const flag = (raw: RiskLevel, category: CommandCategory, reason: string, always = false) => {
    risk = maxRisk(risk, raw);
    categories.add(category);
    reasons.push(reason);
    if (always) alwaysAsk = true;
  };

  if (PRIVILEGE_BINARIES.has(name)) {
    if (name === 'sudo' || name === 'su' || name === 'doas') {
      flag('critical', 'privilege', '관리자 권한으로 실행합니다.', true);
    } else {
      flag('high', 'privilege', `권한 또는 서명을 변경합니다 (${name}).`, true);
    }
  }

  if (SYSTEM_BINARIES.has(name)) {
    flag('critical', 'system-settings', `시스템 설정을 변경할 수 있습니다 (${name}).`, true);
  }

  if (NETWORK_BINARIES.has(name)) {
    flag('high', 'network', `외부 네트워크와 통신합니다 (${name}). 파일 내용이 외부로 전송될 수 있습니다.`, true);
  }

  if (name === 'rm') {
    const recursive = args.some((a) => /^-[a-zA-Z]*[rRf]/.test(a));
    flag(recursive ? 'critical' : 'high', 'delete', recursive ? '파일 또는 디렉터리를 재귀적으로 삭제합니다.' : '파일을 삭제합니다.', true);
  }

  if (name === 'rmdir' || name === 'shred' || name === 'srm') {
    flag('high', 'delete', '파일 또는 디렉터리를 삭제합니다.', true);
  }

  if (name === 'find' && args.includes('-delete')) {
    flag('critical', 'delete', 'find -delete 로 다수 파일을 삭제합니다.', true);
  }

  if (name === 'mv' && args.length > 2) {
    flag('high', 'delete', '여러 파일을 한 번에 이동합니다.', true);
  }

  if (PACKAGE_MANAGERS.has(name) && arg0 !== undefined && INSTALL_SUBCOMMANDS.has(arg0)) {
    flag('high', 'install', '패키지를 설치하거나 갱신합니다. 설치 스크립트가 임의 코드를 실행할 수 있습니다.', true);
  }

  if (name === 'npx' || name === 'pnpx' || name === 'bunx' || name === 'uvx') {
    flag('high', 'install', '원격 패키지를 내려받아 실행합니다.', true);
  }

  if (name === 'git') {
    if (arg0 === 'push') flag('high', 'publish', '원격 저장소로 커밋을 푸시합니다.', true);
    else if (arg0 === 'clean') flag('high', 'delete', '추적되지 않은 파일을 삭제합니다.', true);
    else if (arg0 === 'reset' && args.includes('--hard')) flag('high', 'delete', '작업 트리 변경사항을 되돌릴 수 없게 버립니다.', true);
    else if (arg0 !== undefined && READ_ONLY_GIT.has(arg0) && !args.includes('add')) flag('low', 'read', 'Git 저장소 상태를 읽습니다.');
    else flag('medium', 'write', 'Git 저장소를 변경합니다.');
  }

  if ((name === 'npm' || name === 'pnpm' || name === 'yarn') && arg0 === 'publish') {
    flag('critical', 'publish', '패키지를 공개 레지스트리에 배포합니다.', true);
  }

  if (['vercel', 'netlify', 'fly', 'heroku', 'gh', 'docker', 'kubectl', 'terraform', 'aws', 'gcloud', 'az'].includes(name)) {
    const publishing = ['deploy', 'push', 'apply', 'release', 'create', 'delete', 'destroy'].includes(arg0 ?? '');
    flag(publishing ? 'critical' : 'high', publishing ? 'publish' : 'network', `외부 인프라 도구입니다 (${name} ${arg0 ?? ''}).`.trim(), true);
  }

  if (/\b(migrate|migration|db:migrate|db_migrate)\b/.test(joinedArgs) || name === 'alembic' || name === 'flyway') {
    flag('high', 'db-migration', '데이터베이스 스키마를 변경합니다.', true);
  }

  if (name === 'psql' || name === 'mysql' || name === 'mongo' || name === 'redis-cli' || name === 'sqlite3') {
    flag('high', 'db-migration', '데이터베이스에 직접 명령을 실행합니다.', true);
  }

  if (TEST_BINARIES.has(name) || (PACKAGE_MANAGERS.has(name) && arg0 === 'test')) {
    flag('medium', 'test', '테스트 명령을 실행합니다.');
  }

  if (PACKAGE_MANAGERS.has(name) && arg0 === 'run') {
    const script = args[1] ?? '';
    const testScript = /^(test|tests|spec|unit|e2e|vitest|jest)$/i.test(script);
    flag(
      testScript ? 'medium' : 'high',
      testScript ? 'test' : 'write',
      testScript
        ? '테스트 스크립트를 실행합니다. package.json 내용과 같을 필요는 없습니다.'
        : `패키지 스크립트(${script || 'run'})를 실행합니다.`,
      true,
    );
  }

  if (['bash', 'sh', 'zsh', 'fish', 'ksh', 'dash'].includes(name)) {
    // `-c` is the usual form, but a here-string or redirected script feeds the
    // shell just as much code: `bash <<< "curl …"`.
    const fed = args.some((a) => a === '-c' || a === '-lc' || a === '<<<' || a === '<<' || a === '<');
    if (fed) flag('high', 'write', '셸이 전달받은 문자열이나 스크립트를 실행합니다.', true);
  }

  if (['python', 'python3', 'node', 'ruby', 'perl', 'php', 'osascript'].includes(name) && args.some((a) => a === '-c' || a === '-e' || a === '--eval')) {
    flag('high', 'write', '인터프리터가 인라인 코드를 실행합니다.', true);
  }

  if (name === 'sed' && args.some((a) => a === '-i' || a.startsWith('-i'))) {
    flag('high', 'write', 'sed -i 로 파일을 직접 덮어씁니다.', true);
  }

  if (name === 'tee' || name === 'dd' || name === 'truncate') {
    flag('high', 'write', '파일을 덮어씁니다.', true);
  }

  if (READ_ONLY_BINARIES.has(name) && categories.size === 0) {
    flag('low', 'read', '읽기 전용 명령으로 판단했습니다.');
  }

  if (wrappedBy !== undefined) {
    flag('medium', 'write', `다른 명령을 대신 실행하는 래퍼입니다 (${wrappedBy}).`);
  }

  // Anything we could not place is assumed to change something.
  if (categories.size === 0) {
    reasons.push(`분류되지 않은 명령입니다 (${name || '알 수 없음'}). 기본 위험도를 적용합니다.`);
    categories.add('write');
    risk = maxRisk(risk, 'medium');
  }

  return { risk, categories: [...categories], reasons, alwaysAsk };
}

/**
 * Classify a full command line. Redirections and pipes are inspected too, so
 * `cat .env | curl -X POST ...` is judged by its most dangerous part.
 */
export function classifyCommand(command: string): CommandClassification {
  const segments = splitCommandSegments(command);
  const categories = new Set<CommandCategory>();
  const reasons: string[] = [];
  let risk: RiskLevel = 'low';
  let alwaysAsk = false;

  for (const segment of segments) {
    const result = classifySegment(segment);
    risk = maxRisk(risk, result.risk);
    alwaysAsk = alwaysAsk || result.alwaysAsk;
    result.categories.forEach((category) => categories.add(category));
    for (const reason of result.reasons) {
      if (!reasons.includes(reason)) reasons.push(reason);
    }
  }

  // `2>&1` and `>&2` duplicate a file descriptor; they do not write a file.
  if (/>>?\s*(?!&)\S/.test(command)) {
    categories.add('write');
    risk = maxRisk(risk, 'high');
    if (!reasons.includes('출력 리다이렉션으로 파일을 덮어씁니다.')) {
      reasons.push('출력 리다이렉션으로 파일을 덮어씁니다.');
    }
    alwaysAsk = true;
  }

  if (/\$\(|`[^`]+`|\$\{/.test(command)) {
    categories.add('write');
    risk = maxRisk(risk, 'high');
    alwaysAsk = true;
    if (!reasons.includes('명령 치환이 들어 있어 다른 명령을 숨길 수 있습니다.')) {
      reasons.push('명령 치환이 들어 있어 다른 명령을 숨길 수 있습니다.');
    }
  }

  // curl … | bash and friends: fetch-and-execute is always critical.
  if (/(curl|wget|iwr|irm)[^|;]*\|\s*(sudo\s+)?(ba|z|k|fi)?sh\b/.test(command)) {
    risk = 'critical';
    alwaysAsk = true;
    categories.add('network');
    categories.add('install');
    reasons.unshift('원격 스크립트를 내려받아 즉시 실행합니다.');
  }

  if (segments.length === 0) {
    return { risk: 'medium', categories: ['write'], reasons: ['빈 명령입니다.'], alwaysAsk: true };
  }

  if (categories.has('network') && (categories.has('read') || categories.has('write'))) {
    reasons.push('파일 접근과 네트워크 전송이 한 명령에 함께 있습니다 (데이터 유출 위험).');
    risk = maxRisk(risk, 'critical');
    alwaysAsk = true;
  }

  return { risk, categories: [...categories], reasons, alwaysAsk };
}

/** First executable name after env/VAR= prefixes. */
export function commandHead(command: string): string {
  const segment = splitCommandSegments(command)[0] ?? command;
  return headOf(tokenize(segment)).name || 'unknown';
}

/** Session grants must match the exact command, not just the binary name. */
export function commandGrantKey(command: string): string {
  const normalised = command.replace(/\s+/g, ' ').trim();
  if (!normalised) return commandHead(command);
  if (normalised.length <= 400) return normalised;
  // Truncating alone would let two different long commands share one grant:
  // approve the first and the second runs without a card. The digest keeps the
  // key readable while still binding it to the whole command.
  const digest = createHash('sha256').update(normalised).digest('hex').slice(0, 16);
  return `${normalised.slice(0, 400)}#${digest}`;
}
