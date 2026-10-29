import { needsNodeReproductionProfile } from './reproduction-admission.js';
import { lstat, realpath } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { listSnapshotFiles } from '../executor/contree.js';
import { readBoundedRegularFile } from '../verification/source.js';
import { policyAllowsSourceRead } from '../policy/evaluate.js';
import { resolveReproductionPlan, type ReproductionPlanInput, type ReproductionResolution } from './reproduction-plan.js';

/** Only declared protected inputs are read. Candidate policy is never loaded here. */
export async function resolveReproductionAtSource(root: string, input: Omit<ReproductionPlanInput, 'sources' | 'sourcePaths'>): Promise<ReproductionResolution> {
  const matching = input.policy.reproductionProfiles?.filter(profile => profile.nativeCommand === input.command) ?? [];
  if (!matching.length) return needsNodeReproductionProfile(input.command, input.native) ? { status: 'stopped', reason: 'reproduction-profile-required', nextAction: 'Prepare a reviewed protected reproduction profile for the exact Node wrapper/source/runtime, complete native failure set and full-verification allowance; no provider preparation was started' } : { status: 'not-profiled' };
  const sources: Record<string, string> = {};
  try {
    const canonical = await realpath(root);
    const sourcePaths = await listSnapshotFiles(canonical, 'repository');
    let total = 0;
    for (const path of [...new Set(matching.flatMap(profile => profile.sourceInputs.map(item => item.path)))]) {
      if (!sourcePaths.includes(path) || !policyAllowsSourceRead(path, input.policy)) continue;
      let current = canonical;
      for (const part of path.split('/')) {
        current = join(current, part);
        if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink profile input ${path}`);
      }
      if (!(await realpath(current)).startsWith(`${canonical}${sep}`)) throw new Error(`Profile input escapes source ${path}`);
      const bytes = await readBoundedRegularFile(current, 1_048_576);
      total += bytes.length;
      if (total > 8_388_608 || bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new Error(`Profile input bounds/UTF-8 invalid at ${path}`);
      sources[path] = bytes.toString('utf8');
    }
    return resolveReproductionPlan({ ...input, sources, sourcePaths });
  } catch (error) {
    return { status: 'stopped', reason: 'reproduction-profile-input-unavailable', nextAction: `Review the protected profile input: ${error instanceof Error ? error.message : 'source read failed'}` };
  }
}
