# Video post-production workflow benchmark

This public-safe synthetic fixture visualizes five creator decision gates over seven professional post-production stages, plus a measured visual-rhythm case study that remains a candidate benchmark rather than a cut-rate default. It contains no private footage, project identity, local path, task identifier, account data, or personal metadata.

The five text-role names express creator-neutral editorial jobs. No private palette, font, motion timing, safe-zone value, frequency target, or creator preset is embedded.

Open it with the built George Showroom CLI:

```bash
node dist/cli.mjs examples/video-post-production-workflow/index.html
```

The page supports ordinary element and text-range annotations. Its custom controls queue replaceable prompts with exact `gate_id` and `branch_id` values. The page deliberately does not invent native timecode support: a real video-review artifact may capture player time and beat identity before calling `window.lavish.queuePrompt()`, while the core SDK remains a generic queue and annotation surface.

The artifact is dependency-free and keeps all local assets in this directory.
