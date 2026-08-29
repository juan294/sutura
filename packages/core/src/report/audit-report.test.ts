import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';
import type { AuditFile } from '../domain.js';
import { renderAuditCaseFile } from './audit-casefile.js';
import { renderAuditMarkdown } from './audit-markdown.js';

async function fixture(): Promise<AuditFile> {
  const parsed = JSON.parse(await readFile(new URL('./fixtures/audit-approved.json', import.meta.url), 'utf8')) as Omit<AuditFile, 'cost'> & { cost: Pick<AuditFile['cost'], 'entries'> };
  return {
    ...parsed,
    cost: {
      entries: parsed.cost.entries,
      totalUsd: () => parsed.cost.entries.reduce((total, entry) => total + entry.usd, 0),
    },
  };
}

describe('reduced-assurance audit reports', () => {
  it('renders stable Markdown with a visible assurance warning', async () => {
    expect(renderAuditMarkdown(await fixture())).toMatchSnapshot();
  });

  it('renders stable HTML with a visible assurance warning', async () => {
    expect(renderAuditCaseFile(await fixture())).toMatchSnapshot();
  });
});
