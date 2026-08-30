import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPayload,
  buildTicketNote,
  renderMarkdown,
  SCENARIOS,
  summarizeStatus,
} from "../docs/triage.mjs";

test("status summary matches the Python CLI rules", () => {
  assert.equal(summarizeStatus([]), "unknown");
  assert.equal(summarizeStatus([{ status: "pass" }]), "healthy");
  assert.equal(summarizeStatus([{ status: "pass" }, { status: "fail" }]), "degraded");
  assert.equal(summarizeStatus([{ status: "fail", check: "icmp/echo" }]), "degraded");
  assert.equal(summarizeStatus([{ status: "fail", check: "tcp/443" }]), "down");
});
test("healthy SaaS scenario has no failed checks", () => {
  const scenario = SCENARIOS.healthy;
  const payload = buildPayload(scenario.targets, scenario.results, scenario.localInfo);
  assert.deepEqual(payload.summary, {
    target_count: 2,
    check_count: 3,
    status: "healthy",
    failed_checks: 0,
  });
});

test("expanded lab publishes twelve distinct troubleshooting scenarios", () => {
  assert.equal(Object.keys(SCENARIOS).length, 12);
  assert.match(SCENARIOS.route.assessment, /no route exists/i);
  assert.match(SCENARIOS.loss.assessment, /single silent traceroute hop/i);
});

test("DNS failure is isolated as degraded rather than fully down", () => {
  const scenario = SCENARIOS.dns;
  const payload = buildPayload(scenario.targets, scenario.results, scenario.localInfo);
  assert.equal(payload.summary.status, "degraded");
  assert.equal(payload.summary.failed_checks, 1);
  assert.match(scenario.assessment, /split-horizon DNS/i);
});

test("local APIPA scenario reports a down path", () => {
  const scenario = SCENARIOS.local;
  const payload = buildPayload(scenario.targets, scenario.results, scenario.localInfo);
  assert.equal(payload.summary.status, "down");
  assert.match(payload.local_info.output, /169\.254\./);
});

test("reports preserve evidence and escalation guidance", () => {
  const scenario = SCENARIOS.blocked;
  const payload = buildPayload(scenario.targets, scenario.results, scenario.localInfo);
  const markdown = renderMarkdown(payload);
  const ticket = buildTicketNote(scenario, payload);
  assert.match(markdown, /TCP failures with successful DNS/);
  assert.match(markdown, /tcp\/443 \| fail/);
  assert.match(markdown, /Command elapsed time is not ICMP/);
  assert.match(ticket, /User impact:/);
  assert.match(ticket, /Escalation: 2 failed checks/);
});

