import type {
  Executor,
  ImageId,
  RunOptions,
  RunResult,
} from './types.js';

export type InMemoryRunResult = Omit<RunResult, 'imageId'>;

export type InMemoryScript = (
  cmd: string,
  parent: ImageId,
  callIndex: number,
  opts?: RunOptions,
) => InMemoryRunResult | Promise<InMemoryRunResult>;

export type InMemoryCall =
  | {
      kind: 'importImage';
      ref: string;
      imageId: ImageId;
    }
  | {
      kind: 'snapshot';
      dir: string;
      base: ImageId;
      imageId: ImageId;
    }
  | {
      kind: 'run';
      parent: ImageId;
      cmd: string;
      opts?: RunOptions;
      imageId: ImageId;
    };

export class InMemoryExecutor implements Executor {
  readonly calls: InMemoryCall[] = [];

  private nextImageNumber = 1;
  private nextRunNumber = 0;

  constructor(private readonly script: InMemoryScript) {}

  async importImage(ref: string): Promise<ImageId> {
    const imageId = this.nextImageId();
    this.calls.push({ kind: 'importImage', ref, imageId });
    return imageId;
  }

  async snapshot(dir: string, base: ImageId): Promise<ImageId> {
    const imageId = this.nextImageId();
    this.calls.push({ kind: 'snapshot', dir, base, imageId });
    return imageId;
  }

  async run(
    parent: ImageId,
    cmd: string,
    opts?: RunOptions,
  ): Promise<RunResult> {
    const imageId = this.nextImageId();
    const callIndex = this.nextRunNumber;
    this.nextRunNumber += 1;

    const call: InMemoryCall = opts
      ? { kind: 'run', parent, cmd, opts, imageId }
      : { kind: 'run', parent, cmd, imageId };
    this.calls.push(call);

    return {
      ...(await this.script(cmd, parent, callIndex, opts)),
      imageId,
    };
  }

  async runMany(
    parent: ImageId,
    cmds: string[],
    opts?: RunOptions,
  ): Promise<RunResult[]> {
    return Promise.all(cmds.map((cmd) => this.run(parent, cmd, opts)));
  }

  private nextImageId(): ImageId {
    const imageId = `mem-${this.nextImageNumber}`;
    this.nextImageNumber += 1;
    return imageId;
  }
}
