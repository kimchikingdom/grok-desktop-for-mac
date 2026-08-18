import path from 'node:path';

type SensitiveRule = { test: RegExp; reason: string };

const FILE_RULES: SensitiveRule[] = [
  { test: /^\.env(?!\.example$)(\..+)?$/i, reason: '환경변수 파일에는 보통 비밀 값이 들어 있습니다.' },
  { test: /^\.envrc$/i, reason: 'direnv 파일에는 비밀 값이 들어 있을 수 있습니다.' },
  { test: /\.env$/i, reason: '환경변수 파일에는 보통 비밀 값이 들어 있습니다.' },
  { test: /^(auth|tokens?|session)\.json$/i, reason: '로그인 또는 세션 자격 증명 파일입니다.' },
  { test: /^\.npmrc$|^\.netrc$|^\.git-credentials$/i, reason: '레지스트리 또는 Git 자격 증명 파일입니다.' },
  { test: /^id_(rsa|dsa|ecdsa|ed25519)$/i, reason: 'SSH 키 파일입니다.' },
  { test: /\.(pem|key|p12|pfx|jks|keystore)$/i, reason: '개인 키 또는 인증서 파일입니다.' },
  { test: /^(credentials|secrets?|service-account.*)\.(json|ya?ml|toml)$/i, reason: '자격 증명 파일로 보입니다.' },
  { test: /^(cookies|Login Data|Web Data)(\.sqlite)?$/i, reason: '브라우저 세션 데이터입니다.' },
  { test: /\.(kdbx|keychain|keychain-db)$/i, reason: '비밀번호 저장소 파일입니다.' },
];

const DIR_RULES: SensitiveRule[] = [
  { test: /(^|\/)\.ssh(\/|$)/, reason: 'SSH 키 디렉터리입니다.' },
  { test: /(^|\/)\.aws(\/|$)/, reason: 'AWS 자격 증명 디렉터리입니다.' },
  { test: /(^|\/)\.gnupg(\/|$)/, reason: 'GPG 키 디렉터리입니다.' },
  { test: /(^|\/)\.kube(\/|$)/, reason: 'Kubernetes 자격 증명 디렉터리입니다.' },
  { test: /(^|\/)\.docker(\/|$)/, reason: 'Docker 자격 증명 디렉터리입니다.' },
  { test: /(^|\/)\.grok(\/|$)/, reason: 'Grok CLI 자격 증명과 세션이 있는 디렉터리입니다.' },
  { test: /(^|\/)Keychains(\/|$)/, reason: 'macOS 키체인 디렉터리입니다.' },
];

export type SensitivityVerdict = { sensitive: boolean; reasons: string[] };

/** Flag files whose contents should never be sent to the model without a warning. */
export function classifySensitivity(targetPath: string): SensitivityVerdict {
  const normalized = targetPath.split(path.sep).join('/');
  const base = normalized.split('/').pop() ?? normalized;
  const reasons: string[] = [];

  for (const rule of FILE_RULES) {
    if (rule.test.test(base)) reasons.push(rule.reason);
  }
  for (const rule of DIR_RULES) {
    if (rule.test.test(normalized)) reasons.push(rule.reason);
  }

  return { sensitive: reasons.length > 0, reasons };
}

export function isSensitivePath(targetPath: string): boolean {
  return classifySensitivity(targetPath).sensitive;
}

/** Directories that are never worth walking for the file explorer. */
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'target',
  '.next',
  '.turbo',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  'DerivedData',
]);

export function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name);
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.icns', '.bmp', '.tiff',
  '.pdf', '.zip', '.gz', '.tar', '.bz2', '.7z', '.rar', '.dmg', '.pkg',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.flac',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.so', '.dylib', '.dll', '.exe', '.bin', '.class', '.jar', '.wasm',
  '.sqlite', '.db', '.pyc',
]);

export function looksBinary(targetPath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(targetPath).toLowerCase());
}

/** Files above this size are not previewed or diffed inline. */
export const MAX_INLINE_FILE_BYTES = 512 * 1024;
