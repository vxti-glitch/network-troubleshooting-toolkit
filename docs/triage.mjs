export function summarizeStatus(results) {
  if (!results.length) return "unknown";
  const failures = results.filter((result) => result.status === "fail");
  if (!failures.length) return "healthy";
  const nonIcmpFailures = failures.filter((result) => result.check !== "icmp/echo" && result.check !== "ping");
  if (failures.length === results.length && nonIcmpFailures.length) return "down";
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
    "| Target | Host | Check | Status | Command elapsed ms | Loss % | RTT avg ms | Detail |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  payload.results.forEach((result) => {
    const elapsed = result.command_elapsed_ms == null ? "" : result.command_elapsed_ms;
    const loss = result.packet_loss_percent == null ? "" : result.packet_loss_percent;
    const rtt = result.rtt_avg_ms == null ? "" : result.rtt_avg_ms;
    lines.push(`| ${result.name} | ${result.target} | ${result.check} | ${result.status} | ${elapsed} | ${loss} | ${rtt} | ${result.detail} |`);
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
    "- A system resolver result does not identify the responding DNS server unless a resolver is queried explicitly.",
    "- Command elapsed time is not ICMP round-trip time.",
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
      { name: "Local Gateway", target: "192.168.1.1", check: "icmp/echo", status: "pass", detail: "2 replies received; 0% packet loss.", command_elapsed_ms: 3.8 },
      { name: "Microsoft Login", target: "login.microsoftonline.com", check: "dns/system", status: "pass", detail: "20.190.157.13, 20.190.157.15", command_elapsed_ms: 28.4 },
      { name: "Microsoft Login", target: "login.microsoftonline.com", check: "tcp/443", status: "pass", detail: "TCP port 443 accepted a connection.", command_elapsed_ms: 41.7 },
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
      { name: "Internal HR Portal", host: "hr.corp.example.test", dns: true, ping: false, ports: [443] },
      { name: "Public DNS", host: "1.1.1.1", dns: false, ping: true, ports: [53] },
    ],
    results: [
      { name: "Local Gateway", target: "192.168.1.1", check: "icmp/echo", status: "pass", detail: "2 replies received; 0% packet loss.", command_elapsed_ms: 4.1 },
      { name: "Internal HR Portal", target: "hr.corp.example.test", check: "dns/system", status: "fail", detail: "DNS lookup failed: name or service not known.", command_elapsed_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "icmp/echo", status: "pass", detail: "2 replies received; 0% packet loss.", command_elapsed_ms: 16.8 },
      { name: "Public DNS", target: "1.1.1.1", check: "tcp/53", status: "pass", detail: "TCP/53 reachability succeeded; this was not a DNS query and did not test UDP/53.", command_elapsed_ms: 18.2 },
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
      { name: "Support Portal", host: "support.example.test", dns: true, ping: true, ports: [443] },
    ],
    results: [
      { name: "Local Gateway", target: "10.0.0.1", check: "icmp/echo", status: "pass", detail: "2 replies received; 0% packet loss.", command_elapsed_ms: 2.6 },
      { name: "Support Portal", target: "support.example.test", check: "dns/system", status: "pass", detail: "203.0.113.42", command_elapsed_ms: 31.5 },
      { name: "Support Portal", target: "support.example.test", check: "icmp/echo", status: "fail", detail: "Request timed out.", command_elapsed_ms: 2014.0 },
      { name: "Support Portal", target: "support.example.test", check: "tcp/443", status: "fail", detail: "Connection timed out after 3 seconds.", command_elapsed_ms: null },
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
      { name: "Local Gateway", target: "192.168.1.1", check: "icmp/echo", status: "fail", detail: "Destination host unreachable.", command_elapsed_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "icmp/echo", status: "fail", detail: "Transmit failed: general failure.", command_elapsed_ms: null },
      { name: "Public DNS", target: "1.1.1.1", check: "tcp/53", status: "fail", detail: "Network is unreachable.", command_elapsed_ms: null },
    ],
    localInfo: { status: "fail", command: "ipconfig /all", output: "Adapter: Wi-Fi\nIPv4: 169.254.84.19\nGateway: none\nDHCP Enabled: yes\nMedia State: connected" },
  },
  gateway: {
    label: "Incorrect default gateway",
    category: "Routing",
    userImpact: "A wired lab device reaches a same-subnet printer but no remote services.",
    scope: "One manually configured endpoint; neighboring DHCP devices work.",
    assessment: "Same-subnet reachability succeeds, but the configured default gateway is outside the expected subnet and remote TCP checks fail. The evidence isolates local route configuration; it does not blame the remote service.",
    nextAction: "Restore the approved DHCP/static configuration, then verify the default route and original remote service.",
    owner: "the endpoint or network configuration owner",
    path: { device: "pass", gateway: "fail", dns: "unknown", service: "fail" },
    targets: [{ name: "Local Printer", host: "192.0.2.20", dns: false, ping: true, ports: [] }, { name: "Remote Portal", host: "portal.example.test", dns: true, ping: false, ports: [443] }],
    results: [{ name: "Local Printer", target: "192.0.2.20", check: "icmp/echo", status: "pass", detail: "Same-subnet host replied; 0% loss.", command_elapsed_ms: 810, packet_loss_percent: 0, rtt_avg_ms: 1 }, { name: "Remote Portal", target: "portal.example.test", check: "dns/system", status: "fail", detail: "No resolver could be reached through the incorrect route.", command_elapsed_ms: 2004 }, { name: "Remote Portal", target: "portal.example.test", check: "tcp/443", status: "fail", detail: "Network is unreachable.", command_elapsed_ms: 8 }],
    localInfo: { status: "fail", command: "Get-NetIPConfiguration; Get-NetRoute -DestinationPrefix 0.0.0.0/0", output: "IPv4: 192.0.2.50/24\nDefault gateway: 198.51.100.1 [unexpected]\nExpected lab gateway: 192.0.2.1\nSource: synthetic evidence" },
  },
  loss: {
    label: "Intermittent packet loss and latency",
    category: "Performance",
    userImpact: "Remote calls freeze for several seconds while ordinary browsing usually works.",
    scope: "One Wi-Fi device; wired comparison is stable.",
    assessment: "Repeated samples show loss and elevated RTT beginning at the local gateway on Wi-Fi. A single silent traceroute hop would not prove this; the wired comparison and repeated first-hop loss strengthen the local wireless hypothesis.",
    nextAction: "Record signal and WLAN report evidence, compare near the access point, and escalate recurring RF/AP or adapter-driver findings.",
    owner: "the wireless or endpoint support team",
    path: { device: "pass", gateway: "fail", dns: "pass", service: "pass" },
    targets: [{ name: "Local Gateway", host: "192.0.2.1", dns: false, ping: true, ports: [] }, { name: "Voice Service", host: "voice.example.test", dns: true, ping: true, ports: [443] }],
    results: [{ name: "Local Gateway", target: "192.0.2.1", check: "icmp/echo", status: "fail", detail: "20 samples; 25% packet loss.", command_elapsed_ms: 20100, packet_loss_percent: 25, rtt_avg_ms: 84 }, { name: "Voice Service", target: "voice.example.test", check: "dns/system", status: "pass", detail: "System resolver returned 203.0.113.24.", command_elapsed_ms: 30 }, { name: "Voice Service", target: "voice.example.test", check: "tcp/443", status: "pass", detail: "TCP 443 accepted a connection during this sample.", command_elapsed_ms: 91 }],
    localInfo: { status: "fail", command: "netsh wlan show interfaces; pathping -n 203.0.113.24", output: "Signal: 38%\nRadio: 5 GHz\nFirst-hop loss: 25%\nWired comparison: 0% loss\nSource: synthetic evidence" },
  },
  firewall: {
    label: "Local firewall blocks one port",
    category: "Firewall",
    userImpact: "A lab application cannot reach its service while HTTPS works.",
    scope: "One managed endpoint; the same target/port works from a known-good device.",
    assessment: "DNS and HTTPS succeed, but the required TCP 8443 path fails only on one endpoint. Local firewall/profile evidence is the next boundary; no rule is changed by this demo.",
    nextAction: "Collect the active firewall profile and matching authorized rule evidence, then route a rule request to the security/network owner.",
    owner: "the endpoint security team",
    path: { device: "pass", gateway: "pass", dns: "pass", service: "fail" },
    targets: [{ name: "Lab Service", host: "app.example.test", dns: true, ping: false, ports: [443, 8443] }],
    results: [{ name: "Lab Service", target: "app.example.test", check: "dns/system", status: "pass", detail: "System resolver returned 203.0.113.30.", command_elapsed_ms: 21 }, { name: "Lab Service", target: "app.example.test", check: "tcp/443", status: "pass", detail: "TCP 443 accepted a connection.", command_elapsed_ms: 36 }, { name: "Lab Service", target: "app.example.test", check: "tcp/8443", status: "fail", detail: "Connection blocked on this endpoint; known-good device succeeded.", command_elapsed_ms: 3002 }],
    localInfo: { status: "fail", command: "Get-NetConnectionProfile; Get-NetFirewallProfile", output: "Active profile: DomainAuthenticated\nFirewall: Enabled\nNo rule changes performed\nSource: synthetic evidence" },
  },
  duplicate: {
    label: "Duplicate IPv4 address symptoms",
    category: "Addressing",
    userImpact: "Connectivity alternates between working and failing after a new lab device joins.",
    scope: "Two synthetic devices report the same IPv4 address.",
    assessment: "Repeated ARP observations map one IP to changing MAC addresses and both endpoints report conflict symptoms. This supports a duplicate-address hypothesis; it does not authorize scanning or changing another device.",
    nextAction: "Disconnect the newly introduced lab device if authorized, preserve DHCP/static assignment evidence, and escalate address ownership.",
    owner: "the DHCP or network operations team",
    path: { device: "fail", gateway: "degraded", dns: "pass", service: "degraded" },
    targets: [{ name: "Gateway", host: "192.0.2.1", dns: false, ping: true, ports: [] }, { name: "Portal", host: "portal.example.test", dns: true, ping: false, ports: [443] }],
    results: [{ name: "Gateway", target: "192.0.2.1", check: "icmp/echo", status: "fail", detail: "Replies intermittent; 50% packet loss.", command_elapsed_ms: 2100, packet_loss_percent: 50, rtt_avg_ms: 3 }, { name: "Portal", target: "portal.example.test", check: "dns/system", status: "pass", detail: "System resolver returned 203.0.113.40.", command_elapsed_ms: 25 }, { name: "Portal", target: "portal.example.test", check: "tcp/443", status: "fail", detail: "Intermittent connection failure.", command_elapsed_ms: 3004 }],
    localInfo: { status: "fail", command: "arp -a", output: "192.0.2.55 changed from 00-11-22-33-44-55 to 00-aa-bb-cc-dd-ee\nSynthetic lab evidence; no active scan performed" },
  },
  wifi: {
    label: "Weak Wi-Fi signal and roaming",
    category: "Wireless",
    userImpact: "A user disconnects while moving between two lab access points.",
    scope: "One device and one location path; nearby stationary devices are stable.",
    assessment: "WLAN history aligns disconnects with low signal and roaming. This evidence narrows the issue to RF coverage, roaming policy, or adapter behavior rather than DNS.",
    nextAction: "Compare near each approved access point, capture the Windows WLAN report, and escalate coverage/driver evidence.",
    owner: "the wireless team",
    path: { device: "degraded", gateway: "degraded", dns: "pass", service: "pass" },
    targets: [{ name: "Gateway", host: "192.0.2.1", dns: false, ping: true, ports: [] }, { name: "Portal", host: "portal.example.test", dns: true, ping: false, ports: [443] }],
    results: [{ name: "Gateway", target: "192.0.2.1", check: "icmp/echo", status: "fail", detail: "10% loss during roaming sample.", command_elapsed_ms: 10100, packet_loss_percent: 10, rtt_avg_ms: 42 }, { name: "Portal", target: "portal.example.test", check: "dns/system", status: "pass", detail: "System resolver returned 203.0.113.40.", command_elapsed_ms: 22 }, { name: "Portal", target: "portal.example.test", check: "tcp/443", status: "pass", detail: "TCP 443 succeeded after reconnection.", command_elapsed_ms: 50 }],
    localInfo: { status: "fail", command: "netsh wlan show interfaces; netsh wlan show wlanreport", output: "Signal before roam: 31%\nDisconnect reason: network disconnected by driver\nWLAN report path recorded\nSource: synthetic evidence" },
  },
  route: {
    label: "VPN route missing for internal subnet",
    category: "VPN / Routing",
    userImpact: "VPN authentication succeeds, but one internal subnet is unreachable.",
    scope: "Internal service in 198.51.100.0/24 only; other VPN resources work.",
    assessment: "Internal DNS resolves and another VPN subnet is reachable, but no route exists for the affected documentation subnet. The evidence supports a VPN route/policy handoff.",
    nextAction: "Attach the sanitized route table, VPN adapter, affected prefix, and timestamp; do not add a persistent route locally.",
    owner: "the VPN/network team",
    path: { device: "pass", gateway: "pass", dns: "pass", service: "fail" },
    targets: [{ name: "Internal Files", host: "files.example.test", dns: true, ping: false, ports: [445] }],
    results: [{ name: "Internal Files", target: "files.example.test", check: "dns/explicit-vpn", status: "pass", detail: "VPN resolver returned 198.51.100.25.", command_elapsed_ms: 35 }, { name: "Internal Files", target: "files.example.test", check: "tcp/445", status: "fail", detail: "No route to the documented internal prefix.", command_elapsed_ms: 12 }],
    localInfo: { status: "fail", command: "Get-NetRoute; Get-NetIPConfiguration", output: "VPN adapter: Connected\nRoute for 203.0.113.0/24: present\nRoute for 198.51.100.0/24: absent\nSource: synthetic evidence" },
  },
  adapter: {
    label: "Adapter disabled or driver faulted",
    category: "Endpoint",
    userImpact: "A lab laptop has no Wi-Fi networks after a driver update.",
    scope: "One endpoint; other devices see the wireless network.",
    assessment: "The Wi-Fi adapter is present but reports a Device Manager error and disconnected state. No network-layer test can succeed until the local adapter is healthy.",
    nextAction: "Record hardware ID, driver/version and error code; use only the approved rollback/update path or escalate to endpoint/OEM support.",
    owner: "the endpoint support team",
    path: { device: "fail", gateway: "unknown", dns: "unknown", service: "unknown" },
    targets: [{ name: "Gateway", host: "192.0.2.1", dns: false, ping: true, ports: [] }],
    results: [{ name: "Gateway", target: "192.0.2.1", check: "icmp/echo", status: "fail", detail: "Transmit failed because no connected interface was available.", command_elapsed_ms: 9 }],
    localInfo: { status: "fail", command: "Get-NetAdapter; Get-PnpDevice -Class Net", output: "Wi-Fi: Disconnected\nPnP status: Error\nDevice Manager code: synthetic 31\nDriver changed: 2026-08-29" },
  },
  proxy: {
    label: "Proxy or captive portal interrupts access",
    category: "HTTP path",
    userImpact: "DNS and TCP 443 work, but the browser redirects to an unexpected sign-in page.",
    scope: "One guest-network session; managed-network comparison works.",
    assessment: "Lower network layers succeed. The redirect and certificate/HTTP context point to a captive portal or proxy boundary, not a DNS or raw-port failure.",
    nextAction: "Verify the approved guest portal or proxy configuration; never bypass a certificate warning or enter credentials into an unverified page.",
    owner: "the network/security team",
    path: { device: "pass", gateway: "pass", dns: "pass", service: "degraded" },
    targets: [{ name: "Portal", host: "portal.example.test", dns: true, ping: false, ports: [443] }],
    results: [{ name: "Portal", target: "portal.example.test", check: "dns/system", status: "pass", detail: "System resolver returned 203.0.113.40.", command_elapsed_ms: 24 }, { name: "Portal", target: "portal.example.test", check: "tcp/443", status: "pass", detail: "TCP 443 accepted a connection; this does not validate TLS or HTTP content.", command_elapsed_ms: 43 }, { name: "Portal", target: "portal.example.test", check: "http/redirect", status: "fail", detail: "Synthetic redirect to the approved guest portal required review.", command_elapsed_ms: 90 }],
    localInfo: { status: "pass", command: "netsh winhttp show proxy; ipconfig /all", output: "WinHTTP proxy: Direct\nNetwork category: Public guest lab\nCertificate bypass: not attempted\nSource: synthetic evidence" },
  },
});
