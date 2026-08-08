import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { isVersionOnlyArgv, VERSION } from "../src/cli.js";

const execFileAsync = promisify(execFile);
const BINS = [
  fileURLToPath(new URL("../bin/george-showroom.js", import.meta.url)),
  fileURLToPath(new URL("../bin/lavish-axi.js", import.meta.url)),
];

// The exact no-telemetry/no-state assertions and lazy-import structure below are the
// deterministic regression guards. This is a looser cold-process ceiling so parallel
// CI load does not turn the performance smoke check into a flaky wall-clock test.
const VERSION_BUDGET_MS = 1_000;

// Accepts the telemetry connection and never answers, so a regression pays the whole
// drain timeout instead of a fast connection refusal.
async function startBlackHoleTelemetry() {
  const sockets = new Set();
  const requests = [];
  const server = createServer((req) => {
    requests.push(req.url);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(undefined));
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    requests,
    host: `http://127.0.0.1:${port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

test("isVersionOnlyArgv matches exactly the SDK's version-flag shapes", () => {
  for (const flag of ["--version", "-v", "-V"]) {
    assert.equal(isVersionOnlyArgv([flag]), true);
  }
  for (const argv of [[], ["--help"], ["open"], ["--version", "extra"], ["open", "--version"]]) {
    assert.equal(isVersionOnlyArgv(argv), false);
  }
});

test("both CLI bins reach the version fast path before loading the full CLI", async () => {
  const [runner, primary, compatibility] = await Promise.all([
    readFile(new URL("../bin/run-cli.js", import.meta.url), "utf8"),
    readFile(new URL("../bin/george-showroom.js", import.meta.url), "utf8"),
    readFile(new URL("../bin/lavish-axi.js", import.meta.url), "utf8"),
  ]);

  assert.ok(runner.indexOf("VERSION_FLAGS.has") < runner.indexOf('await import("../src/cli.js")'));
  assert.match(primary, /from "\.\/run-cli\.js"/);
  assert.match(compatibility, /from "\.\/run-cli\.js"/);
  assert.doesNotMatch(primary, /src\/cli\.js/);
  assert.doesNotMatch(compatibility, /src\/cli\.js/);
});

test("--version prints the version fast and skips telemetry and state-dir init", async (t) => {
  const telemetry = await startBlackHoleTelemetry();
  const stateParent = await mkdtemp(path.join(tmpdir(), "lavish-version-"));
  const stateDir = path.join(stateParent, "state");
  t.after(async () => {
    await telemetry.close();
    await rm(stateParent, { recursive: true, force: true });
  });

  const env = {
    ...process.env,
    LAVISH_AXI_STATE_DIR: stateDir,
    LAVISH_AXI_TELEMETRY: "1",
    LAVISH_AXI_UMAMI_WEBSITE_ID: "version-fast-path-test",
    LAVISH_AXI_UMAMI_HOST: telemetry.host,
  };

  for (const bin of BINS) {
    for (const flag of ["--version", "-v", "-V"]) {
      const startedAt = process.hrtime.bigint();
      const { stdout } = await execFileAsync(process.execPath, [bin, flag], { env });
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      assert.equal(stdout, `${VERSION}\n`);
      assert.ok(
        elapsedMs < VERSION_BUDGET_MS,
        `\`${path.basename(bin)} ${flag}\` took ${Math.round(elapsedMs)}ms, over the ${VERSION_BUDGET_MS}ms budget`,
      );
    }
  }

  // The heavy init is provably skipped: no telemetry request was ever sent, and the
  // state directory was never created.
  assert.deepEqual(telemetry.requests, []);
  assert.equal(existsSync(stateDir), false);
});

test("a non-version invocation still runs the telemetry init the fast path skips", async (t) => {
  const telemetry = await startBlackHoleTelemetry();
  const stateParent = await mkdtemp(path.join(tmpdir(), "lavish-version-control-"));
  const stateDir = path.join(stateParent, "state");
  t.after(async () => {
    await telemetry.close();
    await rm(stateParent, { recursive: true, force: true });
  });

  await execFileAsync(process.execPath, [BINS[0], "design"], {
    env: {
      ...process.env,
      LAVISH_AXI_STATE_DIR: stateDir,
      LAVISH_AXI_TELEMETRY: "1",
      LAVISH_AXI_UMAMI_WEBSITE_ID: "version-fast-path-test",
      LAVISH_AXI_UMAMI_HOST: telemetry.host,
    },
  });

  assert.ok(telemetry.requests.length > 0, "expected the control command to send telemetry");
  assert.equal(existsSync(stateDir), true);
});
