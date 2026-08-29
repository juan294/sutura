import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { GitRepository } from './repository.js';

const created: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'sutura-action-test-'));
  created.push(path);
  return path;
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('GitRepository.readSourceExcerpts', () => {
  it('reads a bounded regular file and records truncation', async () => {
    const root = await temporaryDirectory();
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src/example.ts'), 'one\ntwo\nthree\nfour\n');
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    const excerpts = await repository.readSourceExcerpts(
      root,
      [{ path: 'src/example.ts', line: 2 }],
      { maxFiles: 1, maxLinesPerFile: 2, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    );

    expect(excerpts).toEqual([{
      path: 'src/example.ts', startLine: 1, content: 'one\ntwo\n',
      truncated: true, boundaryComplete: true,
    }]);
  });

  it('rejects traversal and every symlink component', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    await writeFile(join(outside, 'secret.ts'), 'secret');
    await symlink(outside, join(root, 'linked'));
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    await expect(repository.readSourceExcerpts(
      root,
      [{ path: 'linked/secret.ts' }],
      { maxFiles: 1, maxLinesPerFile: 10, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    )).rejects.toThrow(/symlink/i);
    await expect(repository.readSourceExcerpts(
      root,
      [{ path: '../secret.ts' }],
      { maxFiles: 1, maxLinesPerFile: 10, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    )).rejects.toThrow(/unsafe source path/i);
  });

  it('stops reading at byte and character limits', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'large.ts'), 'abc\ndefghijk');
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    const [excerpt] = await repository.readSourceExcerpts(
      root,
      [{ path: 'large.ts' }],
      { maxFiles: 1, maxLinesPerFile: 10, maxCharactersPerFile: 5, maxBytesPerFile: 6 },
    );

    expect(excerpt).toMatchObject({ content: 'abc\n', truncated: true });
  });

  it('omits a safe missing output path and continues to a package fallback', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    const excerpts = await repository.readSourceExcerpts(
      root,
      [{ path: 'dist/generated.ts' }, { path: 'package.json' }],
      { maxFiles: 2, maxLinesPerFile: 10, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    );

    expect(excerpts).toEqual([{
      path: 'package.json',
      startLine: 1,
      content: '{"name":"fixture"}\n',
      truncated: false,
      boundaryComplete: true,
    }]);
  });

  it('returns a bounded window around a referenced far line', async () => {
    const root = await temporaryDirectory();
    await writeFile(
      join(root, 'far.ts'),
      Array.from({ length: 100 }, (_, index) => `line-${index + 1}`).join('\n'),
    );
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    const [excerpt] = await repository.readSourceExcerpts(
      root,
      [{ path: 'far.ts', line: 80 }],
      { maxFiles: 1, maxLinesPerFile: 5, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    );

    expect(excerpt?.startLine).toBe(78);
    expect(excerpt?.content).toBe('line-78\nline-79\nline-80\nline-81\nline-82\n');
    expect(excerpt?.truncated).toBe(true);
  });

  it('preserves CRLF and terminal-newline state', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'endings.ts'), 'one\r\ntwo\r\n');
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    const [excerpt] = await repository.readSourceExcerpts(
      root,
      [{ path: 'endings.ts' }],
      { maxFiles: 1, maxLinesPerFile: 10, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    );

    expect(excerpt?.content).toBe('one\r\ntwo\r\n');
  });

  it('rejects a referenced line beyond the end of a fully scanned file', async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, 'short.ts'), 'one\ntwo\n');
    const repository = new GitRepository({ token: 'test', workspaceRoot: root });

    await expect(repository.readSourceExcerpts(
      root,
      [{ path: 'short.ts', line: 999 }],
      { maxFiles: 1, maxLinesPerFile: 5, maxCharactersPerFile: 100, maxBytesPerFile: 100 },
    )).rejects.toThrow(/referenced source line exceeds/i);
  });
});

describe('GitRepository exact-SHA operations', () => {
  it.each(['regular', 'symlink'] as const)(
    '%s policy is read only from the exact commit and symlinks fail closed',
    async (kind) => {
      const root = await temporaryDirectory();
      const outside = join(root, 'outside-policy.json');
      await writeFile(outside, '{"version":1}');
      const sha = 'a'.repeat(40);
      const calls: Array<readonly string[]> = [];
      const repository = new GitRepository({
        token: 'test',
        workspaceRoot: root,
        run: async (_command, args) => {
          calls.push(args);
          if (args.includes('init')) {
            const checkoutDir = args.at(-1) as string;
            if (kind === 'symlink') {
              await symlink(outside, join(checkoutDir, '.sutura.json'));
            } else {
              await writeFile(join(checkoutDir, '.sutura.json'), '{"version":1}');
            }
          }
          return args.includes('rev-parse') ? `${sha}\n` : '';
        },
      });

      const read = repository.readPolicyAtSha('owner/repo', sha);

      if (kind === 'symlink') {
        await expect(read).rejects.toThrow(/policy must not be a symlink/iu);
      } else {
        await expect(read).resolves.toBe('{"version":1}');
      }
      expect(calls.some((args) => args.includes('fetch') && args.includes(sha)))
        .toBe(true);
    },
  );

  it('fetches and checks out only the requested commit', async () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const root = await temporaryDirectory();
    const repository = new GitRepository({
      token: 'test',
      workspaceRoot: root,
      run: async (command, args) => {
        calls.push({ command, args });
        if (args.includes('rev-parse')) return `${'a'.repeat(40)}\n`;
        return '';
      },
    });

    await repository.checkoutHead('owner/repo', 'a'.repeat(40));

    expect(calls.some(({ args }) => args.includes('a'.repeat(40)) && args.includes('--depth=1'))).toBe(true);
    expect(calls.some(({ args }) => args.includes('--detach') && args.includes('a'.repeat(40)))).toBe(true);
    expect(calls.every(({ args }) => args.includes('core.hooksPath=/dev/null'))).toBe(true);
    expect(calls.every(({ args }) => args.includes('commit.gpgSign=false'))).toBe(true);
  });

  it('falls back to a validated same-repo PR ref when raw SHA fetch fails', async () => {
    const calls: Array<readonly string[]> = [];
    const root = await temporaryDirectory();
    let fetches = 0;
    const repository = new GitRepository({
      token: 'test',
      workspaceRoot: root,
      run: async (_command, args) => {
        calls.push(args);
        if (args.includes('fetch') && ++fetches === 1) throw new Error('unadvertised');
        if (args.includes('rev-parse')) return `${'a'.repeat(40)}\n`;
        return '';
      },
    });

    await repository.checkoutHead('owner/repo', 'a'.repeat(40), 'feature/safe', 12);

    expect(calls.some((args) => args.includes('refs/heads/feature/safe'))).toBe(true);
  });

  it('refuses to publish if checkout HEAD differs from the failing SHA', async () => {
    const root = await temporaryDirectory();
    const repository = new GitRepository({
      token: 'test',
      workspaceRoot: root,
      run: async () => `${'b'.repeat(40)}\n`,
    });

    await expect(repository.publishFix({
      branch: 'sutura/fix-12',
      checkoutDir: root,
      diff: 'diff --git a/a b/a\n',
      headSha: 'a'.repeat(40),
      message: 'fix: test',
    })).rejects.toThrow(/exact failing SHA/i);
  });
});
