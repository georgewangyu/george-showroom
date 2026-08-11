// @ts-check
(() => {
  "use strict";

  const EXPECTED_SCHEMA = "localfinance.showroom.v1";
  const financeWindow = /** @type {Window & { LOCAL_FINANCE_SNAPSHOT?: any, LOCAL_FINANCE_DASHBOARD?: any }} */ (
    window
  );

  /** @param {any} candidate */
  function validateSnapshot(candidate) {
    if (!candidate) {
      return {
        title: "No local snapshot found.",
        copy: "Generate the aggregate snapshot, then reload this page.",
      };
    }
    if (candidate.schema_version !== EXPECTED_SCHEMA) {
      return {
        title: "This snapshot uses a different contract.",
        copy: `Expected ${EXPECTED_SCHEMA}; received ${candidate.schema_version || "an unknown version"}.`,
      };
    }
    if (candidate.classification !== "synthetic") {
      return {
        title: "This public example accepts synthetic data only.",
        copy: "Open private aggregate snapshots from the finance pipeline's ignored private dashboard directory.",
      };
    }
    if (!candidate.summary || candidate.freshness?.status === "empty") {
      return {
        title: "The snapshot is empty.",
        copy: "Import synthetic records and a monthly DTI metric, then regenerate it.",
      };
    }
    return null;
  }

  /** @param {{ status?: string, age_days?: number | null }} freshness */
  function freshnessPresentation(freshness) {
    const age = freshness?.age_days;
    if (age === 0) return { state: "fresh", label: "Updated today" };
    if (age == null) return { state: "empty", label: "No data date" };
    const state = freshness.status || "aging";
    return {
      state,
      label: `${state === "stale" ? "Stale · " : ""}${age} days old`,
    };
  }

  financeWindow.LOCAL_FINANCE_DASHBOARD = Object.freeze({
    validateSnapshot,
    freshnessPresentation,
  });

  if (typeof document === "undefined") return;

  /** @param {string} selector */
  function element(selector) {
    const found = document.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`Missing dashboard element: ${selector}`);
    return found;
  }

  const snapshot = financeWindow.LOCAL_FINANCE_SNAPSHOT;
  const dashboard = element("#dashboard");
  const errorPanel = element("#error-panel");

  function fail(title, copy) {
    element("#error-title").textContent = title;
    element("#error-copy").textContent = copy;
    dashboard.hidden = true;
    errorPanel.hidden = false;
    requestAnimationFrame(() => errorPanel.classList.add("is-visible"));
  }

  const error = validateSnapshot(snapshot);
  if (error) {
    fail(error.title, error.copy);
    return;
  }

  element("#classification-label").textContent = "Synthetic data";
  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: snapshot.currency || "USD",
    maximumFractionDigits: 0,
  });
  const month = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
  const formatMonth = (value) => (value ? month.format(new Date(`${value}-01T12:00:00Z`)) : "No period");
  const percent = (value) => (value == null ? "—" : `${(value * 100).toFixed(1)}%`);
  const setText = (selector, value) => {
    element(selector).textContent = value;
  };

  const summary = snapshot.summary;
  setText("#net-worth", money.format(summary.net_worth));
  setText("#cash-total", money.format(summary.cash));
  setText("#investment-total", money.format(summary.investments));
  setText("#debt-total", money.format(summary.total_debt));
  setText("#debt-card-total", money.format(summary.total_debt));
  setText("#cash-flow", `${summary.monthly_cash_flow >= 0 ? "+" : ""}${money.format(summary.monthly_cash_flow)}`);
  setText("#monthly-income", money.format(summary.monthly_income));
  setText("#monthly-spending", money.format(summary.monthly_spending));
  setText("#spending-total", money.format(summary.monthly_spending));
  setText("#cash-flow-period", formatMonth(summary.cash_flow_period));
  setText("#data-as-of", `As of ${snapshot.data_as_of || "unknown"}`);
  setText("#kept-rate", percent(summary.monthly_income ? summary.monthly_cash_flow / summary.monthly_income : null));
  setText("#dti-value", percent(summary.dti));
  setText("#coverage-value", summary.income_coverage == null ? "—" : `${summary.income_coverage.toFixed(1)}×`);
  setText(
    "#dti-explanation",
    summary.dti == null
      ? "Record a verified monthly income and required-payment snapshot."
      : `Required debt payments use ${(summary.dti * 100).toFixed(1)} cents of each gross-income dollar.`,
  );
  setText(
    "#source-summary",
    `${snapshot.source_summary.account_count} aggregate accounts · ${snapshot.source_summary.transaction_count} synthetic records`,
  );

  const freshness = element("#freshness-label");
  const presentedFreshness = freshnessPresentation(snapshot.freshness);
  freshness.dataset.state = presentedFreshness.state;
  freshness.textContent = presentedFreshness.label;

  const grossPosition = summary.cash + summary.investments + summary.total_debt;
  const assetShare = grossPosition ? ((summary.cash + summary.investments) / grossPosition) * 100 : 0;
  requestAnimationFrame(() => {
    element("#asset-bar").style.width = `${assetShare}%`;
    element("#debt-bar").style.width = `${100 - assetShare}%`;
  });

  const categories = element("#category-list");
  const categoryMax = Math.max(...snapshot.spending_categories.map((item) => item.amount), 1);
  for (const item of snapshot.spending_categories) {
    const row = document.createElement("div");
    row.className = "category-row";
    const label = document.createElement("span");
    label.textContent = item.label;
    const bar = document.createElement("span");
    bar.className = "category-bar";
    const fill = document.createElement("span");
    bar.append(fill);
    const amount = document.createElement("span");
    amount.textContent = money.format(item.amount);
    row.append(label, bar, amount);
    categories.append(row);
    requestAnimationFrame(() => {
      fill.style.width = `${(item.amount / categoryMax) * 100}%`;
    });
  }

  const debts = element("#debt-list");
  for (const item of snapshot.debts) {
    const row = document.createElement("div");
    row.className = "debt-row";
    const label = document.createElement("span");
    label.className = "debt-label";
    label.textContent = item.label;
    const balance = document.createElement("strong");
    balance.className = "debt-balance";
    balance.textContent = money.format(item.balance);
    const payment = document.createElement("span");
    payment.className = "debt-payment";
    payment.textContent =
      item.minimum_payment == null
        ? "Minimum payment unavailable"
        : `${money.format(item.minimum_payment)} required monthly`;
    row.append(label, balance, payment);
    debts.append(row);
  }

  const gauge = element("#dti-gauge");
  gauge.style.setProperty("--gauge", `${Math.min(summary.dti || 0, 0.5) * 720}deg`);
  gauge.setAttribute("aria-label", `Debt-to-income ratio ${percent(summary.dti)}`);

  const trend = element("#dti-trend");
  const trendMax = Math.max(...snapshot.dti_trend.map((item) => item.dti || 0), 0.01);
  for (const item of snapshot.dti_trend) {
    const point = document.createElement("div");
    point.className = "trend-point";
    point.style.height = `${Math.max(12, ((item.dti || 0) / trendMax) * 34)}px`;
    const value = document.createElement("span");
    value.textContent = percent(item.dti);
    point.append(value);
    trend.append(point);
  }

  dashboard.hidden = false;
  for (const candidate of document.querySelectorAll(".reveal")) {
    if (!(candidate instanceof HTMLElement)) continue;
    const delay = Number(candidate.dataset.delay || 0);
    window.setTimeout(() => candidate.classList.add("is-visible"), delay);
  }
})();
