import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const nodeModules = process.argv[2];
if (!nodeModules) throw new Error('node_modules path is required');

const modulesPath = join(nodeModules, '.modules.yaml');
const modules = JSON.parse(await readFile(modulesPath, 'utf8'));
modules.prunedAt = 'Thu, 01 Jan 1970 00:00:00 GMT';
await writeFile(modulesPath, `${JSON.stringify(modules, null, 2)}\n`);

const statePath = join(nodeModules, '.pnpm-workspace-state-v1.json');
const state = JSON.parse(await readFile(statePath, 'utf8'));
state.lastValidatedTimestamp = 0;
await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
