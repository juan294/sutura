import { runCandidateInstall } from './test-candidate-install.mjs';

const result = await runCandidateInstall();
process.stdout.write(`[PASS] Packed sutura@${result.packageVersion} installs with Action ${result.actionCommit}.\n`);
