from __future__ import annotations

import json
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path

from src.net_triage import (
    CommandResult,
    Target,
    build_payload,
    collect_local_info,
    dns_check,
    load_targets,
    ping_check,
    run_triage,
    summarize_status,
    tcp_check,
)


class FakeSocket:
    def close(self) -> None:
        return None


class NetworkTriageTests(unittest.TestCase):
    def test_load_targets_validates_ports(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "targets.json"
            path.write_text(
                json.dumps({"targets": [{"name": "Bad", "host": "example.com", "ports": [70000]}]}),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "invalid TCP port"):
                load_targets(path)

    def test_dns_check_reports_addresses(self) -> None:
        def resolver(host: str, port: object) -> list[tuple[object, object, object, object, tuple[str, int]]]:
            return [(None, None, None, None, ("10.0.0.5", 0))]

        result = dns_check(Target("App", "app.contoso.com"), resolver=resolver)

        self.assertEqual(result.status, "pass")
        self.assertIn("10.0.0.5", result.detail)

    def test_dns_check_reports_failure(self) -> None:
        def resolver(host: str, port: object) -> list[object]:
            raise socket.gaierror("no answer")

        result = dns_check(Target("App", "missing.contoso.com"), resolver=resolver)

        self.assertEqual(result.status, "fail")
        self.assertIn("System resolver path failed", result.detail)
        self.assertIn("does not identify", result.limitation)

    def test_tcp_check_uses_connector(self) -> None:
        def connector(address: tuple[str, int], timeout: float) -> FakeSocket:
            self.assertEqual(address, ("app.contoso.com", 443))
            return FakeSocket()

        result = tcp_check(Target("App", "app.contoso.com"), 443, timeout=1, connector=connector)

        self.assertEqual(result.status, "pass")
        self.assertEqual(result.check, "tcp/443")
        self.assertIn("application", result.limitation)

    def test_ping_check_uses_runner(self) -> None:
        def runner(command: list[str], timeout: float) -> CommandResult:
            self.assertIn("localhost", command)
            return CommandResult(0, "Reply from 127.0.0.1\nPackets: Sent = 2, Received = 2", "")

        result = ping_check(Target("Loopback", "localhost"), timeout=1, runner=runner)

        self.assertEqual(result.status, "pass")
        self.assertEqual(result.check, "icmp/echo")
        self.assertIsNotNone(result.command_elapsed_ms)

    def test_run_triage_and_summary(self) -> None:
        def resolver(host: str, port: object) -> list[tuple[object, object, object, object, tuple[str, int]]]:
            return [(None, None, None, None, ("10.0.0.5", 0))]

        def connector(address: tuple[str, int], timeout: float) -> FakeSocket:
            return FakeSocket()

        def runner(command: list[str], timeout: float) -> CommandResult:
            return CommandResult(0, "ok", "")

        results = run_triage(
            [Target("App", "app.contoso.com", ports=(443,))],
            resolver=resolver,
            connector=connector,
            runner=runner,
        )
        payload = build_payload([Target("App", "app.contoso.com", ports=(443,))], results)

        self.assertEqual(summarize_status(results), "healthy")
        self.assertEqual(payload["summary"]["failed_checks"], 0)

    def test_command_timeout_is_reported_without_crashing(self) -> None:
        def runner(command: list[str], timeout: float) -> CommandResult:
            raise subprocess.TimeoutExpired(command, timeout)

        ping = ping_check(Target("Slow", "192.0.2.1"), timeout=0.1, runner=runner)
        local = collect_local_info(timeout=0.1, runner=runner)

        self.assertEqual(ping.status, "fail")
        self.assertIn("failed", ping.detail.lower())
        self.assertEqual(local["status"], "fail")

    def test_partial_local_output_keeps_known_and_missing_fields_explicit(self) -> None:
        def runner(command: list[str], timeout: float) -> CommandResult:
            return CommandResult(1, "IPv4 Address: 192.0.2.25", "Access denied to remaining adapter fields")

        local = collect_local_info(timeout=1, runner=runner)

        self.assertEqual(local["status"], "fail")
        self.assertEqual(local["facts"]["ipv4_addresses"], ["192.0.2.25"])
        self.assertEqual(local["facts"]["default_gateways"], [])
        self.assertEqual(local["facts"]["dns_servers"], [])

    def test_dns_failure_can_coexist_with_tcp_success_by_ip(self) -> None:
        def resolver(host: str, port: object) -> list[object]:
            raise socket.gaierror("no answer")

        def connector(address: tuple[str, int], timeout: float) -> FakeSocket:
            self.assertEqual(address, ("192.0.2.44", 443))
            return FakeSocket()

        results = [
            dns_check(Target("Named app", "app.example.test"), resolver=resolver),
            tcp_check(Target("App by IP", "192.0.2.44"), 443, timeout=1, connector=connector),
        ]

        self.assertEqual([item.status for item in results], ["fail", "pass"])
        self.assertEqual(summarize_status(results), "degraded")

    def test_icmp_blocked_with_tcp_success_is_degraded_not_down(self) -> None:
        def runner(command: list[str], timeout: float) -> CommandResult:
            return CommandResult(1, "Request timed out.\n100% packet loss", "")

        def connector(address: tuple[str, int], timeout: float) -> FakeSocket:
            return FakeSocket()

        target = Target("HTTPS", "192.0.2.80")
        results = [
            ping_check(target, timeout=1, runner=runner),
            tcp_check(target, 443, timeout=1, connector=connector),
        ]

        self.assertEqual(results[0].status, "fail")
        self.assertEqual(results[1].status, "pass")
        self.assertEqual(summarize_status(results), "degraded")


if __name__ == "__main__":
    unittest.main()
