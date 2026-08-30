"""Network troubleshooting CLI for help desk triage."""

from __future__ import annotations

import argparse
import json
import platform
import re
import socket
import subprocess
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Iterable


@dataclass(frozen=True)
class Target:
    name: str
    host: str
    dns: bool = True
    ping: bool = True
    ports: tuple[int, ...] = tuple()


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


@dataclass(frozen=True)
class CheckResult:
    name: str
    target: str
    check: str
    status: str
    detail: str
    command_elapsed_ms: float | None = None
    packet_loss_percent: float | None = None
    rtt_min_ms: float | None = None
    rtt_avg_ms: float | None = None
    rtt_max_ms: float | None = None
    evidence_state: str = "observed"
    limitation: str = ""


def load_targets(config_path: Path) -> list[Target]:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    raw_targets = data.get("targets") if isinstance(data, dict) else data
    if not isinstance(raw_targets, list) or not raw_targets:
        raise ValueError("Config must contain a non-empty 'targets' list.")

    targets: list[Target] = []
    for index, item in enumerate(raw_targets, start=1):
        if not isinstance(item, dict):
            raise ValueError(f"Target {index} must be an object.")
        name = str(item.get("name") or item.get("host") or "").strip()
        host = str(item.get("host") or "").strip()
        if not host:
            raise ValueError(f"Target {index} is missing host.")
        ports = tuple(int(port) for port in item.get("ports", []))
        for port in ports:
            if port < 1 or port > 65535:
                raise ValueError(f"Target {name} has invalid TCP port {port}.")
        targets.append(
            Target(
                name=name or host,
                host=host,
                dns=bool(item.get("dns", True)),
                ping=bool(item.get("ping", True)),
                ports=ports,
            )
        )
    return targets


def run_command(command: list[str], timeout: float) -> CommandResult:
    completed = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    return CommandResult(completed.returncode, completed.stdout, completed.stderr)


def dns_check(
    target: Target,
    *,
    resolver: Callable[..., Any] = socket.getaddrinfo,
) -> CheckResult:
    start = time.perf_counter()
    try:
        answers = resolver(target.host, None)
    except socket.gaierror as exc:
        return CheckResult(target.name, target.host, "dns/system", "fail", f"System resolver path failed: {exc}", limitation="This does not identify which DNS server failed or prove split-DNS root cause.")

    elapsed_ms = (time.perf_counter() - start) * 1000
    addresses = sorted({answer[4][0] for answer in answers if answer and answer[4]})
    detail = ", ".join(addresses[:5]) if addresses else "No addresses returned."
    status = "pass" if addresses else "fail"
    return CheckResult(target.name, target.host, "dns/system", status, f"System resolver path returned: {detail}", round(elapsed_ms, 2), limitation="Uses the operating system resolution path and cache; it does not identify the responding resolver.")


def tcp_check(
    target: Target,
    port: int,
    *,
    timeout: float,
    connector: Callable[..., Any] = socket.create_connection,
) -> CheckResult:
    start = time.perf_counter()
    try:
        connection = connector((target.host, port), timeout=timeout)
        if hasattr(connection, "close"):
            connection.close()
    except OSError as exc:
        return CheckResult(target.name, target.host, f"tcp/{port}", "fail", f"Connection failed: {exc}")

    elapsed_ms = (time.perf_counter() - start) * 1000
    return CheckResult(
        target.name,
        target.host,
        f"tcp/{port}",
        "pass",
        f"TCP port {port} accepted a connection.",
        round(elapsed_ms, 2),
        limitation="Proves only that this target and TCP port accepted a connection at the test time; it does not prove application or TLS health.",
    )


def ping_check(
    target: Target,
    *,
    timeout: float,
    runner: Callable[[list[str], float], CommandResult] = run_command,
) -> CheckResult:
    count_flag = "-n" if platform.system().lower() == "windows" else "-c"
    timeout_flag = "-w" if platform.system().lower() == "windows" else "-W"
    timeout_value = str(max(1, int(timeout * 1000))) if count_flag == "-n" else str(max(1, int(timeout)))
    command = ["ping", count_flag, "2", timeout_flag, timeout_value, target.host]
    start = time.perf_counter()
    try:
        result = runner(command, timeout + 2)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return CheckResult(target.name, target.host, "ping", "fail", f"Ping command failed: {exc}")

    elapsed_ms = (time.perf_counter() - start) * 1000
    output = (result.stdout or result.stderr).strip().splitlines()
    detail = output[-1].strip() if output else "No ping output returned."
    status = "pass" if result.returncode == 0 else "fail"
    text = "\n".join(output)
    loss_match = re.search(r"\((\d+(?:\.\d+)?)%\s*loss\)", text, re.IGNORECASE)
    if not loss_match:
        loss_match = re.search(r"(\d+(?:\.\d+)?)%\s*packet loss", text, re.IGNORECASE)
    rtt_match = re.search(r"Minimum = (\d+)ms, Maximum = (\d+)ms, Average = (\d+)ms", text, re.IGNORECASE)
    if not rtt_match:
        rtt_match = re.search(r"=\s*([\d.]+)/([\d.]+)/([\d.]+)/", text)
    loss = float(loss_match.group(1)) if loss_match else None
    rtt_min = float(rtt_match.group(1)) if rtt_match else None
    rtt_max = float(rtt_match.group(2)) if rtt_match else None
    rtt_avg = float(rtt_match.group(3)) if rtt_match else None
    return CheckResult(
        target.name, target.host, "icmp/echo", status, detail, round(elapsed_ms, 2),
        loss, rtt_min, rtt_avg, rtt_max,
        limitation="ICMP can be filtered or deprioritized; failure alone does not prove the application path is down.",
    )


def _parse_local_facts(output: str) -> dict[str, Any]:
    ipv4 = re.findall(r"(?:IPv4 Address[^:]*|inet)\s*[: ]\s*(\d+\.\d+\.\d+\.\d+)", output, re.IGNORECASE)
    gateways = re.findall(r"Default Gateway[^:]*:\s*(\d+\.\d+\.\d+\.\d+)", output, re.IGNORECASE)
    dns = re.findall(r"DNS Servers[^:]*:\s*(\d+\.\d+\.\d+\.\d+)", output, re.IGNORECASE)
    apipa = any(address.startswith("169.254.") for address in ipv4)
    return {
        "ipv4_addresses": ipv4,
        "default_gateways": gateways,
        "dns_servers": dns,
        "apipa_detected": apipa,
        "interpretation": "IPv4 link-local/APIPA detected; expected DHCP configuration was not observed." if apipa else "No IPv4 link-local/APIPA address detected in parsed output.",
    }


def collect_local_info(
    *,
    timeout: float,
    runner: Callable[[list[str], float], CommandResult] = run_command,
) -> dict[str, Any]:
    if platform.system().lower() == "windows":
        command = ["ipconfig", "/all"]
    else:
        command = ["ip", "addr"]
    try:
        result = runner(command, timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"status": "fail", "command": " ".join(command), "output": str(exc)}
    output = result.stdout.strip() or result.stderr.strip()
    return {
        "status": "pass" if result.returncode == 0 else "fail",
        "command": " ".join(command),
        "output": output,
        "facts": _parse_local_facts(output),
    }


def run_triage(
    targets: Iterable[Target],
    *,
    timeout: float = 3,
    skip_ping: bool = False,
    resolver: Callable[..., Any] = socket.getaddrinfo,
    connector: Callable[..., Any] = socket.create_connection,
    runner: Callable[[list[str], float], CommandResult] = run_command,
) -> list[CheckResult]:
    results: list[CheckResult] = []
    for target in targets:
        if target.dns:
            results.append(dns_check(target, resolver=resolver))
        if target.ping and not skip_ping:
            results.append(ping_check(target, timeout=timeout, runner=runner))
        for port in target.ports:
            results.append(tcp_check(target, port, timeout=timeout, connector=connector))
    return results


def summarize_status(results: Iterable[CheckResult]) -> str:
    result_list = list(results)
    if not result_list:
        return "unknown"
    failures = [result for result in result_list if result.status == "fail"]
    if not failures:
        return "healthy"
    non_icmp_failures = [result for result in failures if result.check != "icmp/echo"]
    if len(failures) == len(result_list) and non_icmp_failures:
        return "down"
    return "degraded"


def build_payload(
    targets: list[Target],
    results: list[CheckResult],
    local_info: dict[str, str] | None = None,
) -> dict[str, Any]:
    return {
        "summary": {
            "target_count": len(targets),
            "check_count": len(results),
            "status": summarize_status(results),
            "failed_checks": sum(1 for result in results if result.status == "fail"),
        },
        "targets": [asdict(target) for target in targets],
        "results": [asdict(result) for result in results],
        "local_info": local_info,
    }


def render_markdown(payload: dict[str, Any]) -> str:
    summary = payload["summary"]
    lines = [
        "# Network Triage Report",
        "",
        "## Summary",
        "",
        f"- Targets checked: {summary['target_count']}",
        f"- Checks run: {summary['check_count']}",
        f"- Failed checks: {summary['failed_checks']}",
        f"- Overall status: {summary['status']}",
        "",
        "## Check Results",
        "",
        "| Target | Host | Check | Status | Command elapsed ms | Loss % | RTT avg ms | Detail |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]

    for result in payload["results"]:
        elapsed = "" if result["command_elapsed_ms"] is None else result["command_elapsed_ms"]
        loss = "" if result["packet_loss_percent"] is None else result["packet_loss_percent"]
        rtt = "" if result["rtt_avg_ms"] is None else result["rtt_avg_ms"]
        lines.append(
            f"| {result['name']} | {result['target']} | {result['check']} | "
            f"{result['status']} | {elapsed} | {loss} | {rtt} | {result['detail']} |"
        )

    local_info = payload.get("local_info")
    if local_info:
        output = local_info.get("output", "")
        excerpt = "\n".join(output.splitlines()[:40])
        lines.extend(
            [
                "",
                "## Local Network Info",
                "",
                f"- Command: `{local_info.get('command', '')}`",
                f"- Status: {local_info.get('status', '')}",
                "",
                "```text",
                excerpt,
                "```",
            ]
        )

    lines.extend(
        [
            "",
            "## Escalation Guidance",
            "",
            "- DNS failures usually point to resolver, VPN, or split-horizon DNS issues.",
            "- TCP failures with successful DNS can point to firewall, proxy, routing, or service outages.",
            "- Ping failures alone are not always meaningful because many services block ICMP.",
            "- System resolver results do not identify a DNS server unless that resolver is queried explicitly.",
            "- Command elapsed time is not the same measurement as ICMP round-trip time.",
            "- Attach this report to the ticket with user location, device name, and timestamp.",
            "",
        ]
    )
    return "\n".join(lines)


def write_outputs(payload: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "network-triage.json").write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    (output_dir / "network-triage.md").write_text(
        render_markdown(payload),
        encoding="utf-8",
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run network troubleshooting checks and export a report.")
    parser.add_argument("--config", required=True, type=Path, help="Path to targets JSON config.")
    parser.add_argument("--out", default=Path("reports"), type=Path, help="Output directory.")
    parser.add_argument("--timeout", default=3.0, type=float, help="Per-check timeout in seconds.")
    parser.add_argument("--skip-ping", action="store_true", help="Skip ping checks even if targets request them.")
    parser.add_argument("--include-local-info", action="store_true", help="Capture local adapter/IP information.")
    parser.add_argument("--fail-on-down", action="store_true", help="Exit with code 1 when every check fails.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    targets = load_targets(args.config)
    results = run_triage(targets, timeout=args.timeout, skip_ping=args.skip_ping)
    local_info = collect_local_info(timeout=args.timeout) if args.include_local_info else None
    payload = build_payload(targets, results, local_info)
    write_outputs(payload, args.out)
    print(f"Ran {len(results)} checks against {len(targets)} targets.")
    print(f"Overall status: {payload['summary']['status']}")
    print(f"Output written to {args.out.resolve()}")
    return 1 if args.fail_on_down and payload["summary"]["status"] == "down" else 0


if __name__ == "__main__":
    raise SystemExit(main())
