import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('trusted Sutura workflow', () => {
  it('uses default-branch action code with least permissions and no deploy secrets', async () => {
    const workflow = await readFile(resolve(repositoryRoot, '.github/workflows/sutura.yml'), 'utf8');

    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain('conclusion == \'failure\'');
    expect(workflow).toContain("workflow_run.conclusion == 'timed_out'");
    expect(workflow).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('checks: write');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pull-requests: write');
    expect(workflow).toContain('github-token: ${{ github.token }}');
    expect(workflow).toContain('group: sutura-${{ github.event.workflow_run.id }}');
    expect(workflow).toContain('require-fixed: true');
    expect(workflow).toContain('capture-replay: true');
    expect(workflow).not.toMatch(/deploy|production|environment:/i);
  });

  it('allows CI to be dispatched for a token-created demo PR', async () => {
    const workflow = await readFile(resolve(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toContain('workflow_dispatch:');
  });
});
