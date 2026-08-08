import { readFile } from "node:fs/promises";

const VERSION_FLAGS = new Set(["--version", "-v", "-V"]);

export async function runCli(argv) {
  // Agent harnesses probe CLI versions frequently. Keep this path independent of
  // the full server/UI dependency graph while deriving the source-run version
  // from package.json; production builds inline the same package version.
  if (argv.length === 1 && VERSION_FLAGS.has(argv[0])) {
    const version =
      process.env.LAVISH_AXI_BUILD_VERSION ||
      JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")).version;
    process.stdout.write(`${version}\n`);
    return;
  }

  const { run } = await import("../src/cli.js");
  await run(argv);
}
