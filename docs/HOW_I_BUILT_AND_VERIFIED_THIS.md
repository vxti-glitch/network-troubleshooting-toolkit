# How I built and verified this

I built the toolkit around a simple rule: DNS, ICMP, and TCP answer different questions, so the report should not collapse them into one “network up/down” result.

The DNS check uses Python's system resolver. It can show that the operating-system resolution path returned an address or failed, but it can use cache and cannot identify which configured DNS server answered. An explicit resolver query would require a separate tool and target.

ICMP output varies by operating system, so I parse the Windows and common Unix packet-loss and RTT summaries while retaining the raw command result. ICMP can be filtered or deprioritized; a failed ping alone does not establish that an HTTPS service is down. TCP success means only that a connection to that host and port was accepted at that time. It does not prove TLS, authentication, or application health.

The browser demo cannot issue raw ICMP, open arbitrary TCP sockets, inspect a real adapter, or reproduce the Python process runner. Its twelve scenarios are synthetic examples that reuse the same summary and report concepts. They are not real network tests.

## What I tested

- Target-schema and port validation.
- DNS success and failure through a controlled resolver stub.
- TCP connection success through a controlled connector stub.
- Command timeout and partial local-adapter output.
- DNS failure while a TCP connection by documentation-range IP succeeds.
- ICMP failure while TCP succeeds, which remains degraded rather than “down.”
- Missing gateway and DNS fields without inventing values.
- The twelve-scenario browser summary and report logic.

I also ran the CLI locally against the repository target configuration. That run exercised the current machine and network at one point in time only; its identifying local output was not committed.

## Tradeoffs

1. The system resolver is portable and matches many user experiences, but it hides the responding DNS server and cache path.
2. A compact status is useful for triage, but I keep the individual observations because “degraded” is not a root cause.
3. Raw local adapter output helps escalation, but it can expose usernames, hostnames, IPs, internal domains, adapters, and VPN data. Public examples therefore use synthetic values and real output requires manual redaction.
