import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Error containment for a live demo.
 *
 * The dashboard is a single page of independent sections: a decorative hero
 * effect, a Leaflet map, a simulator. None of them should be able to take the
 * rest of the page down, because the failure a judge sees is "blank white
 * screen" and that reads as a broken submission rather than as one bad section.
 *
 * Boundaries deliberately do not cover everything React cannot catch. An error
 * thrown from a requestAnimationFrame callback or an event handler does not
 * propagate through the React tree, so the hero effect guards its own loop; see
 * `createGuardedFrameLoop` in lib/frame-loop.ts.
 *
 * The fallback never shows a stack trace. This is a public demo page, and an
 * error message with file paths and component stacks in it is noise to a
 * reviewer, not information. The error is logged to the console instead, where
 * a developer can still find it.
 */

export type ErrorBoundaryProps = {
  children: ReactNode;
  /** Short, human explanation of this section, e.g. "the scenario map". */
  label: string;
  /**
   * Rendered instead of the default card. The root boundary replaces the whole
   * page and so needs its own full-page treatment; a section boundary sits
   * inside an existing card.
   */
  variant?: "section" | "page";
  onError?: (error: Error, info: ErrorInfo) => void;
};

type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    // The error is deliberately not stored: it must not reach the render path.
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console, not the DOM: keeps the diagnosis available without putting a
    // stack trace on screen.
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
    this.props.onError?.(error, info);
  }

  public render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return <BoundaryFallback label={this.props.label} variant={this.props.variant} />;
  }
}

export function BoundaryFallback({
  label,
  variant = "section",
}: {
  label: string;
  variant?: "section" | "page";
}): ReactNode {
  const isPage = variant === "page";
  return (
    <div
      role="alert"
      data-testid={isPage ? "error-boundary-page" : "error-boundary-section"}
      className={
        isPage
          ? "grid min-h-screen place-items-center bg-surface-app px-6 text-center text-slate-100"
          : "rounded-2xl border border-white/10 bg-slate-950/60 px-6 py-10 text-center"
      }
    >
      <div className="max-w-sm">
        <AlertTriangle className="mx-auto text-amber-300" size={isPage ? 28 : 22} aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-slate-100">{isPage ? "Something broke" : `${label} could not be displayed`}</p>
        <p className="mt-1 text-sm text-slate-400">
          {isPage
            ? "The dashboard failed to load. Reloading usually clears it."
            : "The rest of the dashboard is unaffected and still usable."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          data-testid="error-boundary-reload"
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
        >
          <RefreshCw size={14} aria-hidden="true" />
          Reload
        </button>
      </div>
    </div>
  );
}
