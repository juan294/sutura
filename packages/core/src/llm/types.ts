import type { ModelTier } from './cost.js';
import type { ChatMessage, ChatOptions } from './nebius.js';

export interface TierLlm<Tier extends ModelTier> {
  chat(
    tier: Tier,
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<{ text: string }>;
}
