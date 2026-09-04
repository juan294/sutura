import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const submissionUrl = new URL('docs/devpost/sutura-submission.md', root);
const videoUrl = new URL('docs/devpost/sutura-video-script.md', root);
const feedbackUrl = new URL('docs/feedback/2026-10-sutura-nebius-feedback.md', root);

async function text(url) {
  return readFile(url, 'utf8');
}

function count(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function seconds(value) {
  const match = /^(\d+):(\d{2})$/u.exec(value);
  assert.ok(match, `invalid video timestamp: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function assertVersionConsistency(document, currentVersion) {
  assert.match(document, new RegExp(`\\bsutura@${escapeRegex(currentVersion)}\\b`, 'u'));
  for (const line of document.split('\n')) {
    for (const match of line.matchAll(/(?<![\d.])(?:v)?(\d+\.\d+\.\d+)(?![\d.])/gu)) {
      if (match[1] === currentVersion) continue;
      assert.match(
        line,
        /\b(?:historical|history)\b/iu,
        `version ${match[0]} differs from ${currentVersion} without a history label`,
      );
    }
  }
}

test('submission source carries the qualitative judge story and one architecture diagram', async () => {
  const [submission, packageJson] = await Promise.all([
    text(submissionUrl),
    text(new URL('package.json', root)).then(JSON.parse),
  ]);

  assert.match(submission, /^# Sutura: Verified Self-Healing CI$/mu);
  assert.ok(submission.includes(packageJson.description));
  for (const heading of [
    'Problem',
    'Who it is for',
    'Why existing fix-CI tools are insufficient',
    'Product workflow',
    'Architecture',
    'Runtime roles',
    'Significant work since the submission period opened',
  ]) {
    assert.match(submission, new RegExp(`^## ${heading}$`, 'mu'));
  }
  for (const role of [
    'Nano',
    'Super',
    'Ultra',
    'Token Factory',
    'ConTree',
    'Data Lab',
    'ATIF',
    'NeMo Agent Toolkit',
  ]) {
    assert.match(submission, new RegExp(`\\b${role}\\b`, 'u'));
  }
  assert.equal(count(submission, /^```mermaid\n[\s\S]*?^```$/gmu), 1);
  assert.match(submission, /2026-08-26/u);

  assertVersionConsistency(submission, packageJson.version);
});

test('submission, video, and feedback links resolve to repository files', async () => {
  for (const documentUrl of [submissionUrl, videoUrl, feedbackUrl]) {
    const document = await text(documentUrl);
    const targets = [...document.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)]
      .map((match) => match[1])
      .filter((target) => !/^(?:https?:|#)/u.test(target));
    assert.ok(targets.length > 0, `${fileURLToPath(documentUrl)} must contain a local link`);
    for (const target of targets) {
      const targetUrl = new URL(target, documentUrl);
      const info = await stat(targetUrl);
      assert.ok(info.isFile(), `${fileURLToPath(targetUrl)} must be a file`);
    }
  }
});

test('video script has six contiguous sections and ends before 180 seconds', async () => {
  const video = await text(videoUrl);
  const expected = [
    ['0:00', '0:20'],
    ['0:20', '1:20'],
    ['1:20', '1:55'],
    ['1:55', '2:25'],
    ['2:25', '2:45'],
    ['2:45', '2:55'],
  ];
  const ranges = [...video.matchAll(/^## (\d+:\d{2})-(\d+:\d{2}) — .+$/gmu)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(ranges, expected);
  for (let index = 0; index < ranges.length; index += 1) {
    assert.ok(seconds(ranges[index][0]) < seconds(ranges[index][1]));
    if (index > 0) assert.equal(ranges[index - 1][1], ranges[index][0]);
  }
  assert.ok(seconds(ranges.at(-1)[1]) < 180);
  assert.doesNotMatch(video, /\b(?:fix rate|catch rate|accuracy|percentage-point|USD|\d+\/\d+)\b/iu);

  const counterfactual = video.slice(
    video.indexOf('## 1:20-1:55'),
    video.indexOf('## 1:55-2:25'),
  );
  const arena = video.slice(
    video.indexOf('## 2:25-2:45'),
    video.indexOf('## 2:45-2:55'),
  );
  assert.match(counterfactual, /only after[\s\S]*WS-2[\s\S]*evidence is committed/iu);
  assert.match(arena, /only after[\s\S]*WS-2[\s\S]*evidence is committed/iu);
});

test('version contract rejects drift in bare, npm, tag, Action, and release-link forms', () => {
  const current = '0.2.1';
  const canonical = `Canonical package identity: sutura@${current}.`;
  for (const reference of [
    'Release 9.9.9',
    'npm install sutura@9.9.9',
    'tag v9.9.9',
    'uses: juan294/sutura@v9.9.9',
    '[release](https://github.com/juan294/sutura/releases/tag/v9.9.9)',
  ]) {
    assert.throws(() => assertVersionConsistency(`${canonical}\n${reference}`, current), /differs/u);
  }
  assert.doesNotThrow(() => assertVersionConsistency(
    `${canonical}\nHistorical release history: sutura@0.2.0, tag v0.2.0.`,
    current,
  ));
});

test('feedback separates local contracts, observed incidents, and requests', async () => {
  const feedback = await text(feedbackUrl);
  const local = feedback.indexOf('## Verified local integration behavior');
  const observed = feedback.indexOf('## Observed live integration problems');
  const requested = feedback.indexOf('## Requested features');
  assert.ok(local >= 0 && observed > local && requested > observed);

  const observedText = feedback.slice(observed, requested);
  for (const incident of [
    /ConTree[\s\S]*HTTP\s+404/u,
    /Tavily[\s\S]*HTTP\s+403/u,
    /Nemotron[\s\S]*invalid JSON/u,
    /force_nonempty_content/u,
    /completion-limit/u,
  ]) {
    assert.match(observedText, incident);
  }
});

test('submission sources contain no unfinished markers', async () => {
  const documents = await Promise.all([text(submissionUrl), text(videoUrl), text(feedbackUrl)]);
  for (const document of documents) {
    assert.doesNotMatch(document, /\b(?:TODO|TBD|placeholder|coming soon|insert here|add later)\b/iu);
    assert.doesNotMatch(document, /https?:\/\/(?:example\.com|localhost)\b/iu);
  }
});
