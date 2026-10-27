import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { admitNativeCommand } from './native-command-admission.js';
const command = readFileSync(new URL('./__fixtures__/native-ci-control.sh', import.meta.url), 'utf8');
it('identifies the evidenced protected routing control script', () => {
  expect(admitNativeCommand(command)).toMatchObject({ reason: 'native-command-admission', nextAction: expect.stringContaining('Sutura') });
});
it.each(['node --test test/unit.test.mjs', 'pytest', 'node scripts/custom-wrapper.mjs', 'git status', 'AssertionError: ci-routing-v2.mjs Git merge parent GITHUB_OUTPUT'])('defers without positively evidenced control structure: %s', value => {
  expect(admitNativeCommand(value)).toBeUndefined();
});
it('does not match a quoted assertion specimen containing the control script', () => {
  expect(admitNativeCommand(`printf '%s' '${command.replaceAll("'", '')}'`)).toBeUndefined();
});

it('defers a legitimate heredoc specimen followed by an application test', () => {
  expect(admitNativeCommand(`set -euo pipefail\ncat <<'CONTROL_SPECIMEN'\n${command}CONTROL_SPECIMEN\nnode --test test/example.test.mjs`)).toBeUndefined();
});
