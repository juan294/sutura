export class ReplayMismatchError extends Error {
  constructor(
    readonly sequence: number,
    readonly path: string,
    readonly expected: unknown,
    readonly actual: unknown,
  ) {
    super(
      `Replay exchange ${sequence} differs at ${path}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
    this.name = 'ReplayMismatchError';
  }
}
