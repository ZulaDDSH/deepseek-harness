from __future__ import annotations

import sys
import threading
from pathlib import Path

import pytest

import deepseek_harness.client as client_module
from deepseek_harness import DeepSeekHarness, HarnessClient, NotificationOverflowError
from deepseek_harness.errors import TransportClosedError

ECHO_RUNTIME = """
import json
import sys

for line in sys.stdin:
    msg = json.loads(line)
    method = msg.get("method")
    if method == "burst":
        for index in range(20):
            print(json.dumps({"jsonrpc": "2.0", "method": "tick", "params": {"index": index}}), flush=True)
    result = {"serverInfo": {"name": "fake-runtime"}} if method == "initialize" else {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
"""

STDERR_RUNTIME = """
import sys

sys.stderr.write("x" * 1000000 + "\\n")
for index in range(300):
    sys.stderr.write(str(index) + ":" + "y" * 1000 + "\\n")
sys.stderr.write("z" * 1000000)
sys.stderr.flush()
"""

COUNTING_RUNTIME = """
import json
import os
import sys

with open(os.environ["LAUNCH_LOG"], "a") as log:
    log.write("launch\\n")
for line in sys.stdin:
    msg = json.loads(line)
    result = {"serverInfo": {"name": "fake-runtime"}} if msg.get("method") == "initialize" else {}
    print(json.dumps({"jsonrpc": "2.0", "id": msg["id"], "result": result}), flush=True)
"""


def runtime_client(tmp_path: Path, source: str, **env: str) -> HarnessClient:
    script = tmp_path / "fake_runtime.py"
    script.write_text(source)
    from deepseek_harness import HarnessConfig

    return HarnessClient(HarnessConfig(env=env or None), _launch_args=(sys.executable, str(script)))


def test_restart_does_not_deliver_the_previous_runtime_shutdown_error(tmp_path: Path) -> None:
    client = runtime_client(tmp_path, ECHO_RUNTIME)
    client.start()
    client.close()
    client.start()
    try:
        assert client._notifications.qsize() == 0
        assert client._requests.qsize() == 0
        with client.subscribe_notifications() as subscription:
            with pytest.raises(TimeoutError):
                subscription.next(timeout_seconds=0.3)
        assert client._request_raw("ping") == {}
    finally:
        client.close()


def test_stale_reader_cannot_fail_the_next_runtime(tmp_path: Path) -> None:
    client = runtime_client(tmp_path, ECHO_RUNTIME)
    client.start()
    stale_proc = client._proc
    client.close()
    client.start()
    try:
        waiter = client.subscribe_notifications()
        client._fail_waiters(TransportClosedError("stale"), stale_proc)
        assert client._notification_subscribers
        with pytest.raises(TimeoutError):
            waiter.next(timeout_seconds=0.2)
    finally:
        client.close()


def test_concurrent_first_use_starts_one_runtime(tmp_path: Path) -> None:
    log = tmp_path / "launches.txt"
    script = tmp_path / "counting_runtime.py"
    script.write_text(COUNTING_RUNTIME)
    harness = DeepSeekHarness(
        _launch_args=(sys.executable, str(script)),
        cwd=str(tmp_path),
        env={"LAUNCH_LOG": str(log)},
    )
    barrier = threading.Barrier(8)
    errors: list[BaseException] = []

    def first_use() -> None:
        try:
            barrier.wait()
            harness.start()
        except BaseException as exc:
            errors.append(exc)

    threads = [threading.Thread(target=first_use) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    try:
        assert errors == []
        assert log.read_text().splitlines() == ["launch"]
    finally:
        harness.close()


def test_unread_subscription_fails_visibly_after_the_queue_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "NOTIFICATION_QUEUE_LIMIT", 5)
    client = runtime_client(tmp_path, ECHO_RUNTIME)
    client.start()
    try:
        subscription = client.subscribe_notifications()
        other = client.subscribe_notifications(lambda notification: notification.payload["index"] >= 18)
        client._request_raw("burst")
        received = [subscription.next(timeout_seconds=2).payload["index"] for _ in range(5)]
        assert received == [0, 1, 2, 3, 4]
        with pytest.raises(NotificationOverflowError):
            subscription.next(timeout_seconds=2)
        assert [other.next(timeout_seconds=2).payload["index"] for _ in range(2)] == [18, 19]
    finally:
        client.close()


def test_unread_default_queue_fails_visibly_after_the_queue_limit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(client_module, "NOTIFICATION_QUEUE_LIMIT", 5)
    client = runtime_client(tmp_path, ECHO_RUNTIME)
    client.start()
    try:
        client._request_raw("burst")
        assert [client.next_notification().payload["index"] for _ in range(5)] == [0, 1, 2, 3, 4]
        with pytest.raises(NotificationOverflowError):
            client.next_notification()
    finally:
        client.close()


def test_stderr_tail_is_bounded_by_bytes_and_truncates_long_lines(tmp_path: Path) -> None:
    client = runtime_client(tmp_path, STDERR_RUNTIME)
    client.start()
    try:
        client._stderr_thread.join(timeout=30)
        text = client._stderr_lines.text()
        assert len(text.encode("utf-8")) <= client_module.STDERR_TAIL_BYTES + client_module.STDERR_TAIL_LINES
        assert "299:" in text
        assert "x" * 100 not in text
        assert text.endswith("z" * 100) or text.endswith(client_module.STDERR_TRUNCATED_SUFFIX)
        assert "\n0:" not in text
    finally:
        client.close()
