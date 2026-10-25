import { describe, expect, it } from 'vitest';
import { runCommand } from './command.js';

describe('bounded native commands', () => {
  it('retains normal output', async () => {
    await expect(runCommand(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      timeoutMs: 2_000, maxOutputBytes: 128,
    })).resolves.toBe('ok');
  });

  it('rejects combined stdout and stderr beyond the limit', async () => {
    await expect(runCommand(process.execPath, ['-e',
      'process.stdout.write("x".repeat(80)); process.stderr.write("y".repeat(80))'], {
      maxOutputBytes: 100,
    })).rejects.toThrow('output limit');
  });

  it('terminates a command at its deadline', async () => {
    await expect(runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], {
      timeoutMs: 50,
    })).rejects.toThrow('timed out');
  });
});
