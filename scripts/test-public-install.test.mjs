import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { verifyInstall } from './install-test-lib.mjs';

const ACTION_SHA = 'b'.repeat(40);

test('public install uses only sutura@0.2.0 and verifies the independently resolved release SHA', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-public-unit-'));
  const calls = [];
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    const result = await verifyInstall({
      mode: 'public', root: temporary,
      dependencies: {
        resolvePublicCommit: async (version) => {
          calls.push(['resolve', version]);
          return ACTION_SHA;
        },
        pack: async (source, destination) => {
          calls.push(['pack', source]);
          const tarball = join(destination, 'sutura-0.2.0.tgz');
          await writeFile(tarball, 'public');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.0', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer) => {
          calls.push(args);
          if (args[0] === 'init') {
            await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
            await writeFile(join(consumer, '.github', 'workflows', 'sutura.yml'),
              `uses: juan294/sutura@${ACTION_SHA}\n`);
            return '';
          }
          if (args[0] === 'doctor') return '[PASS] public\n';
          if (args[0] === '--version') return '0.2.0\n';
          throw new Error(`unexpected invocation ${args.join(' ')}`);
        },
      },
    });

    assert.equal(result.mode, 'public');
    assert.equal(result.actionCommit, ACTION_SHA);
    assert.deepEqual(calls[0], ['resolve', '0.2.0']);
    assert.deepEqual(calls[1], ['pack', 'sutura@0.2.0']);
    assert.ok(!JSON.stringify(calls).includes('@latest'));
    assert.ok(!JSON.stringify(calls).includes('--action-sha'));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('public install fails when the generated workflow differs from the release tag commit', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sutura-public-mismatch-'));
  try {
    await writeFile(join(temporary, 'LICENSE'), 'MIT fixture\n');
    await assert.rejects(() => verifyInstall({
      mode: 'public', root: temporary,
      dependencies: {
        resolvePublicCommit: async () => ACTION_SHA,
        pack: async (_source, destination) => {
          const tarball = join(destination, 'sutura.tgz');
          await writeFile(tarball, 'public');
          return tarball;
        },
        install: async (_tarball, consumer) => {
          await mkdir(join(consumer, 'node_modules', 'sutura'), { recursive: true });
          await writeFile(join(consumer, 'node_modules', 'sutura', 'package.json'), JSON.stringify({
            name: 'sutura', version: '0.2.0', dependencies: {},
          }));
          await writeFile(join(consumer, 'node_modules', 'sutura', 'LICENSE'), 'MIT fixture\n');
        },
        invoke: async (_binary, args, consumer) => {
          if (args[0] === 'init') {
            await mkdir(join(consumer, '.github', 'workflows'), { recursive: true });
            await writeFile(join(consumer, '.github', 'workflows', 'sutura.yml'),
              `uses: juan294/sutura@${'c'.repeat(40)}\n`);
          }
          if (args[0] === '--version') return '0.2.0\n';
          return '[PASS]\n';
        },
      },
    }), /does not use release commit/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
