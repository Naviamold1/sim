export class PoolFullError extends Error {
  constructor() {
    super("queue full");
  }
}

export class DeadlineError extends Error {
  constructor() {
    super("deadline exceeded");
  }
}

export type JobContext = { signal: AbortSignal; queueWaitMs: number };

type Waiter = { start: () => void };

/**
 * Runs at most `concurrency` jobs at once; extra jobs wait in a bounded FIFO queue.
 * Each job has an absolute deadline. If it passes while queued the job is dropped,
 * if it passes while running the job's signal is aborted. Either way the caller gets
 * a DeadlineError right away; the slot is only freed once the job has really settled.
 */
export class Pool {
  private running = 0;
  private readonly queue: Waiter[] = [];

  constructor(
    private readonly concurrency: number,
    private readonly maxQueue: number,
  ) {}

  get stats() {
    return { running: this.running, queued: this.queue.length };
  }

  run<T>(job: (ctx: JobContext) => Promise<T>, deadlineAt: number): Promise<T> {
    if (deadlineAt <= Date.now()) return Promise.reject(new DeadlineError());
    const idle = this.running < this.concurrency;
    if (!idle && this.queue.length >= this.maxQueue) return Promise.reject(new PoolFullError());

    return new Promise<T>((resolve, reject) => {
      const abort = new AbortController();
      const enqueuedAt = Date.now();
      let started = false;

      const timer = setTimeout(
        () => {
          reject(new DeadlineError());
          if (started) abort.abort();
          else this.remove(waiter);
        },
        Math.max(0, deadlineAt - Date.now()),
      );

      const waiter: Waiter = {
        start: () => {
          if (deadlineAt <= Date.now()) {
            clearTimeout(timer);
            reject(new DeadlineError());
            this.queue.shift()?.start();
            return;
          }
          started = true;
          this.running++;
          Promise.resolve()
            .then(() => {
              abort.signal.throwIfAborted();
              if (deadlineAt <= Date.now()) throw new DeadlineError();
              return job({ signal: abort.signal, queueWaitMs: Date.now() - enqueuedAt });
            })
            .then((output) => {
              if (deadlineAt <= Date.now()) {
                abort.abort();
                reject(new DeadlineError());
              } else resolve(output);
            }, (error: unknown) => reject(deadlineAt <= Date.now() ? new DeadlineError() : error))
            .finally(() => {
              clearTimeout(timer);
              this.running--;
              this.queue.shift()?.start();
            });
        },
      };

      if (idle) waiter.start();
      else this.queue.push(waiter);
    });
  }

  private remove(waiter: Waiter) {
    const i = this.queue.indexOf(waiter);
    if (i >= 0) this.queue.splice(i, 1);
  }
}
