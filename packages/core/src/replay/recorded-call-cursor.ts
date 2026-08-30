import { canonicalJson, firstJsonDifference } from './canonical-json.js';
import { ReplayMismatchError } from './replay-error.js';

interface SequencedRecord {
  sequence: number;
}

export interface RecordedCallDescription {
  method: string;
  args: unknown[];
}

export type DescribeRecordedCall<T extends SequencedRecord> =
  (record: T) => RecordedCallDescription;

export const describeMethodCall = <T extends SequencedRecord & RecordedCallDescription>(
  record: T,
): RecordedCallDescription => record;

export class RecordedCallCursor<T extends SequencedRecord> {
  private readonly records: T[];
  private index = 0;
  private mismatch: ReplayMismatchError | undefined;

  constructor(
    records: readonly T[],
    private readonly describe: DescribeRecordedCall<T>,
    private readonly domain: string,
  ) {
    this.records = [...records].toSorted((left, right) => left.sequence - right.sequence);
  }

  next(
    method: string,
    args: unknown[],
    normalizeArgs: (args: unknown[]) => unknown[] = (value) => value,
  ): T {
    const record = this.records[this.index];
    if (!record) {
      const sequence = (this.records.at(-1)?.sequence ?? 0) + 1;
      return this.fail(new ReplayMismatchError(
        sequence,
        '$',
        `recorded ${this.domain} call`,
        'sequence exhausted',
      ));
    }
    this.index += 1;
    const expected = this.describe(record);
    if (expected.method !== method) {
      return this.fail(
        new ReplayMismatchError(record.sequence, '$.method', expected.method, method),
      );
    }
    const normalized = normalizeArgs(args);
    if (canonicalJson(expected.args) !== canonicalJson(normalized)) {
      const difference = firstJsonDifference(expected.args, normalized);
      return this.fail(new ReplayMismatchError(
        record.sequence,
        difference?.path ?? '$.args',
        difference?.expected,
        difference?.actual,
      ));
    }
    return record;
  }

  private fail(error: ReplayMismatchError): never {
    this.mismatch ??= error;
    throw error;
  }

  rethrowMismatch(): void {
    if (this.mismatch) throw this.mismatch;
  }

  assertConsumed(): void {
    this.rethrowMismatch();
    const record = this.records[this.index];
    if (!record) return;
    const remaining = this.describe(record);
    throw new ReplayMismatchError(
      record.sequence,
      '$',
      `all recorded ${this.domain} calls consumed`,
      `${remaining.method} remains`,
    );
  }
}
