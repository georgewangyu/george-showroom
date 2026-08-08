// Generates the primary George Showroom skill and temporary Lavish compatibility skill
// from shared CLI guidance so neither drifts from the runtime contract.
//
//   node scripts/build-skill.js          # write the file
//   node scripts/build-skill.js --check  # fail (exit 1) if the committed file is stale
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createSkillMarkdown } from "../src/skill.js";

const targets = [
  {
    url: new URL("../skills/george-showroom/SKILL.md", import.meta.url),
    expected: createSkillMarkdown(),
  },
  {
    url: new URL("../skills/lavish/SKILL.md", import.meta.url),
    expected: createSkillMarkdown({ compatibilityAlias: true }),
  },
];
const check = process.argv.includes("--check");

if (check) {
  for (const target of targets) {
    let actual = null;
    try {
      actual = await readFile(target.url, "utf8");
    } catch {
      // missing file falls through to the mismatch branch below
    }
    if (actual !== target.expected) {
      console.error(
        `${fileURLToPath(target.url)} is out of date. Run \`node scripts/build-skill.js\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`${fileURLToPath(target.url)} is up to date.`);
  }
} else {
  for (const target of targets) {
    await mkdir(new URL("./", target.url), { recursive: true });
    await writeFile(target.url, target.expected);
    console.log(`Wrote ${fileURLToPath(target.url)}`);
  }
}
