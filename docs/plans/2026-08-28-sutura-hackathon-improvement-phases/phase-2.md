# Phase 2: Token Factory protocol foundation

Dependencies: None

Batch status: `[batch-eligible]` with Phase 1

## Goal

Support strict schemas, required function calls, and Token Factory capacity signals through one typed client.

## Current evidence

`ChatMessage` supports only system, user, and assistant text (`packages/core/src/llm/nebius.ts:8-11`).

`ChatOptions` supports only `json_object` responses (`packages/core/src/llm/nebius.ts:13-18`).

The parser requires string content (`packages/core/src/llm/nebius.ts:227-237`).

Retry logic ignores response headers (`packages/core/src/llm/nebius.ts:188-224`).

Live Nano probes completed strict JSON Schema and required function calls on 2026-08-28.

## Files

Modify:

- `packages/core/src/llm/nebius.ts`
- `packages/core/src/llm/types.ts`
- `packages/core/src/llm/cost.ts`
- `packages/core/src/llm/nebius.test.ts`
- `packages/core/src/llm/nebius.live.test.ts`
- `packages/core/src/index.ts`

Do not modify executor, healing, orchestration, or report files in this phase.

## Implementation

### 1. Define protocol types

Add typed message variants:

```text
SystemMessage { role, content }
UserMessage { role, content }
AssistantMessage { role, content?, toolCalls? }
ToolMessage { role, toolCallId, content }
```

Add JSON Schema, tool definition, tool choice, and parallel-call options.

Keep protocol types independent from Sutura repair tool names.

### 2. Parse tool responses

Accept `message.content=null` only when valid tool calls exist.

Validate tool call IDs, names, argument strings, and array bounds.

Return parsed tool calls beside optional text.

Preserve the raw response and token accounting.

Reject mixed invalid content before the repair agent receives it.

### 3. Add strict JSON Schema

Support this request form:

```text
response_format = {
  type: "json_schema",
  json_schema: { name, strict: true, schema }
}
```

Keep runtime validators after schema validation.

Retain the existing JSON extraction repair for unsupported models and recorded compatibility tests.

### 4. Honor capacity signals

Expose sanitized rate metadata:

```text
remainingRequests
remainingTokens
resetRequestsSec
resetTokensSec
dynamicRequestScale
dynamicTokenScale
windowUsageRequests
windowUsageTokens
retryAfterSec
requestId
```

Use `Retry-After` before local exponential jitter for HTTP 429.

Reject invalid, negative, or excessive delay values.

Keep one total retry deadline.

Return one immutable capacity snapshot with each response.

Never treat an earlier snapshot as authority for a later request.

Keep Token Factory request limits separate from ConTree operation limits.

### 5. Preserve cost semantics

Count reasoning tokens as billed output.

Count tool-call completion tokens even when text content is absent.

Do not change published prices without a verified catalog probe.

## Automated success criteria

- A strict schema request matches the documented Token Factory body.
- A required tool request matches the documented body.
- Null content with valid tool calls parses successfully.
- Null content without valid tool calls fails closed.
- Malformed names, IDs, and argument strings fail closed.
- `Retry-After` takes precedence for HTTP 429.
- Invalid rate headers never create an unbounded wait.
- Every response exposes one immutable capacity snapshot.
- Stale capacity cannot authorize another branch.
- Token accounting remains correct for text and tool responses.
- Existing text-only callers remain compatible.
- The complete local gate passes.

## Manual success criteria

- Run one live Nano strict schema call.
- Run one live Nano required tool call.
- Record model ID, status, finish reason, token usage, and sanitized response shape.
- Do not record hidden reasoning or credentials.

## Exit evidence

Add the live probe result under `docs/demo/` with the exact implementation commit.

The public client API exports every new type through `packages/core/src/index.ts`.
