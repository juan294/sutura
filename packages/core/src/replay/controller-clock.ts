import { ReplayMismatchError } from './replay-error.js';
export type ControllerClockDomain = 'preparation' | 'repair' | 'verification';
export interface ControllerClockSample { domain: ControllerClockDomain; elapsedMs: number }
/** Clock inputs are recorded evidence, usable only by the offline controller. */
export class ReplayControllerClock {
  readonly startedAt = Date.now();
  private index = 0;
  constructor(private readonly samples: readonly ControllerClockSample[]) {}
  now(domain: ControllerClockDomain): number {
    const sample = this.samples[this.index];
    if (!sample || sample.domain !== domain) throw new ReplayMismatchError(this.index + 1, '$.configuration.controllerClock', sample ?? 'end of clock recording', { domain });
    this.index++;
    return this.startedAt + sample.elapsedMs;
  }
  assertConsumed(): void {
    if (this.index !== this.samples.length) throw new ReplayMismatchError(this.index + 1, '$.configuration.controllerClock', this.samples[this.index], 'unconsumed recorded clock input');
  }
}
