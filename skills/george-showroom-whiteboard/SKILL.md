---
name: george-showroom-whiteboard
description: Create and run a George Showroom whiteboard: one huge editable spatial canvas that George can pan, zoom, rearrange, draw on, and return to an agent with comments. Use for mind maps, decision trees, branching explainers, and collaborative visual outlining.
license: MIT
metadata:
  author: George Wang (georgewangyu)
  argument-hint: <topic or decision tree to map>
  hermes-tags: whiteboard, mind-map, excalidraw, visualization
  hermes-category: productivity
---

# George Showroom Whiteboard

Build a whiteboard-first George Showroom session: one giant spatial canvas, not a report with a diagram inside it. Use the bundled template in `assets/whiteboard.html` as the starting point.

## Request

$ARGUMENTS

## When to use

- Mind maps, decision trees, branching arguments, systems maps, or video structures that benefit from pan and zoom.
- The user wants to move nodes, redraw relationships, add freehand marks, or leave a note directly beside the visual.
- A large overview frame may later become a thumbnail or a camera map for a video.

Do not use this profile for a conventional report, dense table, slide deck, or a diagram that does not need direct manipulation.

## Build contract

1. Copy `assets/whiteboard.html` to `georgesshowroom/<name>-whiteboard.html` in the working directory.
2. Replace the template's one full-canvas Mermaid seed with the user's content. Keep exactly one `.mermaid` container and prefer `flowchart TD` for a downward decision tree.
3. Make the map broad enough to show the whole system, but keep node labels short: one idea per node, usually one or two lines. Use labeled edges for questions or decisions.
4. Run `george-showroom <html-file>`. Verify the returned `/session/<id>` URL and the outer Conversation controls. Click the board once to edit inline or choose **Fullscreen** for the largest canvas.
5. Run `george-showroom poll <html-file> --agent-reply "I seeded the whiteboard. Move, rewrite, or draw on it, then use Queue feedback and Send to Agent."`.
   Keep the poll in the foreground by default and let it return the feedback directly to the agent.
   A background poll is allowed only through a harness-native tracked background-job facility whose completion result is guaranteed to resume or notify the same agent.
   Never use `nohup`, shell `&`, `disown`, redirected fire-and-forget processes, or a detached terminal without an explicit verified callback merely to keep polling alive.
   If the harness has no completion-aware background facility, use the foreground poll or first wire a verified wake callback into the surrounding supervisor.
   Do not tell the user the artifact is being monitored until that wake path is live.
   If the poll gets killed or times out anyway, just re-run it - queued feedback is never lost.
6. When feedback arrives with tag `whiteboard`, read the bounded edit summary first. Inspect `previewPath` or `scenePath` only when the summary is insufficient.
7. Apply structural changes by updating the Mermaid source in the HTML. Never overwrite the user's `.excalidraw` scene: it contains their spatial edits, freehand marks, and review context. If source and scene diverge, tell the user before asking Showroom to reconvert.
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
