import { afterEach, describe, expect, it, vi } from "vitest";
import { DeadlineError, Pool, PoolFullError } from "../src/pool";

afterEach(() => vi.useRealTimers());

describe("Pool deadlines and capacity", () => {
  it("does not invoke jobs whose deadline has already passed", async () => {
    const pool = new Pool(1, 1);
    const job = vi.fn(async () => "done");
    await expect(pool.run(job, Date.now() - 1)).rejects.toBeInstanceOf(DeadlineError);
    expect(job).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ running: 0, queued: 0 });
  });

  it("releases capacity after a synchronous job exception", async () => {
    const pool = new Pool(1, 1);
    const failed = pool.run(() => { throw new Error("sync failure"); }, Date.now() + 1000);
    const next = pool.run(async () => "next", Date.now() + 1000);
    await expect(failed).rejects.toThrow("sync failure");
    await expect(next).resolves.toBe("next");
    await vi.waitFor(() => expect(pool.stats).toEqual({ running: 0, queued: 0 }));
  });

  it("removes timed-out queued jobs without starting them", async () => {
    vi.useFakeTimers();
    const pool = new Pool(1, 1);
    let finish: (value: string) => void = () => {};
    const running = pool.run(() => new Promise<string>((resolve) => { finish = resolve; }), Date.now() + 1000);
    const job = vi.fn(async () => "queued");
    const queued = pool.run(job, Date.now() + 10);
    const rejected = expect(queued).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(job).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ running: 1, queued: 0 });
    finish("done");
    await expect(running).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.stats).toEqual({ running: 0, queued: 0 });
  });

  it("aborts on deadline but holds the slot until the job settles", async () => {
    vi.useFakeTimers();
    const pool = new Pool(1, 0);
    let signal: AbortSignal | undefined;
    let finish: () => void = () => {};
    const running = pool.run((context) => {
      signal = context.signal;
      return new Promise<void>((resolve) => { finish = resolve; });
    }, Date.now() + 10);
    const rejected = expect(running).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(pool.stats.running).toBe(1);
    await expect(pool.run(async () => "next", Date.now() + 100)).rejects.toBeInstanceOf(PoolFullError);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.stats.running).toBe(0);
  });

  it("does not start expired queued jobs before overdue timers fire", async () => {
    vi.useFakeTimers();
    const pool = new Pool(1, 1);
    let finish: () => void = () => {};
    const running = pool.run(() => new Promise<void>((resolve) => { finish = resolve; }), Date.now() + 1000);
    const job = vi.fn(async () => "queued");
    const queued = pool.run(job, Date.now() + 10);
    const rejected = expect(queued).rejects.toBeInstanceOf(DeadlineError);
    await Promise.resolve();
    vi.setSystemTime(Date.now() + 20);
    finish();
    await running;
    await rejected;
    expect(job).not.toHaveBeenCalled();
    expect(pool.stats).toEqual({ running: 0, queued: 0 });
  });

  it("rejects late results even if the deadline timer has not fired", async () => {
    vi.useFakeTimers();
    const pool = new Pool(1, 0);
    const running = pool.run(async () => {
      vi.setSystemTime(Date.now() + 20);
      return "too late";
    }, Date.now() + 10);
    await expect(running).rejects.toBeInstanceOf(DeadlineError);
    await vi.advanceTimersByTimeAsync(0);
    expect(pool.stats.running).toBe(0);
  });
});
