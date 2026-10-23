import { isSensitiveRepositoryPath, isVerificationPrivatePath } from './repository-path.js';

export function isInstalledDependencyPath(path: string): boolean {
  const segments = path.split('/');
  return segments.includes('node_modules') || segments.includes('.pnpm') ||
    path === '.pnp.cjs' || path === '.pnp.loader.mjs' ||
    path.startsWith('.yarn/cache/') || path.startsWith('.yarn/unplugged/') ||
    path.startsWith('.yarn/install-state.gz');
}

/** Fixture bytes are source, never dependency-preparation inputs or lifecycle hooks. */
export function isDependencyFixturePath(path: string): boolean {
  const segments = path.split('/');
  const fixture = segments.indexOf('__fixtures__');
  const dependency = segments.indexOf('node_modules');
  return fixture >= 0 && dependency > fixture && !segments.includes('.pnpm');
}

export function isNpmrcPath(path: string): boolean {
  return path.split('/').at(-1)?.toLowerCase() === '.npmrc';
}

/** Npmrc content must also pass assertSafeNpmrcContent before being copied. */
export function isPublicSnapshotPath(path: string): boolean {
  if (path === '' || path.startsWith('/') || path.includes('\\') || /[\0\r\n]/u.test(path) ||
      path.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) return false;
  const fixture = isDependencyFixturePath(path);
  if (isInstalledDependencyPath(path) && !fixture) return false;
  if (isNpmrcPath(path)) {
    return !isVerificationPrivatePath(path) && !path.split('/').includes('.git');
  }
  return !isSensitiveRepositoryPath(path, { includeDependencies: fixture });
}

/** Preserve the small supported configuration without forwarding secrets or arbitrary npm behavior. */
export function assertSafeNpmrcContent(content: string, path: string): void {
  for (const [index, line] of content.split(/\r?\n/u).entries()) {
    const value = line.trim();
    if (/(?:^|[:#;\s])(?:_authToken|_auth|_password|username|password|token)\s*=/iu.test(value) ||
        /https?:\/\/[^/\s@]+@/iu.test(value)) {
      throw new Error(`repository .npmrc credentials at ${path}:${index + 1}`);
    }
    if (value === '' || value.startsWith('#') || value.startsWith(';')) continue;
    if (/^(?:engine-strict|legacy-peer-deps|prefer-offline)\s*=\s*(?:true|false)$/u.test(value)) continue;
    // The rejected content can contain a credential, including in an unknown key.
    throw new Error(`repository .npmrc unsupported configuration at ${path}:${index + 1}`);
  }
}
