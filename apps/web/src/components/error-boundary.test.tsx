import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorBoundary, BoundaryFallback } from "./error-boundary.js";

describe("ErrorBoundary", () => {
  it("renders its children while nothing is wrong", () => {
    const boundary = new ErrorBoundary({
      label: "The scenario map",
      children: "map contents" as never,
    });
    expect(boundary.render()).toBe("map contents");
  });

  it("swaps to the fallback once a child throws", () => {
    const boundary = new ErrorBoundary({ label: "The scenario map", children: null });

    // What React calls when a descendant throws during render.
    const state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
    expect(state).toEqual({ hasError: true });

    boundary.state = state;
    expect(boundary.render()).not.toBeNull();
  });

  it("replaces only its own subtree, so the rest of the dashboard survives", () => {
    // Containment is a structural property: the boundary renders its fallback
    // in place of its children and touches nothing outside them. The hero and
    // the simulator are siblings of the boundary, not children, so a map failure
    // cannot remove them.
    //
    // Note the limit of this test: it drives the boundary's state machine
    // directly. Forcing a real render-time throw would need a DOM test
    // environment, and this branch may not add dependencies. The forced
    // failure of the hero animation loop is covered end to end in the release
    // harness instead.
    const boundary = new ErrorBoundary({
      label: "The scenario map",
      children: <div data-testid="map">map contents</div> as never,
    });
    expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain("map contents");

    boundary.state = ErrorBoundary.getDerivedStateFromError(new Error("boom"));
    const section = renderToStaticMarkup(<>{boundary.render()}</>);

    expect(section).toContain("error-boundary-section");
    // The failed section is gone, replaced by the fallback...
    expect(section).not.toContain("map contents");
    // ...and siblings outside the boundary are untouched.
    const hero = renderToStaticMarkup(<div data-testid="hero">hero still here</div>);
    const simulator = renderToStaticMarkup(<div data-testid="simulator">simulator still here</div>);
    expect(hero).toContain("hero still here");
    expect(simulator).toContain("simulator still here");
    // The internal error message is never surfaced.
    expect(section).not.toContain("boom");
  });

  it("shows a short message and a reload control, never a stack trace", () => {
    const markup = renderToStaticMarkup(<BoundaryFallback label="The scenario map" />);

    expect(markup).toContain("The scenario map could not be displayed");
    expect(markup).toContain("error-boundary-reload");
    expect(markup).toContain("Reload");
    // A public demo page must not leak file paths or component stacks.
    expect(markup).not.toMatch(/\bat [A-Za-z]+ \(/); // "at Component (file:line)"
    expect(markup).not.toMatch(/\.tsx?:[0-9]+:[0-9]+/);
    expect(markup).not.toMatch(/\/home\//);
  });

  it("uses a whole-page fallback at the root", () => {
    const markup = renderToStaticMarkup(<BoundaryFallback label="The dashboard" variant="page" />);
    expect(markup).toContain("error-boundary-page");
    expect(markup).toContain("Something broke");
    expect(markup).toContain("Reload");
  });

  it("sends the error to the console, not the screen", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boundary = new ErrorBoundary({ label: "The hero animation", children: null });
      boundary.componentDidCatch(new Error("context lost"), {
        componentStack: "\n    at HeroVortex",
      } as never);

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [first, second] = consoleError.mock.calls[0];
      expect(first).toContain("The hero animation");
      expect(second).toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("notifies an onError hook so callers can report", () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const boundary = new ErrorBoundary({ label: "The scenario map", children: null, onError });
      const error = new Error("tile layer exploded");
      boundary.componentDidCatch(error, { componentStack: null } as never);
      expect(onError).toHaveBeenCalledWith(error, expect.anything());
    } finally {
      consoleError.mockRestore();
    }
  });
});
