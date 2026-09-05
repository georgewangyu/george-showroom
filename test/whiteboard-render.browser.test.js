import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";

import * as esbuild from "esbuild";
import { parse } from "parse5";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const delay = promisify(setTimeout);
const execFileAsync = promisify(execFile);

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function ownedChromePids(profile) {
  if (process.platform === "win32") return [];
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,command="], {
    maxBuffer: 4 * 1024 * 1024,
  });
  const marker = `--user-data-dir=${profile}`;
  return stdout
    .split("\n")
    .filter((line) => line.includes(marker))
    .map((line) => Number.parseInt(line.trimStart(), 10))
    .filter((pid) => Number.isSafeInteger(pid) && pid > 0);
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function remainingChromePids(pid, profile) {
  const remaining = new Set(await ownedChromePids(profile));
  if (pid && processIsAlive(pid)) remaining.add(pid);
  return [...remaining];
}

async function terminateChromeTree(pid, profile) {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/pid", String(pid), "/t", "/f"]);
    } catch (error) {
      if (!`${error?.stdout ?? ""}${error?.stderr ?? ""}`.includes("not found")) throw error;
    }
    return;
  }
  for (const ownedPid of await remainingChromePids(pid, profile)) signalProcess(ownedPid, "SIGTERM");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(25);
    if ((await remainingChromePids(pid, profile)).length === 0) return;
  }
  for (const ownedPid of await remainingChromePids(pid, profile)) signalProcess(ownedPid, "SIGKILL");
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await delay(25);
    if ((await remainingChromePids(pid, profile)).length === 0) return;
  }
  throw new Error(`Chrome processes for ${profile} did not terminate`);
}

async function runOwnedChrome(chrome, args) {
  const profilePrefix = "--user-data-dir=";
  const profile = args.find((arg) => arg.startsWith(profilePrefix))?.slice(profilePrefix.length);
  if (!profile) throw new Error("Chrome test requires an owned user-data-dir");
  const child = spawn(chrome, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  /** @type {Buffer[]} */
  const stdoutChunks = [];
  /** @type {Buffer[]} */
  const stderrChunks = [];
  let outputBytes = 0;
  const maxBuffer = 8 * 1024 * 1024;
  let settled = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timeout;
  try {
    await new Promise((resolve, reject) => {
      /** @param {Error} error */
      const fail = (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };
      /**
       * @param {Buffer[]} chunks
       * @param {boolean} [isStdout]
       */
      const collect =
        (chunks, isStdout = false) =>
        (/** @type {Buffer} */ chunk) => {
          outputBytes += chunk.length;
          if (outputBytes > maxBuffer) {
            fail(new Error("Chrome output exceeded the 8 MiB test limit"));
            return;
          }
          chunks.push(chunk);
          if (isStdout && !settled) {
            const html = Buffer.concat(stdoutChunks).toString("utf8");
            if (html.includes("data-result") && resultFromDump(html)) {
              settled = true;
              resolve(undefined);
            }
          }
        };
      child.stdout.on("data", collect(stdoutChunks, true));
      child.stderr.on("data", collect(stderrChunks));
      child.once("error", fail);
      child.once("exit", (code, signal) => {
        if (settled) return;
        settled = true;
        if (code === 0) resolve(undefined);
        else reject(new Error(`Chrome exited with code ${code} and signal ${signal}`));
      });
      timeout = setTimeout(() => fail(new Error("Chrome test timed out after 75 seconds")), 75_000);
    });
    return {
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    };
  } finally {
    if (timeout) clearTimeout(timeout);
    if (child.pid) await terminateChromeTree(child.pid, profile);
  }
}

async function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return "";
}

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function resultFromDump(html) {
  const document = parse(html);
  const stack = /** @type {import("parse5").DefaultTreeAdapterMap["node"][]} */ ([document]);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeName === "body") {
      const element = /** @type {import("parse5").DefaultTreeAdapterMap["element"]} */ (node);
      const attribute = element.attrs.find((item) => item.name === "data-result");
      if (attribute) return JSON.parse(attribute.value);
    }
    if ("childNodes" in node) stack.push(...node.childNodes);
  }
  return null;
}

test("real Excalidraw rendering keeps loaded-font labels inside their text bounds", { timeout: 90_000 }, async (t) => {
  const chrome = await chromePath();
  if (!chrome) {
    t.skip("Chrome or Chromium is required for the real-render regression");
    return;
  }
  const root = await mkdtemp(path.join(os.tmpdir(), "lavish-excalidraw-render-"));
  try {
    await esbuild.build({
      entryPoints: [path.join(projectRoot, "test/fixtures/excalidraw-label-clipping.browser.jsx")],
      outdir: root,
      entryNames: "fixture",
      assetNames: "assets/[name]-[hash]",
      bundle: true,
      format: "iife",
      platform: "browser",
      conditions: ["production"],
      loader: { ".woff2": "file", ".woff": "file", ".ttf": "file" },
      define: {
        "process.env.NODE_ENV": '"production"',
        "process.env.IS_PREACT": '"false"',
      },
    });
    await cp(
      path.join(projectRoot, "node_modules/@excalidraw/excalidraw/dist/prod/fonts"),
      path.join(root, "whiteboard-assets/fonts"),
      { recursive: true },
    );
    await writeFile(
      path.join(root, "index.html"),
      '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"></head><body><script src="/fixture.js"></script></body></html>',
    );
    const server = http.createServer(async (request, response) => {
      try {
        const pathname = new URL(request.url, "http://127.0.0.1").pathname;
        const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
        const file = path.resolve(root, relative);
        if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error("outside fixture root");
        const body = await readFile(file);
        response.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not bind to a TCP port");
      const port = address.port;
      const profile = path.join(root, "chrome-profile");
      const { stdout } = await runOwnedChrome(chrome, [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        `--user-data-dir=${profile}`,
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=20000",
        "--dump-dom",
        `http://127.0.0.1:${port}/`,
      ]);
      const result = resultFromDump(stdout);
      assert.ok(result, "browser fixture did not report a result");
      assert.equal(result.pass, true, result.error);
      assert.equal(result.fontReady, true);
      assert.equal(result.edgeLabels, 4);
      assert.ok(result.multilineLines >= 2);
      assert.ok(result.repaired >= 5);
      assert.ok(result.opaquePixels >= 1000);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
