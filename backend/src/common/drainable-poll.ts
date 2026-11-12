export class DrainablePoll {
  private inFlight?: Promise<void>;
  private stopped = false;

  get running() { return this.inFlight !== undefined; }
  get stopping() { return this.stopped; }

  run(task: () => Promise<void>): Promise<void> {
    if (this.stopping || this.running) return Promise.resolve();
    this.inFlight = Promise.resolve().then(() => {
      if (!this.stopping) return task();
    }).finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  stop() { this.stopped = true; }

  async drain(): Promise<void> {
    await this.inFlight;
  }
}
