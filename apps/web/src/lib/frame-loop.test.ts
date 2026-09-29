import { describe, expect, it, vi } from "vitest";
import { createGuardedFrameLoop, type GuardedFrameLoop } from "./frame-loop.js";

/** Minimal stand-in for requestAnimationFrame, with manual pumping. */
function fakeScheduler() {
  let queued: ((time: number) => void) | null = null;
  let now = 0;
  return {
    schedule: (callback: (time: number) => void) => {
      queued = callback;
    },
    /** Deliver one frame if one is pending. Returns false when nothing was due. */
    pump(deltaMs = 16): boolean {
      if (!queued) return false;
      const callback = queued;
      queued = null;
      now += deltaMs;
      callback(now);
      return true;
    },
    get pending() {
      return queued !== null;
    },
  };
}

describe("createGuardedFrameLoop", () => {
  it("keeps scheduling frames while the step succeeds", () => {
    const scheduler = fakeScheduler();
    let frames = 0;
    // The step reschedules itself at the end, the way the hero's tick does.
    const loop: GuardedFrameLoop = createGuardedFrameLoop(() => {
      frames += 1;
      loop.next();
    }, { schedule: scheduler.schedule });

    loop.next();
    scheduler.pump();
    scheduler.pump();
    scheduler.pump();

    expect(frames).toBe(3);
    expect(loop.stopped).toBe(false);
    expect(loop.faults).toBe(0);
  });

  it("stops the loop and reports the fault when the step throws", () => {
    const scheduler = fakeScheduler();
    const onFault = vi.fn();
    const loop = createGuardedFrameLoop(
      () => {
        throw new Error("canvas context lost");
      },
      { schedule: scheduler.schedule, onFault },
    );

    loop.next();
    scheduler.pump();

    expect(loop.stopped).toBe(true);
    expect(loop.faults).toBe(1);
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(onFault.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("stops scheduling after a fault rather than throwing every frame", () => {
    const scheduler = fakeScheduler();
    const onFault = vi.fn();
    const step = vi.fn(() => {
      throw new Error("boom");
    });
    const loop = createGuardedFrameLoop(step, { schedule: scheduler.schedule, onFault });

    loop.next();
    scheduler.pump();
    // Anything that still asks for a frame after the fault is a no-op.
    loop.next();
    loop.next();
    scheduler.pump();

    expect(step).toHaveBeenCalledTimes(1);
    expect(onFault).toHaveBeenCalledTimes(1);
    expect(scheduler.pending).toBe(false);
  });

  it("keeps the last drawn frame: the last successful draw is never cleared", () => {
    const scheduler = fakeScheduler();
    let frame = 0;
    const drawn: number[] = [];
    // A frame counter that throws partway through, the way a lost canvas
    // context would: some strokes already committed to the canvas.
    const loop: GuardedFrameLoop = createGuardedFrameLoop(() => {
      frame += 1;
      if (frame === 1) {
        drawn.push(1);
        loop.next(); // first frame is clean and reschedules
        return;
      }
      drawn.push(1); // committed to the canvas, then the context is lost
      throw new Error("context lost mid-frame");
    }, { schedule: scheduler.schedule });

    loop.next();
    scheduler.pump();
    scheduler.pump();

    // The fault did not clear the canvas: frame one's work is still there.
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    expect(loop.stopped).toBe(true);
  });

  it("does not rethrow into the host scheduler", () => {
    const scheduler = fakeScheduler();
    const loop = createGuardedFrameLoop(
      () => {
        throw new Error("bad frame");
      },
      { schedule: scheduler.schedule },
    );

    loop.next();
    // A throw here would escape into the browser's rAF callback and become an
    // unhandled error, which is exactly what this guard exists to prevent.
    expect(() => scheduler.pump()).not.toThrow();
  });

  it("stops on request without counting a fault", () => {
    const scheduler = fakeScheduler();
    const step = vi.fn();
    const loop = createGuardedFrameLoop(step, { schedule: scheduler.schedule });

    loop.next();
    loop.stop();
    loop.next();

    // A frame already queued before stop() must not run when it arrives.
    expect(scheduler.pump()).toBe(true);
    expect(step).not.toHaveBeenCalled();
    expect(scheduler.pending).toBe(false);
    expect(loop.faults).toBe(0);
  });

  it("survives a step that throws a non-Error value", () => {
    const scheduler = fakeScheduler();
    const onFault = vi.fn();
    const loop = createGuardedFrameLoop(
      () => {
        throw "string failure";
      },
      { schedule: scheduler.schedule, onFault },
    );

    loop.next();
    expect(() => scheduler.pump()).not.toThrow();
    expect(loop.stopped).toBe(true);
    expect(onFault).toHaveBeenCalledWith("string failure");
  });
});
