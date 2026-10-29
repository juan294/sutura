import { createHash } from 'node:crypto';
export interface NativeCommandAdmission {
  reason: 'native-command-admission';
  nextAction: string;
}
export const CI_CONTROL_NEXT_ACTION = 'Bring the original repository, source commit and workflow/run evidence to Sutura coordination. Repair the protected routing, installation or event boundary before a distinct eligible event; preserve current CI settings.';

/** Recognize the evidenced protected routing script, without interpreting arbitrary wrappers. */
export function admitNativeCommand(command: string): NativeCommandAdmission | undefined {
  if (command.length > 20_000) return undefined;
  // Pin the complete reviewed control script, normalizing indentation only.
  // Marker words inside a heredoc or assertion are not executable control evidence.
  const normalized = command.trim().split(/\r?\n/u).map(line => line.trim()).join('\n');
  if (createHash('sha256').update(normalized).digest('hex') !== 'f91cd96a55b39c6c50f1a73c61687c4bfae40e11f775a97772a1d27a1a4b5234') return undefined;
  return { reason: 'native-command-admission', nextAction: CI_CONTROL_NEXT_ACTION };
}
