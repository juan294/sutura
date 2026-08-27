export interface SensitiveRepositoryPathOptions {
  includeDependencies?: boolean;
}

export function isSensitiveRepositoryPath(
  path: string,
  options: Readonly<SensitiveRepositoryPathOptions> = {},
): boolean {
  const segments = path.split('/');
  if (
    segments.includes('.git') ||
    (!options.includeDependencies && segments.includes('node_modules'))
  ) {
    return true;
  }

  const basename = segments.at(-1)?.toLowerCase() ?? '';
  return (
    basename === '.env' ||
    basename.startsWith('.env.') ||
    basename === '.netrc' ||
    basename === '.npmrc' ||
    basename === '.pypirc' ||
    basename === 'credentials.json' ||
    basename === 'id_rsa' ||
    basename === 'id_ed25519' ||
    /\.(?:key|pem|p12|pfx)$/u.test(basename)
  );
}
