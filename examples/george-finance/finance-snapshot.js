// @ts-check
/** @type {Window & { LOCAL_FINANCE_SNAPSHOT?: unknown }} */ (window).LOCAL_FINANCE_SNAPSHOT = Object.freeze({
  classification: "synthetic",
  currency: "USD",
  data_as_of: "2026-08-08",
  debts: [
    {
      balance: 6400.0,
      label: "Credit card 1",
      minimum_payment: 320.0,
    },
    {
      balance: 12400.0,
      label: "Student loan 1",
      minimum_payment: 410.0,
    },
  ],
  dti_trend: [
    {
      as_of: "2026-06-30",
      dti: 0.0857,
      income_coverage: 11.6667,
    },
    {
      as_of: "2026-07-31",
      dti: 0.082,
      income_coverage: 12.1951,
    },
    {
      as_of: "2026-08-07",
      dti: 0.0785,
      income_coverage: 12.7397,
    },
  ],
  freshness: {
    age_days: 0,
    status: "fresh",
  },
  generated_at: "2026-08-08T18:18:53+00:00",
  schema_version: "localfinance.showroom.v1",
  source_summary: {
    account_count: 5,
    transaction_count: 8,
  },
  spending_categories: [
    {
      amount: 2400.0,
      label: "Rent & utilities",
    },
    {
      amount: 935.0,
      label: "Food & drink",
    },
    {
      amount: 440.0,
      label: "General merchandise",
    },
    {
      amount: 220.0,
      label: "Transportation",
    },
    {
      amount: 96.0,
      label: "Entertainment",
    },
  ],
  summary: {
    cash: 30880.55,
    cash_flow_period: "2026-08",
    dti: 0.0785,
    dti_as_of: "2026-08-07",
    income_coverage: 12.7397,
    investments: 35400.0,
    monthly_cash_flow: 5209.0,
    monthly_income: 9300.0,
    monthly_spending: 4091.0,
    net_worth: 47480.55,
    total_debt: 18800.0,
  },
});
