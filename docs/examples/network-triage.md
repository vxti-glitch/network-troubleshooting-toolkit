# Network Triage Report

## Summary

- Targets checked: 3
- Checks run: 4
- Failed checks: 0
- Overall status: healthy

## Check Results

| Target | Host | Check | Status | Latency ms | Detail |
| --- | --- | --- | --- | --- | --- |
| Localhost | localhost | dns | pass | 6.04 | 127.0.0.1, ::1 |
| Microsoft Login | login.microsoftonline.com | dns | pass | 57.58 | 20.190.157.13, 20.190.157.15, 20.190.157.4, 40.126.29.11, 40.126.29.14 |
| Microsoft Login | login.microsoftonline.com | tcp/443 | pass | 52.92 | TCP port 443 accepted a connection. |
| Cloudflare DNS | 1.1.1.1 | tcp/53 | pass | 4.4 | TCP port 53 accepted a connection. |

## Escalation Guidance

- DNS failures usually point to resolver, VPN, or split-horizon DNS issues.
- TCP failures with successful DNS can point to firewall, proxy, routing, or service outages.
- Ping failures alone are not always meaningful because many services block ICMP.
- Attach this report to the ticket with user location, device name, and timestamp.
