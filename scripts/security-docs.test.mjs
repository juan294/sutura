import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('security docs distinguish ZDR inference from explicit Data Lab retention', async () => {
  const [boundaries, privateRepositories, providerProcessing, readme] = await Promise.all([
    readFile('docs/security/data-boundaries.md', 'utf8'),
    readFile('docs/security/private-repositories.md', 'utf8'),
    readFile('docs/security/provider-processing.md', 'utf8'),
    readFile('README.md', 'utf8'),
  ]);

  for (const value of [boundaries, privateRepositories, providerProcessing]) {
    assert.match(value, /Zero Data Retention|ZDR/u);
    assert.match(value, /explicit (?:Data Lab )?(?:dataset )?upload/iu);
  }
  assert.match(providerProcessing, /EU-North1 \(Finland\)/u);
  assert.match(providerProcessing, /delete the dataset/iu);
  assert.match(providerProcessing, /GitHub Marketplace/u);
  assert.match(providerProcessing, /participant/iu);
  assert.match(providerProcessing, /Data Processing Agreement/u);
  assert.match(providerProcessing, /sub-processor/iu);
  assert.match(privateRepositories, /checks: write/u);
  assert.match(privateRepositories, /publicReviewConfirmed/u);
  assert.match(readme, /docs\/security\/provider-processing\.md/u);
  assert.match(readme, /datalab-experiment\.mjs prepare/u);
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(readme.includes(`test-public-install.mjs --release ${version}`));
  assert.match(readme, /After publication, `node scripts\/test-public-install\.mjs/u);
  assert.ok(readme.includes(`Version ${version} includes repository assessment`));
  assert.match(readme, /recorded Case Lab benchmark[\s\S]{0,50}remains v0\.3\.9/u);
  assert.ok(readme.includes(`does not measure ${version} repair effectiveness`));
  assert.match(await readFile('docs/adoption/ws-3-marketplace-checklist.md', 'utf8'),
    /MARKETPLACE-INSTALL-CONFIRMED/u);
});
