export function summarizeStatus(results) {
  if (!results.length) return "unknown";
  const failures = results.filter((result) => result.status === "fail");
  if (!failures.length) return "healthy";
  if (failures.length === results.length) return "down";
  return "degraded";
}

export function buildPayload(targets, results, localInfo = null) {
  return {
    summary: {
      target_count: targets.length,
      check_count: results.length,
      status: summarizeStatus(results),
      failed_checks: results.filter((result) => result.status === "fail").length,
    },
    targets,
    results,
    local_info: localInfo,
  };
}

export function renderMarkdown(payload) {
  const summary = payload.summary;
  const lines = [
    "# Network Triage Report",
    "",
    "## Summary",
    "",
    `- Targets checked: ${summary.target_count}`,
    `- Checks run: ${summary.check_count}`,
    `- Failed checks: ${summary.failed_checks}`,
    `- Overall status: ${summary.status}`,
    "",
    "## Check Results",
    "",
    "| Target | Host | Check | Status | Latency ms | Detail |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  payload.results.forEach((result) => {
    const latency = result.latency_ms == null ? "" : result.latency_ms;
    lines.push(`| ${result.name} | ${result.target} | ${result.check} | ${result.status} | ${latency} | ${result.detail} |`);
  });

  if (payload.local_info) {
    lines.push(
      "",
      "## Local Network Info",
      "",
      `- Command: \`${payload.local_info.command}\``,
      `- Status: ${payload.local_info.status}`,
      "",
      "```text",
      payload.local_info.output,
      "```",
    );
  }

  lines.push(
    "",
    "## Escalation Guidance",
    "",
    "- DNS failures usually point to resolver, VPN, or split-horizon DNS issues.",
    "- TCP failures with successful DNS can point to firewall, proxy, routing, or service outages.",
    "- Ping failures alone are not always meaningful because many services block ICMP.",
    "- Attach this report to the ticket with user location, device name, and timestamp.",
    "",
  );
  return lines.join("\n");
}

export function buildTicketNote(scenario, payload) {
  const failed = payload.results.filter((result) => result.status === "fail");
  const checks = payload.results.map((result) => `${result.check} ${result.status.toUpperCase()} (${result.target})`).join("; ");
  return [
    `User impact: ${scenario.userImpact}`,
    `Scope: ${scenario.scope}`,
    `Evidence collected: ${checks}.`,
    `Assessment: ${scenario.assessment}`,
    `Next action: ${scenario.nextAction}`,
    `Escalation: ${failed.length ? `${failed.length} failed check${failed.length === 1 ? "" : "s"}; attach report and route to ${scenario.owner}.` : "No escalation required after user validation."}`,
  ].join("\n");
}

export const SCENARIOS = Object.freeze({
  healthy: {
    label: "Microsoft 365 sign-in restored",
    category: "SaaS access",
    userImpact: "One remote user reported that Microsoft 365 sign-in was unavailable.",
    scope: "Single user; general internet access remained available.",
    assessment: "DNS and TCP 443 both succeed. The service path is healthy, so validate browser state, cached credentials, and the user's sign-in session.",
    nextAction: "Clear the stale browser session, retry in a private window, and confirm the user can sign in before closing the ticket.",
    owner: "the application support queue",
    path: { device: "pass", gateway: "pass", dns: "pass", service: "pass" },
    targets: [
      { name: "Local Gateway", host: "192.168.1.1", dns: false, ping: true, ports: [] },
      { name: "Microsoft Login", host: "login.microsoftonline.com", dns: true, ping: false, ports: [443] },
    ],
    results: [
      { name: "Local Gateway", target: "192.168.1.1", check: "ping", status: "pass", detail: "2 replies received; 0% packet loss.", latency_ms: 3.8 },
      { name: "Microsoft Login", target: "login.microsoftonline.com", check: "dns", status: "pass", detail: "20.190.157.13, 20.190.157.15", latency_ms: 28.4 },
      { name: "Microsoft Login", target: "login.microsoftonline.com", check: "tcp/443", status: "pass", detail: "TCP port 443 accepted a connection.", latency_ms: 41.7 },
    ],
    localInfo: { status: "pass", command: "ipconfig /all", output: "Adapter: Wi-Fi\nIPv4: 192.168.1.105\nGateway: 192.168.1.1\nDNS: 1.1.1.1" },
  },
  dns: {
    label: "VPN name resolution failure",
    category: "DNS / VPN",
    userImpact: "Remote user can browse public sites but cannot open the internal HR portal over VPN.",
    scope: "Internal hostname only; public internet and VPN authentication succeed.",
    assessment: "The gateway and public resolver are reachable, but the internal hostname does not resolve. Evidence points to VPN-provided DNS or split-horizon DNS configuration.",
    nextAction: "Reconnect the VPN, refresh the DNS registration, collect the assigned DNS servers, and escalate the split-DNS evidence if resolution still fails.",
    owner: "the network/VPN team",
    path: { device: "pass", gateway: "pass", dns: "fail", service: "unknown" },
    targets: [
      { name: "Local Gateway", host: "192.168.1.1", dns: false, ping: true, ports: [] },
      { name: "Internal HR Portal", host: "hr.corp.contoso.local", dns: true, ping: false, ports: [443] },
      { name: "Public DNS", host: "1.1.1.1", dns: false, ping: true, ports: [53] },
    ],
    results: [
      { name: "Local Gateway", target: "192.168.1.1", check: "ping", status: "pass", detail: "2 replies received; 0% packet loss.", latency_ms: 4.1 },
      { name: "Internal HR Portal", target: "hr.corp.contoso.local", check: "dns", status: "fail", detail: "DNS lookup failed: name or service not known.", latency_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "ping", status: "pass", detail: "2 replies received; 0% packet loss.", latency_ms: 16.8 },
      { name: "Public DNS", target: "1.1.1.1", check: "tcp/53", status: "pass", detail: "TCP port 53 accepted a connection.", latency_ms: 18.2 },
    ],
    localInfo: { status: "pass", command: "ipconfig /all", output: "Adapter: Contoso VPN\nIPv4: 10.28.14.77\nGateway: On-link\nDNS: 192.168.50.10" },
  },
  blocked: {
    label: "HTTPS path blocked",
    category: "Firewall / proxy",
    userImpact: "Multiple remote users report that the support portal times out while other websites load.",
    scope: "Shared service impact; hostname resolves from more than one user location.",
    assessment: "DNS succeeds but TCP 443 fails. A ping failure is not decisive; the failed application port is the stronger signal for firewall, proxy, routing, or service availability review.",
    nextAction: "Capture timestamp and source network, verify the approved proxy path, and escalate the failed TCP 443 evidence with affected-user scope.",
    owner: "the network or application operations team",
    path: { device: "pass", gateway: "pass", dns: "pass", service: "fail" },
    targets: [
      { name: "Local Gateway", host: "10.0.0.1", dns: false, ping: true, ports: [] },
      { name: "Support Portal", host: "support.contoso.example", dns: true, ping: true, ports: [443] },
    ],
    results: [
      { name: "Local Gateway", target: "10.0.0.1", check: "ping", status: "pass", detail: "2 replies received; 0% packet loss.", latency_ms: 2.6 },
      { name: "Support Portal", target: "support.contoso.example", check: "dns", status: "pass", detail: "203.0.113.42", latency_ms: 31.5 },
      { name: "Support Portal", target: "support.contoso.example", check: "ping", status: "fail", detail: "Request timed out.", latency_ms: 2014.0 },
      { name: "Support Portal", target: "support.contoso.example", check: "tcp/443", status: "fail", detail: "Connection timed out after 3 seconds.", latency_ms: null },
    ],
    localInfo: { status: "pass", command: "ipconfig /all", output: "Adapter: Ethernet\nIPv4: 10.0.0.58\nGateway: 10.0.0.1\nDNS: 10.0.0.10" },
  },
  local: {
    label: "Local adapter lost its address",
    category: "Endpoint connectivity",
    userImpact: "One home-based user cannot open websites, Microsoft 365, or the VPN client.",
    scope: "Single Windows laptop; another device on the same Wi-Fi works normally.",
    assessment: "The laptop has an APIPA address and cannot reach the gateway. The failure is local to DHCP, the Wi-Fi association, or the endpoint adapter rather than the external service.",
    nextAction: "Reconnect Wi-Fi, renew the DHCP lease, verify the adapter driver and service state, then retest the gateway before escalating.",
    owner: "the endpoint support queue",
    path: { device: "fail", gateway: "fail", dns: "unknown", service: "unknown" },
    targets: [
      { name: "Local Gateway", host: "192.168.1.1", dns: false, ping: true, ports: [] },
      { name: "Public DNS", host: "1.1.1.1", dns: false, ping: true, ports: [53] },
    ],
    results: [
      { name: "Local Gateway", target: "192.168.1.1", check: "ping", status: "fail", detail: "Destination host unreachable.", latency_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "ping", status: "fail", detail: "Transmit failed: general failure.", latency_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "tcp/53", status: "fail", detail: "Network is unreachable.", latency_ms: null },
    ],
    localInfo: { status: "fail", command: "ipconfig /all", output: "Adapter: Wi-Fi\nIPv4: 169.254.84.19\nGateway: none\nDHCP Enabled: yes\nMedia State: connected" },
  },
});
