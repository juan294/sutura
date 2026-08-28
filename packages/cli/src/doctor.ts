import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DoctorArguments } from './args.js';
import { VERSION } from './args.js';
import { type CommandRunner, resolveRepository, runCommand } from './command.js';

export interface DoctorOptions {
  cwd?: string;
  run?: CommandRunner;
}

export interface DoctorResult {
  exitCode: 0 | 1;
  lines: string[];
}

function line(passed: boolean, text: string): string {
  return `[${passed ? 'PASS' : 'FAIL'}] ${text}`;
}

function listed(output: string): Set<string> {
  return new Set(output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean));
}

export async function doctorSutura(
  request: DoctorArguments,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const cwd = options.cwd ?? process.cwd();
  const run = options.run ?? runCommand;
  const lines: string[] = [];
  const workflowPath = join(cwd, '.github', 'workflows', 'sutura.yml');
  let workflow = '';
  try {
    const metadata = await lstat(workflowPath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error('unsafe workflow path');
    workflow = await readFile(workflowPath, 'utf8');
    lines.push(line(true, 'Sutura workflow exists.'));
  } catch {
    lines.push(line(false, 'Sutura workflow is missing or unsafe.'));
  }
  const releaseRef = `juan294/sutura@v${VERSION}`;
  lines.push(line(workflow.includes(`uses: ${releaseRef}`), `Workflow uses ${releaseRef}.`));

  try {
    const repository = await resolveRepository(cwd, request.repository, run);
    const [secretOutput, variableOutput] = await Promise.all([
      run('gh', ['secret', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }),
      run('gh', ['variable', 'list', '--repo', repository, '--json', 'name', '--jq', '.[].name'], { cwd }),
    ]);
    const secrets = listed(secretOutput);
    const variables = listed(variableOutput);
    for (const name of ['NEBIUS_API_KEY', 'CONTREE_TOKEN']) {
      const configured = secrets.has(name);
      lines.push(line(configured, `GitHub secret ${name} is ${configured ? 'configured' : 'missing'}.`));
    }
    const projectConfigured = variables.has('CONTREE_PROJECT');
    lines.push(line(
      projectConfigured,
      `GitHub variable CONTREE_PROJECT is ${projectConfigured ? 'configured' : 'missing'}.`,
    ));
    if (secrets.has('TAVILY_API_KEY')) {
      lines.push(line(true, 'Optional GitHub secret TAVILY_API_KEY is configured.'));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    lines.push(line(false, `GitHub configuration could not be inspected: ${detail}`));
  }
  return { exitCode: lines.some((value) => value.startsWith('[FAIL]')) ? 1 : 0, lines };
}
