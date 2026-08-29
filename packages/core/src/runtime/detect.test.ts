import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  MAX_RUNTIME_EVIDENCE_ENTRIES,
  RuntimeDetectionError,
  detectRuntime,
  runtimeEvidencePaths,
} from './detect.js';

describe('detectRuntime', () => {
  it('selects Node and Python from bounded repository and command evidence', () => {
    expect(detectRuntime({ paths: ['package.json', 'pnpm-lock.yaml'], failingCommand: 'pnpm test' }).id)
      .toBe('node');
    expect(detectRuntime({ paths: ['pyproject.toml', 'uv.lock', 'src/widget.py'], failingCommand: 'pytest' }).id)
      .toBe('python');
  });

  it('fails closed on equal-confidence polyglot evidence with configuration guidance', () => {
    expect(() => detectRuntime({
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    })).toThrowError(RuntimeDetectionError);
    expect(() => detectRuntime({
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    })).toThrow(/\.sutura\.json.*runtime/iu);
  });

  it('uses an explicit allowlisted runtime only to resolve the polyglot choice', () => {
    const evidence = {
      paths: ['package.json', 'pnpm-lock.yaml', 'pyproject.toml', 'uv.lock'],
      failingCommand: 'make test',
    } as const;
    expect(detectRuntime({ ...evidence, configuredRuntime: 'node' }).id).toBe('node');
    expect(detectRuntime({ ...evidence, configuredRuntime: 'python' }).id).toBe('python');
  });

  it.each([
    'tests/test_widget.py:14: AssertionError',
    'File "/workspace/tests/test_widget.py", line 14, in test_widget',
    'file:///workspace/tests/test_widget.py:14: AssertionError',
    '/home/runner/work/widget/widget/tests/test_widget.py:14: AssertionError',
    '/__w/widget/widget/tests/test_widget.py:14: AssertionError',
  ])('uses Python source path from failed log as runtime evidence: %s', (failedLog) => {
    expect(detectRuntime({ paths: [], failingCommand: 'make test', failedLog }).id).toBe('python');
  });

  it('bounds visited directory entries even when the tree contains no files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-many-dirs-'));
    try {
      await Promise.all(Array.from(
        { length: MAX_RUNTIME_EVIDENCE_ENTRIES + 1 },
        (_, index) => mkdir(join(root, `dir-${String(index).padStart(4, '0')}`)),
      ));
      await expect(runtimeEvidencePaths(root)).rejects.toThrow(/exceeds.*entries/iu);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not follow a symlinked evidence directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sutura-runtime-symlink-'));
    const outside = await mkdtemp(join(tmpdir(), 'sutura-runtime-outside-'));
    try {
      await writeFile(join(root, 'package.json'), '{}\n');
      await writeFile(join(outside, 'hidden.py'), 'value = 1\n');
      await symlink(outside, join(root, 'python-source'));
      await expect(runtimeEvidencePaths(root)).resolves.toEqual(['package.json']);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
