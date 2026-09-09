# Evidence Index

This index separates implemented tooling from simulated scenarios and real lab work.

## What is currently supported

| Claim | Evidence | Status |
|---|---|---|
| The DNS, ICMP, and TCP triage tool exists | `src/`, CLI examples, automated tests, and documentation | Implemented and tested |
| The browser experience contains troubleshooting scenarios | `docs/`, browser tests, and sample data | Simulated only |
| The project documents a controlled DNS-failure lab design | `evidence/README.md` | Lab plan only |

## What this repository does not prove

- Support for real users or a production network
- Root cause for a real outage
- Management of a company VPN, DHCP server, router, DNS service, or firewall

## Personal evidence records

Add a record only after an authorized lab run. Include the symptom, scope, commands, output, root cause, correction, validation, and redactions. Start with `evidence/README.md`.

| Evidence ID | Scenario | Date | Status | Link |
|---|---|---|---|---|
| None yet | No personal network lab evidence has been committed | N/A | Not started | N/A |

## Interview explanation

The tool helps me practice a structured first-call diagnosis. I start by defining scope, checking name resolution and reachability separately, validating the fix, documenting the result, and escalating when the evidence points outside Tier 1 ownership.
