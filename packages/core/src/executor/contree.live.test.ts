/// <reference types="node" />

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ContreeExecutor } from './contree.js';
import { assertSuccessfulRun } from './live-diagnostics.js';
import { prepareGitTooling } from './live-setup.js';

const token = process.env.CONTREE_TOKEN;
const project = process.env.CONTREE_PROJECT;
const liveEnabled =
  process.env.SUTURA_LIVE === '1' && Boolean(token) && Boolean(project);
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const baseUrl = 'https://api.tokenfactory.nebius.com/sandboxes/v1/';

describe.skipIf(!liveEnabled)('ConTree live activation', () => {
  let executor: ContreeExecutor | undefined;
  let baseImage: Promise<string> | undefined;
  let toolingBaseImage: Promise<string> | undefined;

  function liveExecutor(): ContreeExecutor {
    executor ??= new ContreeExecutor({
      token: token ?? '',
      project: project ?? '',
      maxOps: 9,
      operationTimeoutMs: 30 * 60 * 1_000,
    });
    return executor;
  }

  function importedBase(): Promise<string> {
    baseImage ??= liveExecutor().importImage('node:22-slim');
    return baseImage;
  }

  function toolingBase(): Promise<string> {
    toolingBaseImage ??= importedBase().then((base) =>
      prepareGitTooling(liveExecutor(), base),
    );
    return toolingBaseImage;
  }

  it(
    'lists images, imports Node 22, and completes an echo round trip',
    async () => {
      const response = await fetch(new URL('images?limit=1', baseUrl), {
        headers: {
          Authorization: `Bearer ${token ?? ''}`,
          Project: project ?? '',
        },
      });
      expect(response.ok).toBe(true);
      const body = (await response.json()) as { images?: unknown[] };
      expect(body.images?.length).toBeGreaterThan(0);

      const image = await importedBase();
      const echo = await liveExecutor().run(image, 'echo sutura-live');
      expect(echo.exitCode).toBe(0);
      expect(echo.stdout.trim()).toBe('sutura-live');
    },
    10 * 60 * 1_000,
  );

  it(
    'snapshots this repository and installs and tests it in the sandbox',
    async () => {
      const image = await liveExecutor().snapshot(repoRoot, await toolingBase(), {
        profile: 'repository',
        mode: 'overlay',
      });
      const result = await liveExecutor().run(
        image,
        'corepack enable && pnpm install && pnpm -r test',
        { cwd: '/workspace', timeoutSec: 20 * 60 },
      );

      assertSuccessfulRun('sandbox install and test', result);
    },
    30 * 60 * 1_000,
  );

  it(
    'fans out nine runs from one parent image',
    async () => {
      const results = await liveExecutor().runMany(
        await importedBase(),
        Array.from({ length: 9 }, (_, index) => `echo fanout-${index}`),
      );

      expect(results).toHaveLength(9);
      expect(results.every(({ exitCode }) => exitCode === 0)).toBe(true);
    },
    10 * 60 * 1_000,
  );
});
