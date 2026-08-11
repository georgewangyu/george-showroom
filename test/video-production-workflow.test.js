import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const example = new URL("../examples/video-production-workflow/", import.meta.url);

test("video workflow example exposes the seven-stage creator path and six gates", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  for (const stage of [
    "Choose the premise",
    "Land footage",
    "Lock the transcript",
    "Plan proof, B-roll",
    "Assemble and prove",
    "Render, inspect",
    "Approve, file, publish",
  ]) {
    assert.match(html, new RegExp(stage, "i"));
  }

  for (let gate = 0; gate <= 5; gate += 1) {
    assert.match(html, new RegExp(`Gate ${gate}`));
  }

  assert.match(html, /What happens to a video/);
  assert.match(html, /Where do I find it/);
  assert.match(html, /Upstream changes erase downstream confidence/);
});

test("weekly lifecycle keeps old stable files out of incoming", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  for (const label of ["Incoming", "By-week final", "Needs review", "Posting audit", "Completed or carryover"]) {
    assert.match(html, new RegExp(label, "i"));
  }

  assert.match(html, /stable old file may not silently remain in incoming/i);
  assert.match(html, /Never guess the destination/i);
});

test("technical map separates repositories from applications and storage", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");

  for (const owner of [
    "Private planning repository",
    "Video operations toolkit",
    "Transcript A-cut engine",
    "Browser editing MVP",
    "George Showroom",
    "CapCut",
    "capcutbot",
    "Platform bots",
  ]) {
    assert.match(html, new RegExp(owner, "i"));
  }

  assert.match(html, /Git repository · private access boundary/);
  assert.match(html, /Storage volume · not Git/);
  assert.match(html, /Applications \/ runtimes · not project state/);
});

test("review model distinguishes whole-video and time-range feedback", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");
  const script = await readFile(new URL("workflow.js", example), "utf8");

  assert.match(html, /WHOLE VIDEO/);
  assert.match(html, /TIMESTAMP \/ RANGE/);
  assert.match(html, /Play this range|Clickable review beats|00:14–00:23/i);
  assert.match(script, /aria-pressed/);
  assert.match(script, /dataset\.position/);
});

test("workflow fixture is synthetic, portable, and privacy bounded", async () => {
  const files = await Promise.all(
    ["index.html", "workflow.css", "workflow.js", "README.md"].map(async (name) => ({
      name,
      body: await readFile(new URL(name, example), "utf8"),
    })),
  );
  const fixture = files.map(({ body }) => body).join("\n");

  assert.match(fixture, /Synthetic/i);
  assert.doesNotMatch(fixture, /https?:\/\//);
  assert.doesNotMatch(fixture, /\/(Users|Volumes)\//);
  assert.doesNotMatch(fixture, /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/i);
  assert.doesNotMatch(fixture, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  assert.doesNotMatch(fixture, /source_thread_id|return_target_thread_id/);

  const html = files.find(({ name }) => name === "index.html").body;
  const localReferences = [...html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)].map(([, reference]) => reference);
  assert.deepEqual(localReferences.sort(), ["./workflow.css", "./workflow.js"]);
  await Promise.all(localReferences.map((reference) => stat(new URL(reference, example))));
});

test("workflow controls queue one explicit decision and expose End Review", async () => {
  const html = await readFile(new URL("index.html", example), "utf8");
  const script = await readFile(new URL("workflow.js", example), "utf8");
  const styles = await readFile(new URL("workflow.css", example), "utf8");

  assert.match(html, /data-lavish-question="video-repo-boundary"/);
  assert.match(html, /Queue this decision/);
  assert.match(html, /data-end-review/);
  assert.match(html, /<details/);
  assert.match(html, /<summary>/);
  assert.match(html, /type="radio"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(styles, /:focus-visible/);
  assert.match(script, /queuePrompt/);
  assert.match(script, /queueKey: "video-repo-boundary"/);
  assert.match(script, /window\.lavish\.endSession/);
});
