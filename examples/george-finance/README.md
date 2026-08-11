# Local finance dashboard pilot

This is a privacy-bounded George Showroom example. `finance-snapshot.js` is
generated from a synthetic local-finance fixture and must remain classified
`synthetic`. No remote fonts, scripts, styles, analytics, or financial records
are used.

Open it from this checkout after building George Showroom:

```sh
LAVISH_AXI_TELEMETRY=0 node bin/george-showroom.js examples/george-finance/index.html
```

The real-data path is intentionally not wired into this tracked directory.
A private finance pipeline may export a private aggregate snapshot only beneath
its ignored `.private/` data directory.

The tracked client fails closed unless `classification` is exactly
`synthetic`. Its versioned `localfinance.showroom.v1` input contains only
rounded balances and cash-flow totals, generic allowlisted category/debt
labels, monthly DTI and income coverage, freshness, and source counts. It never
accepts account or transaction identifiers, merchant/institution names, raw
records, credentials, or metric notes. A later real-data dashboard should copy
this shell into the ignored private directory and load the aggregate snapshot
there; it should not replace this tracked fixture.
