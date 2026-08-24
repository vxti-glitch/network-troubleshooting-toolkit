from __future__ import annotations

import json
import socket
import tempfile
import unittest
from pathlib import Path

from src.net_triage import (
    CommandResult,
    Target,
    build_payload,
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
        self.assertIn("DNS lookup failed", result.detail)

    def test_tcp_check_uses_connector(self) -> None:
        def connector(address: tuple[str, int], timeout: float) -> FakeSocket:
            self.assertEqual(address, ("app.contoso.com", 443))
            return FakeSocket()

        result = tcp_check(Target("App", "app.contoso.com"), 443, timeout=1, connector=connector)

        self.assertEqual(result.status, "pass")
        self.assertEqual(result.check, "tcp/443")

    def test_ping_check_uses_runner(self) -> None:
        def runner(command: list[str], timeout: float) -> CommandResult:
            self.assertIn("localhost", command)
            return CommandResult(0, "Reply from 127.0.0.1\nPackets: Sent = 2, Received = 2", "")

        result = ping_check(Target("Loopback", "localhost"), timeout=1, runner=runner)

        self.assertEqual(result.status, "pass")

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


if __name__ == "__main__":
    unittest.main()
