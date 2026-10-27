import { SUTURA_SANDBOX_ENV } from '../executor/environment.js';
import { nodeTestRunner } from '../engine/focus/node-test.js';
import { repositoryPath, shellWords } from '../engine/focus/shared.js';
import { isSensitiveRepositoryPath, isVerificationPrivatePath } from '../security/repository-path.js';
export interface ProfileCaller {
  workflowId: number; path: string; blobSha: string; protectedRef: string; engineSha: string;
}
export interface ReproductionProfile {
  id: string; nativeCommand: string; cwd: string; argv: readonly string[];
  sourceInputs: readonly { path: string; sha256: string }[];
  nativeNodeVersion: string; sandboxNodeVersion: string; runtimeEquivalenceReason?: string;
  providerTimeoutLimitKey?: string;
  imageRef: string; probeTimeoutSec: number; fullCommand: string; fullTimeoutSec: number;
  env?: Readonly<Record<string, string>>;
  callers: readonly ProfileCaller[]; approverIds: readonly number[];
}
const KEYS = ['id', 'nativeCommand', 'cwd', 'argv', 'sourceInputs', 'nativeNodeVersion', 'sandboxNodeVersion', 'runtimeEquivalenceReason', 'providerTimeoutLimitKey', 'imageRef', 'probeTimeoutSec', 'fullCommand', 'fullTimeoutSec', 'env', 'callers', 'approverIds'];
function invalid(path: string, reason: string): never { throw new Error(`reproductionProfiles ${path}: ${reason}`); }
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid(path, 'object contains invalid fields');
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, maximum = 256): string {
  if (typeof value !== 'string' || !value || value.length > maximum || value.trim() !== value || !/^[\x20-\x7e]+$/u.test(value)) invalid(path, 'bounded printable text required');
  return value;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) invalid(path, `at most ${maximum} entries required`);
  return value;
}
function integer(value: unknown, path: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) invalid(path, `positive integer at most ${maximum} required`);
  return value as number;
}
function path(value: unknown, field: string): string {
  const result = text(value, field, 240);
  if (repositoryPath(result) !== result || result === '.' || result.split('/').some(part => ['.git', 'node_modules'].includes(part)) || isSensitiveRepositoryPath(result) || isVerificationPrivatePath(result)) invalid(field, 'safe public repository-relative input required');
  return result;
}
function sha(value: unknown, field: string, length: number): string {
  const result = text(value, field, length);
  if (!(new RegExp(`^[a-f0-9]{${length}}$`, 'u')).test(result)) invalid(field, `exact ${length}-character digest required`);
  return result;
}
export function parseReproductionProfiles(value: unknown): ReproductionProfile[] {
  const profiles = list(value, '', 8).map((entry, index): ReproductionProfile => {
    const name = `[${index}]`, v = object(entry, KEYS, name);
    const id = text(v.id, `${name}.id`, 64);
    if (!/^[a-z][a-z0-9-]*$/u.test(id)) invalid(`${name}.id`, 'lowercase identifier required');
    const nativeCommand = text(v.nativeCommand, `${name}.nativeCommand`), words = shellWords(nativeCommand);
    if (!words?.length || !['node', 'npm', 'pnpm', 'yarn'].includes(words[0]!)) invalid(`${name}.nativeCommand`, 'plain reviewed Node wrapper command required');
    const cwd = v.cwd === '.' ? '.' : path(v.cwd, `${name}.cwd`);
    const argv = list(v.argv, `${name}.argv`, 64).map((arg, i) => text(arg, `${name}.argv[${i}]`, 512));
    const invocation = nodeTestRunner.parse(argv);
    if (argv[0] !== 'node' || !invocation || typeof invocation === 'string') invalid(`${name}.argv`, 'supported direct Node test runner argv required');
    const sourceInputs = list(v.sourceInputs, `${name}.sourceInputs`, 16).map((input, i) => {
      const item = object(input, ['path', 'sha256'], `${name}.sourceInputs[${i}]`);
      return Object.freeze({ path: path(item.path, `${name}.sourceInputs[${i}].path`), sha256: sha(item.sha256, `${name}.sourceInputs[${i}].sha256`, 64) });
    });
    if (!sourceInputs.length || new Set(sourceInputs.map(input => input.path)).size !== sourceInputs.length || !sourceInputs.some(input => input.path === 'package.json')) invalid(`${name}.sourceInputs`, 'unique reviewed inputs including package.json required');
    if (words[0] === 'node' && (!words[1] || !sourceInputs.some(input => input.path === words[1]))) invalid(`${name}.sourceInputs`, 'native wrapper input digest required');
    for (let i = 1; i < argv.length; i += 1) {
      const option = argv[i]!, [flag, inline] = option.split('=', 2);
      if (flag === '--env-file' || flag === '--test-reporter-destination') invalid(`${name}.argv`, 'environment files and reporter output paths are unsupported');
      if (['--require', '-r', '--import', '--loader', '--experimental-loader'].includes(flag!)) {
        const input = inline ?? argv[++i];
        const canonical = input?.replace(/^\.\//u, '');
        const relative = cwd === '.' ? canonical : `${cwd}/${canonical}`;
        if (!canonical || repositoryPath(canonical) !== canonical || !sourceInputs.some(item => item.path === relative)) invalid(`${name}.argv`, 'loader input requires an exact reviewed source digest');
      }
      if (flag === '--test-reporter') {
        const reporter = inline ?? argv[++i];
        if (!['spec', 'tap'].includes(reporter ?? '')) invalid(`${name}.argv`, 'supported built-in complete diagnostic reporter required');
      }
    }
    const nativeNodeVersion = text(v.nativeNodeVersion, `${name}.nativeNodeVersion`, 32), sandboxNodeVersion = text(v.sandboxNodeVersion, `${name}.sandboxNodeVersion`, 32);
    if (![nativeNodeVersion, sandboxNodeVersion].every(version => /^(?:22|24)\.\d+\.\d+$/u.test(version))) invalid(name, 'exact supported Node runtime versions required');
    const runtimeEquivalenceReason = v.runtimeEquivalenceReason === undefined ? undefined : text(v.runtimeEquivalenceReason, `${name}.runtimeEquivalenceReason`, 512);
    if (nativeNodeVersion !== sandboxNodeVersion && !runtimeEquivalenceReason) invalid(name, 'different runtimes require explicit protected equivalence review');
    const providerTimeoutLimitKey = v.providerTimeoutLimitKey === undefined ? undefined : text(v.providerTimeoutLimitKey, `${name}.providerTimeoutLimitKey`, 64);
    if (providerTimeoutLimitKey !== undefined && !/^[a-z][a-z0-9_]*$/u.test(providerTimeoutLimitKey)) invalid(name, 'exact reviewed provider timeout-limit key required');
    const imageRef = text(v.imageRef, `${name}.imageRef`);
    if (!/^[\w./:-]+@sha256:[a-f0-9]{64}$/u.test(imageRef)) invalid(`${name}.imageRef`, 'immutable sandbox image digest required');
    const fullCommand = text(v.fullCommand, `${name}.fullCommand`);
    if (fullCommand !== nativeCommand) invalid(`${name}.fullCommand`, 'original native full command must remain unchanged');
    const env = v.env === undefined ? undefined : object(v.env, Object.keys(SUTURA_SANDBOX_ENV), `${name}.env`);
    if (env && Object.entries(env).some(([key, item]) => item !== SUTURA_SANDBOX_ENV[key as keyof typeof SUTURA_SANDBOX_ENV])) invalid(`${name}.env`, 'controller environment cannot be changed');
    const callers = list(v.callers, `${name}.callers`, 8).map((caller, i) => {
      const item = object(caller, ['workflowId', 'path', 'blobSha', 'protectedRef', 'engineSha'], `${name}.callers[${i}]`);
      const workflowPath = path(item.path, `${name}.callers[${i}].path`), protectedRef = text(item.protectedRef, `${name}.callers[${i}].protectedRef`);
      if (!/^\.github\/workflows\/[\w.-]+\.ya?ml$/u.test(workflowPath) || !/^refs\/heads\/[\w./-]+$/u.test(protectedRef) || protectedRef.includes('..')) invalid(`${name}.callers[${i}]`, 'exact workflow and protected branch required');
      return Object.freeze({ workflowId: integer(item.workflowId, name, Number.MAX_SAFE_INTEGER), path: workflowPath, protectedRef, blobSha: sha(item.blobSha, name, 40), engineSha: sha(item.engineSha, name, 40) });
    });
    const approverIds = list(v.approverIds, `${name}.approverIds`, 8).map(item => integer(item, name, Number.MAX_SAFE_INTEGER));
    if (new Set(approverIds).size !== approverIds.length || new Set(callers.map(caller => `${caller.workflowId}:${caller.path}:${caller.protectedRef}`)).size !== callers.length) invalid(name, 'duplicate caller or approver binding');
    return Object.freeze({ id, nativeCommand, cwd, argv: Object.freeze(argv), sourceInputs: Object.freeze(sourceInputs), nativeNodeVersion, sandboxNodeVersion,
      ...(runtimeEquivalenceReason === undefined ? {} : { runtimeEquivalenceReason }), ...(providerTimeoutLimitKey === undefined ? {} : { providerTimeoutLimitKey }), imageRef,
      probeTimeoutSec: integer(v.probeTimeoutSec, `${name}.probeTimeoutSec`, 600), fullCommand, fullTimeoutSec: integer(v.fullTimeoutSec, `${name}.fullTimeoutSec`, 3600),
      ...(env === undefined ? {} : { env: Object.freeze({ ...env }) as Readonly<Record<string, string>> }), callers: Object.freeze(callers), approverIds: Object.freeze(approverIds) });
  });
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length) invalid('', 'duplicate profile id');
  return Object.freeze(profiles) as unknown as ReproductionProfile[];
}
