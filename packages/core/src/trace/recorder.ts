import { sanitizeTraceEvent } from './sanitize.js';
import {
  TRACE_SCHEMA_VERSION,
  type TraceEvent,
  type TraceEventInput,
} from './types.js';

export interface TraceRecorderDependencies {
  now?: () => number;
}

export class TraceRecorder {
  private readonly recorded: TraceEvent[] = [];
  private readonly now: () => number;
  private readonly startedAt: number;
  private latestTimestampMs = 0;

  constructor(
    private readonly runId: string,
    dependencies: TraceRecorderDependencies = {},
  ) {
    if (!runId.trim()) throw new Error('Trace runId must be non-empty');
    this.now = dependencies.now ?? Date.now;
    this.startedAt = this.now();
  }

  record(input: TraceEventInput): TraceEvent {
    const timestampMs = this.recorded.length === 0
      ? 0
      : Math.max(
          this.latestTimestampMs,
          Math.max(0, Math.floor(this.now() - this.startedAt)),
        );
    this.latestTimestampMs = timestampMs;
    const event = sanitizeTraceEvent({
      ...input,
      schemaVersion: TRACE_SCHEMA_VERSION,
      runId: this.runId,
      sequence: this.recorded.length + 1,
      timestampMs,
    } as TraceEvent);
    this.recorded.push(event);
    return structuredClone(event);
  }

  events(): TraceEvent[] {
    return structuredClone(this.recorded);
  }
}
