import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ErrorBoundary } from "./components/error-boundary.js";
import "./styles/index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    {/*
      Outermost net. App also guards the map and hero sections individually, so
      this only ever fires for a failure above or outside those boundaries, in
      which case a short message beats a blank page.
    */}
    <ErrorBoundary label="The dashboard" variant="page">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
