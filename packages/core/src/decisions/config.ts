export const SEMANTIC_ROLES = ['ranking', 'grounding', 'classification', 'recovery'] as const;
export type SemanticRole = typeof SEMANTIC_ROLES[number];
export type DecisionRole = SemanticRole | 'navigator' | 'audit-v2';
export type DecisionMode = 'off' | 'shadow' | 'assist';
export const SEMANTIC_MODEL = 'jev-1.14.0' as const;
export const SEMANTIC_POLICY = 'semantic-v1' as const;
export interface SemanticConfig {
  schemaVersion: 'sutura-semantic-config-v1';
  model: typeof SEMANTIC_MODEL;
  policyVersion: typeof SEMANTIC_POLICY;
  modes: Record<SemanticRole, DecisionMode>;
  maxUsd: number;
}
export function semanticConfig(value?: unknown, keyAvailable = false): SemanticConfig {
  const fail = (field: string): never => { throw new Error(`semantic.${field} is invalid; select off or supply an explicit cap (0..0.02), supported policy/model and TYPESAFE_API_KEY`); };
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) fail('config');
  const input = (value ?? {}) as Record<string, unknown>;
  if (Object.keys(input).some(k => !['schemaVersion','model','policyVersion','modes','maxUsd'].includes(k))) fail('fields');
  if (input.schemaVersion !== undefined && input.schemaVersion !== 'sutura-semantic-config-v1') fail('schemaVersion');
  if (input.model !== undefined && input.model !== SEMANTIC_MODEL) fail('model');
  if (input.policyVersion !== undefined && input.policyVersion !== SEMANTIC_POLICY) fail('policyVersion');
  const modes: Record<SemanticRole, DecisionMode> = {ranking:'off',grounding:'off',classification:'off',recovery:'off'};
  if (input.modes !== undefined) {
    if (!input.modes || typeof input.modes !== 'object' || Array.isArray(input.modes)) fail('modes');
    for (const [role, mode] of Object.entries(input.modes as object)) {
      if (!SEMANTIC_ROLES.includes(role as SemanticRole) || !['off','shadow','assist'].includes(mode as string)) fail(`modes.${role}`);
      modes[role as SemanticRole] = mode as DecisionMode;
    }
  }
  const maxUsd = input.maxUsd ?? 0;
  if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd < 0 || maxUsd > .02) fail('maxUsd');
  if (Object.values(modes).some(mode=>mode!=='off') && (!(maxUsd as number > 0) || !keyAvailable)) fail('authorization');
  return {schemaVersion:'sutura-semantic-config-v1', model:SEMANTIC_MODEL,policyVersion:SEMANTIC_POLICY,modes,maxUsd:maxUsd as number};
}
