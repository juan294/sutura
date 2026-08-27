export type JsonReply = string | { text: string };
export type JsonRepair = (prompt: string) => JsonReply | Promise<JsonReply>;

export class JsonExtractionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'JsonExtractionError';
  }
}

function replyText(reply: JsonReply): string {
  return typeof reply === 'string' ? reply : reply.text;
}

interface JsonObjectCandidate {
  text: string;
  start: number;
  end: number;
}

function jsonObjectCandidates(text: string): JsonObjectCandidate[] {
  const candidates: JsonObjectCandidate[] = [];
  const starts: number[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (starts.length === 0) {
      if (character === '{') starts.push(index);
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') starts.push(index);
    else if (character === '}' && starts.length > 0) {
      const start = starts.pop() as number;
      candidates.push({ text: text.slice(start, index + 1), start, end: index + 1 });
    }
  }
  return candidates.sort((left, right) => left.start - right.start);
}

function parseAndValidate<T>(reply: JsonReply, validate: (value: unknown) => T): T {
  const candidates = jsonObjectCandidates(replyText(reply));
  let lastError: unknown;
  let blockedUntil = -1;

  for (const candidate of candidates) {
    if (candidate.start < blockedUntil) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate.text) as unknown;
    } catch (error) {
      lastError = error;
      continue;
    }
    try {
      return validate(parsed);
    } catch (error) {
      lastError = error;
      blockedUntil = candidate.end;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Reply does not contain a JSON object');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function repairPrompt(error: unknown): string {
  return [
    'Return only one valid JSON object that satisfies the requested schema.',
    `Validation error: ${errorMessage(error)}`,
  ].join('\n');
}

export function extractJson<T>(reply: JsonReply, validate: (value: unknown) => T): T;
export function extractJson<T>(
  reply: JsonReply,
  validate: (value: unknown) => T,
  repair: JsonRepair,
): Promise<T>;
export function extractJson<T>(
  reply: JsonReply,
  validate: (value: unknown) => T,
  repair?: JsonRepair,
): T | Promise<T> {
  try {
    return parseAndValidate(reply, validate);
  } catch (initialError) {
    if (!repair) {
      throw new JsonExtractionError(
        `Could not extract valid JSON: ${errorMessage(initialError)}`,
        { cause: initialError },
      );
    }

    return Promise.resolve()
      .then(() => repair(repairPrompt(initialError)))
      .then(
        (repairedReply) => {
          try {
            return parseAndValidate(repairedReply, validate);
          } catch (repairError) {
            throw new JsonExtractionError(
              `JSON repair failed: ${errorMessage(repairError)}`,
              { cause: repairError },
            );
          }
        },
        (repairError: unknown) => {
          throw new JsonExtractionError(
            `JSON repair request failed: ${errorMessage(repairError)}`,
            { cause: repairError },
          );
        },
      );
  }
}
