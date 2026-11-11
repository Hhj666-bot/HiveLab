/** Coalesces wakeups while a controller scans its queue, without overlapping scans. */
export class SingleFlightPump {
  private requested = false;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private step: () => Promise<void>,
    private available: () => boolean,
  ) {}

  get busy() {
    return this.running !== undefined;
  }

  request(): void {
    if (this.stopped || !this.available()) return;
    this.requested = true;
    if (this.running) return;
    this.running = Promise.resolve()
      .then(async () => {
        while (this.requested && !this.stopped && this.available()) {
          this.requested = false;
          // Each domain records task failures. A failed scan alone is not a retry request.
          try {
            await this.step();
          } catch {}
        }
      })
      .finally(() => {
        this.running = undefined;
        // A wakeup can arrive after the loop settles but before this finalizer runs.
        if (this.requested) this.request();
      });
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.requested = false;
    await this.running;
  }
}
