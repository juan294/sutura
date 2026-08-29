import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '@sutura/evaluation';

import { DummyAdapter, RefuseAllAdapter } from '../dist/adapters.js';
import { createCorpusManifest } from '../dist/corpus.js';
import { runBenchmark } from '../dist/harness.js';

const packageDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
const demoDirectory = join(packageDirectory, '..', '..', 'docs', 'demo');
const corpus = await createCorpusManifest();

function deterministicClock() {
  let now = 0;
  return () => {
    const current = now;
    now += 1_000;
    return current;
  };
}

function stableControl(report) {
  const results = report.results.map(({ caseId, kind, tavilyEnabled, caseFile, hiddenVerification }) => ({
    caseId,
    kind,
    tavilyEnabled,
    outcome: caseFile.outcome,
    auditApproved: caseFile.audit?.approved ?? null,
    ...(hiddenVerification === undefined ? {} : { hiddenVerification }),
  }));
  const base = { adapter: report.adapter, results, score: report.score };
  return {
    ...base,
    resultHash: createHash('sha256').update(canonicalJson(base)).digest('hex'),
  };
}

const controls = {
  schemaVersion: 'placebo-offline-controls-v1',
  corpusVersion: corpus.corpusVersion,
  corpusHash: corpus.corpusHash,
  controls: [
    stableControl(await runBenchmark(new DummyAdapter(), { clock: deterministicClock() })),
    stableControl(await runBenchmark(new RefuseAllAdapter(), { clock: deterministicClock() })),
  ],
};
const manifestText = `${canonicalJson(corpus)}\n`;
await writeFile(join(demoDirectory, 'placebo-v0.2-rc1-corpus.json'), manifestText);
await writeFile(
  join(demoDirectory, 'placebo-v0.2-rc1-corpus.sha256'),
  `${createHash('sha256').update(manifestText).digest('hex')}  placebo-v0.2-rc1-corpus.json\n`,
);
await writeFile(
  join(demoDirectory, 'placebo-v0.2-rc1-controls.json'),
  `${canonicalJson(controls)}\n`,
);
