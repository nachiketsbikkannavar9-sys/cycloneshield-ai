/**
 * Minimal Chrome DevTools Protocol driver for the release checks.
 *
 * Deliberately dependency-free: it speaks CDP over the WebSocket that Node 22
 * ships, and shells out to the system Chrome. That keeps the verification run
 * reproducible from a clean checkout without adding a browser automation
 * dependency to the workspace.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
].filter(Boolean);

async function waitFor(probe, { timeoutMs = 20_000, stepMs = 200, what = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const value = await probe();
      if (value) return value;
    } catch {
      // Keep polling: Chrome and the page are still coming up.
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}

/**
 * Launches headless Chrome and returns a small CDP session.
 *
 * `--disable-gpu` is intentional. It forces software rasterisation, so the
 * measured frame rate is a floor rather than something a real GPU would
 * flatter; if the vortex watchdog holds here it holds everywhere.
 */
export async function launchChrome({ width = 1440, height = 900, port = 9222 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "cycloneshield-cdp-"));
  const args = [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "about:blank",
  ];

  let proc;
  let lastError;
  for (const binary of CHROME_CANDIDATES) {
    try {
      proc = spawn(binary, args, { stdio: "ignore" });
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!proc) {
    throw new Error(
      `No Chrome binary found. Tried ${CHROME_CANDIDATES.join(", ")}. ` +
        "Install Chrome or set CHROME_PATH.",
    );
  }

  const target = await waitFor(
    async () => {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      return list.find((t) => t.type === "page");
    },
    { what: "Chrome DevTools target" },
  ).catch((error) => {
    proc.kill("SIGKILL");
    throw new Error(`${error.message}${lastError ? ` (${lastError.message})` : ""}`);
  });

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP socket failed")), { once: true });
  });

  let nextId = 1; // ids are 1-based so no response is ever falsy
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    // Test for the key rather than truthiness of the id: the first request uses
    // id 1, but a falsy id would silently drop a response and hang forever.
    if (message.id !== undefined && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    } else if (message.method) {
      for (const fn of listeners) fn(message);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const sendAsync = async (method, params = {}) => {
    const result = await send(method, params);
    if (result?.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    }
    return result?.result?.value;
  };

  /**
   * Evaluates a function body in the page. The body is wrapped in an async
   * function, so `return` and `await` work directly and the value is returned.
   */
  const evaluate = (body) =>
    sendAsync("Runtime.evaluate", {
      expression: `(async () => { ${body} })()`,
      awaitPromise: true,
      returnByValue: true,
    });

  const navigate = async (url) => {
    await send("Page.navigate", { url });
    await waitFor(() => evaluate("return document.readyState === 'complete' ? 1 : 0;"), {
      what: "page load",
    });
  };

  const screenshot = async (path, { clip, fullPage = false } = {}) => {
    mkdirSync(dirname(path), { recursive: true });
    const params = { format: "png" };
    if (clip) params.clip = { scale: 1, ...clip };
    if (fullPage) params.captureBeyondViewport = true;
    const { data } = await send("Page.captureScreenshot", params);
    writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  };

  /**
   * Emulates a device. Chrome ignores `--window-size` below ~500px, so a real
   * narrow-viewport check has to go through CDP rather than the CLI flag.
   */
  const setDevice = ({ width, height, deviceScaleFactor = 1, mobile = false }) =>
    send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile });

  const setTouch = (enabled) => send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: 5 });

  const setReducedMotion = (reduce) =>
    send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }],
    });

  return {
    send,
    evaluate,
    navigate,
    screenshot,
    setDevice,
    setTouch,
    setReducedMotion,
    on: (fn) => listeners.push(fn),
    close: async () => {
      try {
        ws.close();
      } catch {
        // Already closed.
      }
      proc.kill("SIGKILL");
    },
  };
}
