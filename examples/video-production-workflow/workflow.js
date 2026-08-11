const beatButtons = [...document.querySelectorAll("[data-time][data-beat]")];
const activeTime = document.querySelector("#active-time");
const activeBeat = document.querySelector("#active-beat");
const playhead = document.querySelector("#playhead");
const boundaryForm = document.querySelector(".boundary-form");
const boundaryStatus = document.querySelector("#boundary-status");
const endReviewButtons = [...document.querySelectorAll("[data-end-review]")];

function selectBeat(button) {
  for (const candidate of beatButtons) {
    candidate.classList.toggle("is-active", candidate === button);
    candidate.setAttribute("aria-pressed", String(candidate === button));
  }

  activeTime.textContent = button.dataset.time;
  activeBeat.textContent = button.dataset.beat;
  playhead.style.width = `${button.dataset.position}%`;
}

for (const button of beatButtons) {
  button.setAttribute("aria-pressed", String(button.classList.contains("is-active")));
  button.addEventListener("click", () => selectBeat(button));
}

boundaryForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  const answer = new FormData(boundaryForm).get("boundary");
  if (typeof answer !== "string") return;

  const choices = {
    consolidate: {
      label: "Approve the consolidation design",
      prompt:
        "Approve a history-preserving consolidation design: the video-operations toolkit becomes the canonical internal video-code home, with the A-cut engine and browser editor planned as packages/apps. Do not move code yet; first freeze dirty work, history, compatibility paths, and validation evidence.",
    },
    "keep-separate": {
      label: "Keep the three code repositories separate",
      prompt:
        "Keep the video-operations toolkit, A-cut engine, and browser editor as separate repositories. Document the independent deployment, access-control, or public-release boundary that justifies each one before creating any further video repository.",
    },
  };
  const choice = choices[answer];
  if (!choice) return;

  if (!window.lavish?.queuePrompt) {
    boundaryStatus.textContent = `${choice.label} selected. Open this artifact in George Showroom to queue it.`;
    return;
  }

  window.lavish.queuePrompt(choice.prompt, {
    tag: "choice",
    text: `Repository boundary: ${choice.label}`,
    element: boundaryForm,
    data: { question: "video-repo-boundary", answer },
    queueKey: "video-repo-boundary",
  });
  boundaryStatus.textContent = `${choice.label} queued. Use Send to Agent, or keep reviewing.`;
});

for (const button of endReviewButtons) {
  button.addEventListener("click", () => {
    if (window.lavish?.endSession) {
      window.lavish.endSession();
      return;
    }

    button.textContent = "Open in George Showroom";
    button.disabled = true;
  });
}
