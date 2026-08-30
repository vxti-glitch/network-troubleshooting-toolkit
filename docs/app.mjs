import { buildPayload, buildTicketNote, renderMarkdown, SCENARIOS } from "./triage.mjs";

const state = { key: "healthy", payload: null, output: "markdown", checkedAt: null, acknowledged: false };
const histories = {
  healthy: { points: "20,108 100,102 180,106 260,96 340,100 420,92 500,99 580,95 700,90", value: "41.7 ms", label: "Healthy path", copy: "Application-path response remains inside the fictional baseline." },
  dns: { points: "20,104 100,98 180,101 260,96 340,93 420,88 500,42 580,25 700,25", value: "DNS failed", label: "Resolver alert", copy: "Gateway response stayed stable while internal name resolution failed." },
  blocked: { points: "20,102 100,96 180,100 260,91 340,88 420,56 500,28 580,25 700,25", value: "TCP timeout", label: "Service alert", copy: "DNS remained available while the HTTPS application path timed out." },
  local: { points: "20,98 100,96 180,92 260,58 340,25 420,25 500,25 580,25 700,25", value: "Gateway down", label: "Endpoint alert", copy: "The endpoint lost local-path connectivity before external checks ran." },
};
const $ = (selector) => document.querySelector(selector);
const elements = {
  scenario: $("#scenario"), impact: $("#scenario-impact"), run: $("#run-triage"),
  status: $("#live-status"), rows: $("#evidence-rows"), assessment: $("#assessment-text"), next: $("#next-action"),
  ticket: $("#ticket-note"), report: $("#report-output"), download: $("#download-report"),
};

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function render() {
  const scenario = SCENARIOS[state.key];
  state.payload = buildPayload(scenario.targets, scenario.results, scenario.localInfo);
  const { summary } = state.payload;
  $("#metric-status").textContent = summary.status.toUpperCase();
  $("#metric-status").className = `metric-status status-${summary.status}`;
  $("#metric-targets").textContent = summary.target_count;
  $("#metric-checks").textContent = summary.check_count;
  $("#metric-failed").textContent = summary.failed_checks;
  $("#metric-scope").textContent = scenario.scope.split(";")[0];
  elements.assessment.textContent = scenario.assessment;
  elements.next.textContent = scenario.nextAction;
  const assessmentState = $("#assessment-state");
  assessmentState.className = `assessment-state assessment-${summary.status}`;
  assessmentState.querySelector("strong").textContent = summary.status === "healthy" ? "Service path is healthy" : summary.status === "down" ? "Service path is unavailable" : "Failure isolated for escalation";
  assessmentState.querySelector(".assessment-icon").textContent = summary.status === "healthy" ? "✓" : "!";
  const history = histories[state.key];
  $("#history-line").setAttribute("points", history.points);
  $("#history-value").textContent = history.value;
  $("#history-label").textContent = history.label;
  $("#history-copy").textContent = history.copy;
  $("#ops-endpoint").textContent = state.key === "blocked" ? "SHARED-SERVICE-PATH" : state.key === "dns" ? "WIN11-VPN-14" : state.key === "local" ? "WIN11-HOME-22" : "WIN11-REMOTE-07";
  $("#last-checked").textContent = state.checkedAt ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(state.checkedAt) : "Waiting for triage";
  const alertButton = $("#ack-alert");
  alertButton.disabled = summary.status === "healthy";
  alertButton.classList.toggle("is-acknowledged", state.acknowledged);
  alertButton.textContent = summary.status === "healthy" ? "No active alert" : state.acknowledged ? "Acknowledged by Tier 1" : "Acknowledge simulated alert";

  document.querySelectorAll("[data-node]").forEach((node) => {
    const status = scenario.path[node.dataset.node];
    node.className = `path-node node-${status}`;
    node.querySelector("b").textContent = status.toUpperCase();
  });

  elements.rows.innerHTML = scenario.results.map((result) => `
    <tr>
      <td><span class="result result-${result.status}">${result.status}</span></td>
      <td><strong>${escapeHtml(result.name)}</strong><small>${escapeHtml(result.target)}</small></td>
      <td><span class="mono">${escapeHtml(result.check)}</span></td>
      <td>${result.latency_ms == null ? '<span class="muted">—</span>' : `${result.latency_ms} ms`}</td>
      <td><span class="checked-time">${state.checkedAt ? escapeHtml(new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(state.checkedAt)) : "Demo baseline"}</span></td>
      <td>${escapeHtml(result.detail)}</td>
    </tr>`).join("");
  elements.ticket.textContent = buildTicketNote(scenario, state.payload);
  renderOutput();
}

function getOutput() {
  if (state.output === "json") return { name: "network-triage.json", type: "application/json", content: JSON.stringify(state.payload, null, 2) };
  if (state.output === "adapter") return { name: "local-adapter-evidence.txt", type: "text/plain", content: `${state.payload.local_info.command}\nStatus: ${state.payload.local_info.status}\n\n${state.payload.local_info.output}\n` };
  return { name: "network-triage.md", type: "text/markdown", content: renderMarkdown(state.payload) };
}

function renderOutput() {
  const output = getOutput();
  elements.report.textContent = output.content;
  elements.download.textContent = `Download ${state.output === "markdown" ? "Markdown" : state.output === "json" ? "JSON" : "adapter evidence"}`;
}

elements.scenario.addEventListener("change", () => {
  state.key = elements.scenario.value;
  state.checkedAt = null;
  state.acknowledged = false;
  elements.impact.textContent = SCENARIOS[state.key].userImpact;
  elements.status.textContent = "Ticket selected. Run triage to refresh the evidence.";
});

elements.run.addEventListener("click", () => {
  elements.run.disabled = true;
  elements.run.classList.add("is-running");
  elements.status.textContent = "Collecting local adapter, gateway, DNS, ping, and TCP evidence…";
  window.setTimeout(() => {
    state.checkedAt = new Date();
    state.acknowledged = false;
    render();
    elements.run.disabled = false;
    elements.run.classList.remove("is-running");
    elements.status.textContent = `Triage complete: ${state.payload.summary.check_count} checks, ${state.payload.summary.failed_checks} failed, overall status ${state.payload.summary.status}.`;
  }, 650);
});

$("#ack-alert").addEventListener("click", () => {
  state.acknowledged = true;
  render();
  elements.status.textContent = "Simulated alert acknowledged by Tier 1; evidence remains available for escalation.";
});

document.querySelectorAll("[data-output]").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.output = tab.dataset.output;
    document.querySelectorAll("[data-output]").forEach((item) => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-selected", active);
    });
    renderOutput();
  });
});

$("#copy-ticket").addEventListener("click", async (event) => {
  try {
    await navigator.clipboard.writeText(elements.ticket.textContent);
    event.currentTarget.textContent = "Copied";
  } catch {
    event.currentTarget.textContent = "Select note to copy";
  }
  window.setTimeout(() => { event.currentTarget.textContent = "Copy ticket note"; }, 1600);
});

elements.download.addEventListener("click", () => {
  const output = getOutput();
  const url = URL.createObjectURL(new Blob([output.content], { type: output.type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = output.name;
  anchor.click();
  URL.revokeObjectURL(url);
});

render();
