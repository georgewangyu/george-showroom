# Current Video Production Workflow Map

A local George Showroom review surface for the current George video system.
The first screen answers two creator questions without requiring repository
knowledge:

1. What happens to a video?
2. Where do I find it?

The artifact maps a seven-stage happy path over the six internal proof gates,
then progressively discloses:

- weekly intake, final normalization, needs-review, posting audit, and
  completed/carryover views;
- gate invalidation rules;
- whole-video versus timestamp/range review feedback;
- Git repositories versus applications, packages, private state, and media
  storage;
- the current overlap between a video-operations toolkit, transcript A-cut
  engine, and browser editing MVP;
- the human/agent authority boundary; and
- one history-preserving repository-boundary decision.

All visible content is synthetic and portable. The artifact contains no raw
footage, unpublished project titles, accounts, task identities, credentials,
emails, or absolute machine paths. Exact local evidence lives in a separate
private receipt.

Open from the repository root with the normal CLI:

```bash
pnpm run build
node dist/cli.mjs examples/video-production-workflow/index.html
```

Use the browser's **End Review** action or either in-artifact **End Review**
button when finished. The repository choice remains local until its form is
submitted, then queues one replaceable Showroom prompt.
