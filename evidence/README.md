# Controlled DNS-failure lab evidence checklist

No result or screenshot is stored here yet. A future genuine lab must include every item below and remain clearly separate from browser simulation or fixture tests.

- **Date:** UTC date/time and evidence-capture window.
- **Authorization:** lab owner and explicit permission to change DNS behavior and capture packets.
- **Topology:** sanitized client, resolver, gateway, affected service, address ranges, and where the failure is introduced.
- **Baseline commands:** adapter configuration, system lookup, explicit approved-resolver lookup, TCP-by-name, and TCP-by-documentation-range-IP checks.
- **Failure commands:** the same commands after the controlled DNS fault, with command, timestamp, exit state, and relevant output.
- **Short packet capture:** authorized interface, narrow DNS filter, start/stop time, packet count, and protected storage location. Do not capture unrelated payloads.
- **Before/after result:** observable difference, including whether TCP by IP stayed reachable while name resolution failed.
- **Hypothesis and root cause:** competing hypotheses, evidence that rejected each one, and the injected fault actually found.
- **Correction and cleanup:** restoration command or configuration, temporary files removed, capture stopped, and original settings restored.
- **Validation:** repeated system and explicit-resolver checks plus the original user-visible task.
- **Redaction:** remove or replace usernames, hostnames, internal domains, SSIDs/BSSIDs, public IPs, MAC addresses, VPN identifiers, tokens, unrelated neighbors, and packet payloads.
- **Limitations:** what was not tested, what is specific to the lab topology, and why the result does not prove production behavior.
