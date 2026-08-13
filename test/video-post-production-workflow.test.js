import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const example = new URL("../examples/video-post-production-workflow/", import.meta.url);
const asPattern = (value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

test("post-production example exposes five creator decisions over seven stages", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  for (const decision of [
    "Click + story promise",
    "Footage reality",
    "Intro + story assembly",
    "Editorial approval → picture lock",
    "Master + package approval",
  ]) {
    assert.match(html, asPattern(decision));
  }

  for (let stage = 1; stage <= 7; stage += 1) assert.match(html, new RegExp(`S${stage}`));

  assert.match(html, /Picture lock is the hinge/i);
  assert.match(html, /Editorial approval/);
  assert.match(html, /Master approval/);
  assert.match(html, /hard lock/i);
});

test("post-production example includes current crosswalk and all format branches", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");
  const script = await readFile(new URL("workflow.js", example), "utf8");

  for (let phase = 0; phase <= 5; phase += 1) {
    assert.match(html, new RegExp(`Phase ${phase}`));
  }

  for (const format of [
    "Vertical reaction",
    "Horizontal reaction",
    "Screen demo",
    "Horizontal vlog",
    "Essay / explainer",
  ]) {
    assert.match(html + script, new RegExp(format, "i"));
  }

  assert.match(html, /Phase 2 is too broad/i);
  assert.match(html, /dailies → stringout → selects → story assembly/i);
  assert.match(script, /branch_id/);
});

test("post-production example distinguishes planning from execution and maps invalidation", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  for (const system of ["Title", "Captions", "Graphics / VFX", "Sound + music", "Color", "Legal / privacy"]) {
    assert.match(html, asPattern(system));
  }

  assert.match(html, /Plan early/);
  assert.match(html, /Execute after lock/);
  assert.match(html, /New picture-lock version/);
  assert.match(html, /Borrow from studios/i);
  assert.match(html, /Skip the bureaucracy/i);
});

test("post-production example treats visual rhythm as job-based evidence, not a quota", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  assert.match(html, /Every change needs an argument job/i);
  assert.match(html, /not a universal cut-rate target/i);
  assert.match(html, /40 <small>changes/);
  assert.match(html, /58 <small>changes/);
  assert.match(html, /Accessibility captions stay separate from semantic text/i);
  assert.match(html, /intentional quiet or reset beat/i);
  assert.match(html, /decoded editorial render/i);
});

test("review controls queue exact gate and branch targets without inventing native timecode", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");
  const script = await readFile(new URL("workflow.js", example), "utf8");

  for (let gate = 1; gate <= 5; gate += 1) assert.match(html, new RegExp(`data-gate-id="G${gate}"`));
  assert.doesNotMatch(html, /data-gate-id="G[67]"/);
  assert.match(html, /data-branch-id="vertical-reaction"/);
  assert.match(html, /data-lavish-question="workflow-model-review"/);
  assert.match(html, /The SDK queues prompts; the artifact supplies editorial semantics/i);
  assert.match(script, /queuePrompt/);
  assert.match(script, /gate_id/);
  assert.match(script, /queueKey/);
  assert.match(script, /window\.lavish\.endSession/);
  assert.doesNotMatch(script, /currentTime/);
});

test("post-production fixture is public-safe, synthetic, and portable", async () => {
  const files = await Promise.all(
    ["index.html", "workflow.css", "workflow.js", "README.md", "ART_DIRECTION.md"].map(async (name) => ({
      name,
      body: await readFile(new URL(name, example), "utf8"),
    })),
  );
  const fixture = files.map(({ body }) => body).join("\n");

  assert.match(fixture, /Synthetic/i);
  assert.doesNotMatch(fixture, /\/(Users|Volumes)\//);
  assert.doesNotMatch(fixture, /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
  assert.doesNotMatch(fixture, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(fixture, /source_thread_id|return_target_thread_id|George's|George-specific/i);

  const html = files.find(({ name }) => name === "index.html").body;
  const localReferences = [...html.matchAll(/(?:href|src)="(\.\/[^"#]+)"/g)].map(([, reference]) => reference);
  assert.deepEqual(localReferences.sort(), ["./workflow.css", "./workflow.js"]);
  await Promise.all(localReferences.map((reference) => stat(new URL(reference, example))));
});
