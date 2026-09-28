/**
 * Static server for the built web app, with the API proxied under /api.
 *
 * The release checks need to run against a production build rather than the dev
 * server, and a production build has no dev-time proxy, so this supplies one.
 * Paths are resolved relative to the repository so the script works from any
 * checkout location.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

function readBody(request) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolvePromise(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export function startPreviewServer({
  root = join(REPO_ROOT, "apps/web/dist"),
  apiOrigin = "http://127.0.0.1:8787",
  port = 4173,
  host = "127.0.0.1",
} = {}) {
  if (!existsSync(join(root, "index.html"))) {
    throw new Error(`No production build at ${root}. Run "npm run build" first.`);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const upstream = `${apiOrigin}${url.pathname}${url.search}`;
      // Content-Type must be forwarded or express cannot parse a JSON body.
      // Content-Length must NOT be: fetch re-frames the body itself, and
      // passing the original length through truncates the simulation payload.
      const headers = { accept: request.headers.accept ?? "application/json" };
      if (request.headers["content-type"]) {
        headers["content-type"] = request.headers["content-type"];
      }

      // Drain the request first: without the body the upstream sees an empty
      // payload and rejects the simulation with NaN field errors.
      const body = await readBody(request);

      fetch(upstream, { method: request.method, headers, body: body.length ? body : undefined })
        .then(async (res) => {
          const payload = Buffer.from(await res.arrayBuffer());
          response.writeHead(res.status, {
            "content-type": res.headers.get("content-type") ?? "application/json",
            "cache-control": "no-store",
          });
          response.end(payload);
        })
        .catch((error) => {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "api-unreachable", detail: error.message }));
        });
      return;
    }

    // normalize() collapses any ../ segments before we join, so a crafted path
    // cannot escape the build directory.
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    let filePath = join(root, requested);
    if (!filePath.startsWith(root)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(root, "index.html"); // SPA fallback
    }
    if (!existsSync(filePath)) {
      response.writeHead(404).end("Not found");
      return;
    }

    response.writeHead(200, {
      "content-type": MIME[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(response);
  });

  return new Promise((resolvePromise, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolvePromise({
        url: `http://${host}:${address.port}`,
        port: address.port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}
