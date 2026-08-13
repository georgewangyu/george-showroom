const branches = {
  "vertical-reaction": {
    name: "Vertical reaction",
    authority: "Speech-led, source-bounded",
    route: "source context → response selects → transcript-led A-cut → fine cut",
    why: "Speech usually owns the argument; the reacted-to source supplies the minimum truthful context.",
    lock: "Source attribution, first seconds, presenter/source geometry, title, captions, and mobile safe zones.",
    failure: "Treating a style precedent as the content source or overbuilding finish before the response cut lands.",
  },
  "horizontal-reaction": {
    name: "Horizontal reaction",
    authority: "Conversation-led, context-flexible",
    route: "source context → response selects → transcript-led spine → visual pacing pass",
    why: "Dialogue still carries the case, while the wider frame permits richer source context and quieter pacing.",
    lock: "Source truth, editorial rhythm, reaction/source balance, widescreen geometry, music and caption mode.",
    failure: "Mistaking transcript order for finished pacing or allowing source playback to displace the response.",
  },
  "screen-demo": {
    name: "Screen demo",
    authority: "Action-led, step-bounded",
    route: "task proof → action log → usable takes → step assembly → clarity cut",
    why: "The viewer must see each truthful state transition; narration alone cannot prove an interaction occurred.",
    lock: "UI state, cursor intent, redaction, readable zooms, step continuity, callouts, and delivery resolution.",
    failure: "Editing from narration while hiding broken, missing, private, or unreadable screen states.",
  },
  "horizontal-vlog": {
    name: "Horizontal vlog",
    authority: "Event-led, coverage-dependent",
    route: "dailies → stringout → selects → story assembly → rough cut",
    why: "Chronology, silent action, place, reaction, visual motifs, and coverage gaps all participate in the story.",
    lock: "Story promise, chronology, scene completeness, transitions, privacy, music arc, and visual continuity.",
    failure: "Letting a transcript choose the story while ignoring silent behavior, atmosphere, and missing coverage.",
  },
  "essay-explainer": {
    name: "Essay / explainer",
    authority: "Argument-led, proof-bounded",
    route: "claim map → narration selects → proof plan → radio assembly → visual assembly → fine cut",
    why: "Narration owns the logic, but every substantive claim needs accurate, sufficient, and attributable proof.",
    lock: "Claim order, proof sufficiency, graphic logic, citations, narration timing, and downstream visual handles.",
    failure: "Approving a polished radio cut whose visual evidence is generic, late, or unable to sustain the claims.",
  },
};

const gateCards = [...document.querySelectorAll("[data-gate-id]")];
const gateStatus = document.querySelector("#gate-status");
const formatButtons = [...document.querySelectorAll("[data-branch-id]")];
const formatPanel = document.querySelector("#format-panel");
const queueFormatButton = document.querySelector("#queue-format");

function queuePrompt(prompt, options) {
  if (window.lavish?.queuePrompt) {
    window.lavish.queuePrompt(prompt, options);
    return true;
  }
  return false;
}

for (const card of gateCards) {
  card.querySelector("[data-review-gate]")?.addEventListener("click", () => {
    const gateId = card.dataset.gateId;
    const title = card.querySelector("h3")?.textContent?.trim() || gateId;
    const queued = queuePrompt(
      `Review ${gateId} — ${title}. Say what should change, what evidence is missing, or whether this gate boundary is correct.`,
      {
        tag: "workflow-gate",
        text: `${gateId} · ${title}`,
        element: card,
        data: { artifact: "synthetic-post-production-workflow", gate_id: gateId },
        queueKey: `post-workflow-gate-${gateId}`,
      },
    );
    gateStatus.textContent = queued
      ? `${gateId} feedback queued. Re-queueing this gate replaces the earlier prompt.`
      : `${gateId} selected. Open through George Showroom to queue feedback.`;
  });
}

function selectBranch(branchId) {
  const branch = branches[branchId];
  if (!branch) return;
  for (const button of formatButtons) {
    const active = button.dataset.branchId === branchId;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
  }
  formatPanel.dataset.activeBranch = branchId;
  document.querySelector("#format-id").textContent = `BRANCH / ${branchId.toUpperCase()}`;
  document.querySelector("#format-name").textContent = branch.name;
  document.querySelector("#format-authority").textContent = branch.authority;
  document.querySelector("#format-route").textContent = branch.route;
  document.querySelector("#format-why").textContent = branch.why;
  document.querySelector("#format-lock").textContent = branch.lock;
  document.querySelector("#format-failure").textContent = branch.failure;
}

for (const button of formatButtons) {
  button.addEventListener("click", () => selectBranch(button.dataset.branchId));
}

queueFormatButton?.addEventListener("click", () => {
  const branchId = formatPanel.dataset.activeBranch;
  const branch = branches[branchId];
  const queued = queuePrompt(
    `Review the ${branch.name} branch (${branchId}). Identify the missing editorial step, wrong authority, or lock emphasis that should change.`,
    {
      tag: "workflow-branch",
      text: `Branch · ${branch.name}`,
      element: formatPanel,
      data: { artifact: "synthetic-post-production-workflow", branch_id: branchId },
      queueKey: `post-workflow-branch-${branchId}`,
    },
  );
  queueFormatButton.textContent = queued ? "Branch feedback queued" : "Open in Showroom to queue";
});

const decisionForm = document.querySelector(".decision-form");
decisionForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const model = new FormData(decisionForm).get("model");
  const labels = {
    "five-decisions-seven-stages": "Pilot five creator decisions over seven professional stages",
    "four-rooms-five-decisions": "Use four navigation rooms with five creator decisions and seven stages",
    "needs-correction": "Correct the model before a pilot",
  };
  const queued = queuePrompt(
    `Workflow model decision: ${labels[model]}. Treat this as the current direction for the pilot.`,
    {
      tag: "workflow-model-review",
      text: labels[model],
      element: decisionForm,
      data: { artifact: "synthetic-post-production-workflow", workflow_model: model },
      queueKey: "post-workflow-model-review",
    },
  );
  document.querySelector("#decision-status").textContent = queued
    ? "Workflow decision queued; changing it before send replaces this choice."
    : "Decision selected. Open through George Showroom to queue it.";
});

for (const button of document.querySelectorAll("[data-end-review]")) {
  button.addEventListener("click", () => {
    if (window.lavish?.endSession) window.lavish.endSession();
    else button.textContent = "Open in Showroom to end";
  });
}

selectBranch("vertical-reaction");
