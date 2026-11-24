import { ApiError } from './apiError.js';

/**
 * Bounded concurrency with a short FIFO wait. A caller beyond the limit waits for a
 * free slot instead of failing at once, so a burst (details page, player and the
 * next-episode preparation together) is served in order. It fails only after `waitMs`.
 */
export class RequestSlots {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly limit: number, private readonly waitMs: number, private readonly busy: () => ApiError) {}

  get inFlight(): number { return this.active; }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try { return await task(); } finally { this.release(); }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) { this.active++; return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const grant = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => {
        const index = this.queue.indexOf(grant);
        if (index >= 0) this.queue.splice(index, 1);
        reject(this.busy());
      }, this.waitMs);
      timer.unref?.();
      this.queue.push(grant);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    // A waiting caller inherits the slot directly; the in-flight count never exceeds the limit.
    if (next) next();
    else this.active--;
  }
}
