import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

import { buildSelfContainedHtml } from "../src/export-bundle.js";

const example = new URL("../examples/george-finance/", import.meta.url);
const examplePath = fileURLToPath(example);

async function loadFixture() {
  const source = await readFile(new URL("finance-snapshot.js", example), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.LOCAL_FINANCE_SNAPSHOT;
}

async function loadDashboardHelpers() {
  const source = await readFile(new URL("dashboard.js", example), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context);
  return context.window.LOCAL_FINANCE_DASHBOARD;
}

test("finance dashboard and standalone export remain local-only", async () => {
  const [html, css, snapshot, script] = await Promise.all([
    readFile(new URL("index.html", example), "utf8"),
    readFile(new URL("dashboard.css", example), "utf8"),
    readFile(new URL("finance-snapshot.js", example), "utf8"),
    readFile(new URL("dashboard.js", example), "utf8"),
  ]);
  const sources = `${html}\n${css}\n${snapshot}\n${script}`;

  assert.doesNotMatch(sources, /(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  assert.doesNotMatch(sources, /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(sources, /url\(\s*["']?(?:https?:)?\/\//i);
  assert.doesNotMatch(script, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/);

  const bundle = await buildSelfContainedHtml(html, {
    baseDir: examplePath,
    confineDir: examplePath,
  });
  assert.deepEqual(bundle.warnings, []);
  assert.doesNotMatch(bundle.html, /<link\b[^>]*rel=["']stylesheet["']/i);
  assert.doesNotMatch(bundle.html, /<script\b[^>]*src=/i);
});

test("committed fixture conforms to the aggregate-only allowlist", async () => {
  const snapshot = await loadFixture();
  const keys = (value) => Object.keys(value).sort();

  assert.deepEqual(keys(snapshot), [
    "classification",
    "currency",
    "data_as_of",
    "debts",
    "dti_trend",
    "freshness",
    "generated_at",
    "schema_version",
    "source_summary",
    "spending_categories",
    "summary",
  ]);
  assert.equal(snapshot.classification, "synthetic");
  assert.equal(snapshot.schema_version, "localfinance.showroom.v1");
  assert.deepEqual(keys(snapshot.freshness), ["age_days", "status"]);
  assert.deepEqual(keys(snapshot.source_summary), ["account_count", "transaction_count"]);
  assert.deepEqual(keys(snapshot.summary), [
    "cash",
    "cash_flow_period",
    "dti",
    "dti_as_of",
    "income_coverage",
    "investments",
    "monthly_cash_flow",
    "monthly_income",
    "monthly_spending",
    "net_worth",
    "total_debt",
  ]);
  for (const row of snapshot.debts) {
    assert.deepEqual(keys(row), ["balance", "label", "minimum_payment"]);
  }
  for (const row of snapshot.spending_categories) {
    assert.deepEqual(keys(row), ["amount", "label"]);
  }
  for (const row of snapshot.dti_trend) {
    assert.deepEqual(keys(row), ["as_of", "dti", "income_coverage"]);
  }
  const requiredPayments = snapshot.debts.reduce((total, row) => total + (row.minimum_payment || 0), 0);
  assert.equal(snapshot.summary.dti, Number((requiredPayments / snapshot.summary.monthly_income).toFixed(4)));
  assert.equal(
    snapshot.summary.income_coverage,
    Number((snapshot.summary.monthly_income / requiredPayments).toFixed(4)),
  );
});

test("dashboard rejects unsafe or unusable states and reports freshness", async () => {
  const [fixture, helpers] = await Promise.all([loadFixture(), loadDashboardHelpers()]);

  assert.match(helpers.validateSnapshot(null).title, /No local snapshot/);
  assert.match(helpers.validateSnapshot({ ...fixture, schema_version: "future.v2" }).title, /different contract/);
  assert.match(helpers.validateSnapshot({ ...fixture, classification: "private" }).title, /synthetic data only/);
  assert.match(helpers.validateSnapshot({ ...fixture, classification: undefined }).title, /synthetic data only/);
  assert.match(helpers.validateSnapshot({ ...fixture, freshness: { status: "empty", age_days: null } }).title, /empty/);
  assert.equal(helpers.validateSnapshot(fixture), null);
  assert.deepEqual(
    { ...helpers.freshnessPresentation({ status: "fresh", age_days: 0 }) },
    {
      state: "fresh",
      label: "Updated today",
    },
  );
  assert.equal(helpers.freshnessPresentation({ status: "aging", age_days: 5 }).label, "5 days old");
  assert.equal(helpers.freshnessPresentation({ status: "stale", age_days: 14 }).label, "Stale · 14 days old");
});
