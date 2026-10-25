import { expect, it } from 'vitest';
import { parseArgs } from './args.js';

it('offers assessment and help without setup', () => {
  expect(parseArgs([])).toEqual({ command: 'help' });
  expect(parseArgs(['assess', '--help'])).toEqual({ command: 'help' });
  expect(parseArgs(['assess', '/tmp/project', '--json'])).toEqual({ command: 'assess', path: '/tmp/project', json: true });
});
it('requires explicit digest and selected credential names for setup application', () => {
  expect(parseArgs(['init', '--plan', '--credential', 'NEBIUS_API_KEY'])).toMatchObject({ command: 'init', plan: true, credentials: ['NEBIUS_API_KEY'] });
  expect(parseArgs(['init', '--apply', 'a'.repeat(64)])).toMatchObject({ apply: 'a'.repeat(64) });
  expect(() => parseArgs(['init', '--apply', 'latest'])).toThrow(/digest/);
  expect(() => parseArgs(['init', '--plan', '--apply', 'a'.repeat(64)])).toThrow(/together/);
});
it.each(['upgrade', 'pause', 'resume', 'remove'])('previews %s through the same reviewed operation contract', operation => {
  expect(parseArgs([operation, '--plan'])).toMatchObject({ command: 'init', operation, plan: true });
});
