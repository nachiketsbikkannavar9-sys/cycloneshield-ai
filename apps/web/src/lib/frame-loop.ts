/**
 * Guard for a self-scheduling animation loop.
 *
 * An error thrown inside a requestAnimationFrame callback does not propagate
 * into React, so no error boundary can see it: React believes the tree rendered
 * fine while the effect is quietly dead. Worse, the loop stops at whatever
 * half-drawn state it reached, which on this hero would be a torn funnel rather
 * than a clean still frame.
 *
 * The guard makes that failure explicit and contained: the loop stops, whatever
 * was last drawn stays on the canvas, and the fault goes to the console. The
 * hero is decoration, so a static frame is a perfectly good final state.
 */
export type GuardedFrameLoop = {
  /**
   * Schedule the next frame through the host's own scheduler.
   *
   * The step owns rescheduling: it calls this at the end of a successful run.
   * That ordering is the point. A step that throws never reaches its own
   * `next()`, so a fault stops the loop, while a loop that queued the following
   * frame *before* doing its work would keep running after a fault and just
   * rethrow every frame.
   */
  next: () => void;
  /** Stop scheduling. Safe to call more than once. */
  stop: () => void;
  /** True once the loop has stopped, whether by request or by a fault. */
  readonly stopped: boolean;
  /** Number of faults, for tests and for reporting. */
  readonly faults: number;
};

export type FrameLoopOptions = {
  /** Host scheduler, so tests do not need a real animation frame source. */
  schedule: (callback: (time: number) => void) => void;
  onFault?: (error: unknown) => void;
};

export function createGuardedFrameLoop(
  step: (time: number) => void,
  options: FrameLoopOptions,
): GuardedFrameLoop {
  let stopped = false;
  let faultCount = 0;

  const frame = (time: number): void => {
    if (stopped) return;
    try {
      step(time);
    } catch (error) {
      // Stop before reporting: a loop that keeps re-throwing on every frame
      // would flood the console and hold the frame rate hostage.
      stopped = true;
      faultCount += 1;
      options.onFault?.(error);
    }
  };

  return {
    next() {
      if (stopped) return;
      options.schedule(frame);
    },
    stop() {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
    get faults() {
      return faultCount;
    },
  };
}
