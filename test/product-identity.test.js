import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { createHomeOutput, getCommandHelp } from "../src/cli.js";
import { createPluginManifest } from "../src/plugin.js";
import { createChromeHtml } from "../src/server.js";
import { createSkillMarkdown, parseSkillFrontmatter } from "../src/skill.js";

const rootFile = (name) => new URL(`../${name}`, import.meta.url);

test("package identity makes george-showroom primary and keeps the lavish-axi CLI alias", async () => {
  const packageJson = JSON.parse(await readFile(rootFile("package.json"), "utf8"));

  assert.equal(packageJson.name, "george-showroom");
  assert.equal(packageJson.bin["george-showroom"], "dist/cli.mjs");
  assert.equal(packageJson.bin["lavish-axi"], "dist/cli.mjs");
  assert.equal(packageJson.repository.url, "git+https://github.com/georgewangyu/george-showroom.git");
  assert.equal(packageJson.bugs.url, "https://github.com/georgewangyu/george-showroom/issues");
  assert.equal(packageJson.homepage, "https://github.com/georgewangyu/george-showroom#readme");

  const primaryEntrypoint = await stat(rootFile("bin/george-showroom.js"));
  assert.notEqual(primaryEntrypoint.mode & 0o111, 0, "the primary source-checkout CLI is executable");
});

test("README and provenance make the fork identity and upstream obligations explicit", async () => {
  const [readme, upstream] = await Promise.all([
    readFile(rootFile("README.md"), "utf8"),
    readFile(rootFile("UPSTREAM.md"), "utf8"),
  ]);

  assert.match(readme, /<h1 align="center">George Showroom<\/h1>/);
  assert.match(readme, /npx -y george-showroom/);
  assert.match(readme, /`lavish-axi`.*temporary compatibility alias/is);
  assert.match(readme, /Kun Chen.*Lavish/is);
  assert.doesNotMatch(readme, /npm install (?:-g|--global) george-showroom/);
  assert.match(readme, /npm install --global \./);
  assert.match(upstream, /https:\/\/github\.com\/kunchenguid\/lavish-axi/);
  assert.match(upstream, /542819086b799d907e7eddf0a1fadd2eb60c3dfe/);
  assert.match(upstream, /MIT License/);
  assert.match(upstream, /upstream\/main/);
  assert.match(upstream, /preserve.*copyright.*license/is);
});

test("CLI and browser present George Showroom while inherited compatibility internals remain available", () => {
  const home = createHomeOutput({ bin: "george-showroom", sessions: [] });
  const help = getCommandHelp("open");
  const chrome = createChromeHtml({ key: "abc", file: "/tmp/artifact.html" });

  assert.match(home.description, /George Showroom/);
  assert.ok(home.help.some((line) => line.includes("george-showroom poll <html-file>")));
  assert.match(help, /^Usage: george-showroom <html-file>/);
  assert.match(chrome, /<title>George Showroom<\/title>/);
  assert.match(chrome, /<span class="brand-mark">George<\/span><span class="brand-support">Showroom<\/span>/);
  assert.match(chrome, /id="lavish-session"/, "the inherited browser protocol stays compatible");
});

test("plugin and generated skill expose the George Showroom identity and credit Lavish upstream", async () => {
  const packageJson = JSON.parse(await readFile(rootFile("package.json"), "utf8"));
  const manifest = createPluginManifest(packageJson);
  const skill = createSkillMarkdown();
  const { frontmatter, errors } = parseSkillFrontmatter(skill);

  assert.equal(manifest.name, "george-showroom");
  assert.deepEqual(manifest.author, { name: "George Wang", url: "https://github.com/georgewangyu" });
  assert.deepEqual(errors, []);
  assert.equal(frontmatter.name, "george-showroom");
  assert.match(skill, /^# George Showroom$/m);
  assert.match(skill, /trusted checkout installed once/);
  assert.doesNotMatch(skill, /Run `npx -y george-showroom/);
  assert.match(skill, /Originally forked from Lavish by Kun Chen/);
});

test("the inherited Lavish skill remains a temporary compatibility alias", () => {
  const skill = createSkillMarkdown({ compatibilityAlias: true });
  const { frontmatter, errors } = parseSkillFrontmatter(skill);

  assert.deepEqual(errors, []);
  assert.equal(frontmatter.name, "lavish");
  assert.match(skill, /compatibility skill delegates to George Showroom/);
  assert.match(skill, /trusted checkout installed once/);
});
