import { POLL_WAKE_PATH_RULES } from "./cli.js";
import { MERMAID_CDN_URL } from "./design-reference.js";

export const WHITEBOARD_SKILL_DESCRIPTION =
  "Create and run a George Showroom whiteboard: one huge editable spatial canvas that George can pan, zoom, rearrange, draw on, and return to an agent with comments. Use for mind maps, decision trees, branching explainers, and collaborative visual outlining.";

export function createWhiteboardSkillMarkdown() {
  return `---
name: george-showroom-whiteboard
description: ${WHITEBOARD_SKILL_DESCRIPTION}
license: MIT
metadata:
  author: George Wang (georgewangyu)
  argument-hint: <topic or decision tree to map>
  hermes-tags: whiteboard, mind-map, excalidraw, visualization
  hermes-category: productivity
---

# George Showroom Whiteboard

Build a whiteboard-first George Showroom session: one giant spatial canvas, not a report with a diagram inside it. Use the bundled template in \`assets/whiteboard.html\` as the starting point.

## Request

$ARGUMENTS

## When to use

- Mind maps, decision trees, branching arguments, systems maps, or video structures that benefit from pan and zoom.
- The user wants to move nodes, redraw relationships, add freehand marks, or leave a note directly beside the visual.
- A large overview frame may later become a thumbnail or a camera map for a video.

Do not use this profile for a conventional report, dense table, slide deck, or a diagram that does not need direct manipulation.

## Build contract

1. Copy \`assets/whiteboard.html\` to \`georgesshowroom/<name>-whiteboard.html\` in the working directory.
2. Replace the template's one full-canvas Mermaid seed with the user's content. Keep exactly one \`.mermaid\` container and prefer \`flowchart TD\` for a downward decision tree.
3. Make the map broad enough to show the whole system, but keep node labels short: one idea per node, usually one or two lines. Use labeled edges for questions or decisions.
4. Run \`george-showroom <html-file>\`. Verify the returned \`/session/<id>\` URL and the outer Conversation controls. Click the board once to edit inline or choose **Fullscreen** for the largest canvas.
5. Run \`george-showroom poll <html-file> --agent-reply "I seeded the whiteboard. Move, rewrite, or draw on it, then use Queue feedback and Send to Agent."\`.
${POLL_WAKE_PATH_RULES.map((rule) => `   ${rule}`).join("\n")}
6. When feedback arrives with tag \`whiteboard\`, read the bounded edit summary first. Inspect \`previewPath\` or \`scenePath\` only when the summary is insufficient.
7. Apply structural changes by updating the Mermaid source in the HTML. Never overwrite the user's \`.excalidraw\` scene: it contains their spatial edits, freehand marks, and review context. If source and scene diverge, tell the user before asking Showroom to reconvert.
8. Poll again after updates. Stop when the user ends the session or makes the creator decision.

## Collaboration grammar

- **Codex owns the structured seed:** node IDs, labels, edge semantics, and large branch additions.
- **George owns the live composition:** positioning, freehand marks, visual emphasis, and taste decisions.
- **Comments travel in two ways:** write an optional note before **Queue feedback**, or place a sticky/text object directly on the board and queue the scene.
- **No silent merge:** a saved scene and changed Mermaid source are two versions. Preserve both and let George choose whether to keep the scene or reconvert the source.

## Visual grammar

- Use a top-down tree with a strong root and progressively smaller branches.
- Reserve one accent color for the active path; keep alternate paths neutral.
- Repeat branch spacing and node sizes so the map reads at a distance.
- Build a meaningful full-map silhouette for the overview/thumbnail, then ensure every focus area remains legible when zoomed.
- Prefer deterministic Mermaid-to-Excalidraw geometry. Generated imagery is optional decoration, never the map's structural source.

## Video handoff

The whiteboard is the editable planning surface, not yet a rendered video. At the video asset gate, lock the chosen path, reveal order, focus landings, safe zones, and thumbnail crop. Assembly can then reproduce those moves deterministically in SVG/Canvas/Remotion or another approved renderer.
`;
}

export function createWhiteboardTemplateHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="lavish-annotation-mode" content="off" />
    <title>George Showroom Whiteboard</title>
    <style>
      * {
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        min-height: 100%;
        background: #f7f4ec;
        color: #17130a;
      }
      body {
        font-family:
          Inter,
          ui-sans-serif,
          system-ui,
          -apple-system,
          sans-serif;
      }
      main {
        min-height: calc(100vh - 2px);
        padding: 1px;
      }
      .mermaid {
        width: 100%;
        min-height: calc(100vh - 2px);
        display: grid;
        place-items: center;
      }
    </style>
  </head>
  <body>
    <main>
      <pre class="mermaid">
flowchart TD
  ROOT["UNTITLED WHITEBOARD"] --> FIRST["First branch"]
  ROOT --> SECOND["Second branch"]
  </pre
      >
    </main>
    <script type="module">
      import mermaid from "${MERMAID_CDN_URL}";
      mermaid.initialize({
        startOnLoad: true,
        theme: "neutral",
        securityLevel: "strict",
        flowchart: { curve: "basis", nodeSpacing: 48, rankSpacing: 72 },
      });
    </script>
  </body>
</html>
`;
}
