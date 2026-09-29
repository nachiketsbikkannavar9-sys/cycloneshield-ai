/**
 * Tile failure tracking for the scenario map.
 *
 * The map is three layers of information stacked: a photographic base from
 * OpenStreetMap, and the scenario's own vector overlays (track, impact zones,
 * asset markers) drawn on top. Those overlays are the product. A base tile that
 * fails to load is a degraded background, not a broken map, so the failure is
 * reported as a small notice and the map is left interactive.
 *
 * This is deliberately a plain stateful object with an injectable clock rather
 * than a hook: Leaflet fires these events from inside its own event handlers,
 * and the counting rules are the part worth testing directly.
 */

/** Errors tolerated before the notice appears, as a burst rather than a total. */
export const TILE_ERROR_THRESHOLD = 8;

/** How far back errors count, and how recent a success suppresses the notice. */
export const TILE_ERROR_WINDOW_MS = 10_000;

export type TileHealthMonitorOptions = {
  threshold?: number;
  windowMs?: number;
  now?: () => number;
};

export type TileHealthMonitor = {
  /** Record a failed tile load. Returns whether the notice should be showing. */
  recordError: () => boolean;
  /** Record a successful tile load. Returns whether the notice should be showing. */
  recordSuccess: () => boolean;
  /** Hide the notice without forgetting the failure history. */
  dismiss: () => boolean;
  /** Current visibility, without recording an event. */
  isVisible: () => boolean;
  /** Errors still inside the window. Exposed for assertions. */
  errorCountInWindow: () => number;
};

export function createTileHealthMonitor(
  options: TileHealthMonitorOptions = {},
): TileHealthMonitor {
  const threshold = options.threshold ?? TILE_ERROR_THRESHOLD;
  const windowMs = options.windowMs ?? TILE_ERROR_WINDOW_MS;
  const now = options.now ?? (() => Date.now());

  /** Timestamps of errors still inside the window, oldest first. */
  let errors: number[] = [];
  let lastSuccessAt: number | null = null;
  let dismissed = false;

  /** Drop anything that has aged out, so the count is always windowed. */
  const prune = (at: number): void => {
    const cutoff = at - windowMs;
    errors = errors.filter((stamp) => stamp > cutoff);
  };

  /** A success anywhere in the window means the base map is still arriving. */
  const successInWindow = (at: number): boolean =>
    lastSuccessAt !== null && at - lastSuccessAt <= windowMs;

  const degraded = (at: number): boolean => {
    prune(at);
    return errors.length >= threshold && !successInWindow(at);
  };

  return {
    recordError() {
      const at = now();
      errors.push(at);
      // A new burst deserves to be shown again even if the previous one was
      // dismissed, so a dismissal only hides the notice until tiles recover.
      const show = degraded(at);
      return show && !dismissed;
    },
    recordSuccess() {
      const at = now();
      lastSuccessAt = at;
      errors = [];
      dismissed = false;
      return false;
    },
    dismiss() {
      dismissed = true;
      return false;
    },
    isVisible() {
      const at = now();
      return degraded(at) && !dismissed;
    },
    errorCountInWindow() {
      prune(now());
      return errors.length;
    },
  };
}
