from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import time
import uuid
from collections import deque
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, TypeAlias, TypeVar

from pydantic import BaseModel, ValidationError

from .errors import JsonRpcError, NotificationOverflowError, SdkProtocolError, TransportClosedError
from .models import CommandExecution, IncomingRequest, InitializeResponse, JsonObject, JsonValue, Notification, UserQuestionAnswer, UserQuestionRequest

ModelT = TypeVar("ModelT", bound=BaseModel)
NotificationFilter: TypeAlias = Callable[[Notification], bool]
UserQuestionHandler: TypeAlias = Callable[[UserQuestionRequest, threading.Event], UserQuestionAnswer | JsonObject]

NOTIFICATION_QUEUE_LIMIT = 10_000
STDERR_LINE_LIMIT = 8_192
STDERR_TAIL_BYTES = 64 * 1024
STDERR_TAIL_LINES = 400
STDERR_TRUNCATED_SUFFIX = "...[truncated]"


class _BoundedQueue(queue.Queue):
    """FIFO holding NOTIFICATION_QUEUE_LIMIT items plus one slot reserved for a terminal error; offer under the owner's lock."""

    def __init__(self, what: str) -> None:
        super().__init__(maxsize=NOTIFICATION_QUEUE_LIMIT + 1)
        self._what = what
        self.overflowed = False

    def offer(self, item: object) -> bool:
        if self.overflowed:
            return False
        if isinstance(item, BaseException):
            if self.qsize() > NOTIFICATION_QUEUE_LIMIT:
                return False
            self.put_nowait(item)
            return True
        if self.qsize() >= NOTIFICATION_QUEUE_LIMIT:
            self.overflowed = True
            self.put_nowait(NotificationOverflowError(
                f"{self._what} exceeded {NOTIFICATION_QUEUE_LIMIT} unread items; later items were dropped"
            ))
            return False
        self.put_nowait(item)
        return True


class _StderrTail:
    """Recent runtime stderr bounded by line count and UTF-8 size."""

    def __init__(self) -> None:
        self._lines: deque[tuple[str, int]] = deque()
        self._bytes = 0
        self._lock = threading.Lock()

    def append(self, line: str) -> None:
        size = len(line.encode("utf-8", "replace"))
        with self._lock:
            self._lines.append((line, size))
            self._bytes += size
            while len(self._lines) > STDERR_TAIL_LINES or (self._bytes > STDERR_TAIL_BYTES and len(self._lines) > 1):
                self._bytes -= self._lines.popleft()[1]

    def __bool__(self) -> bool:
        with self._lock:
            return bool(self._lines)

    def text(self) -> str:
        with self._lock:
            return "\n".join(line for line, _size in self._lines)


@dataclass(slots=True)
class HarnessConfig:
    """Configuration for launching the local DeepSeek Harness SDK runtime."""

    dsh_bin: str | None = None
    profile: str = "sdk"
    patches: tuple[str, ...] = ()
    dsh_home: str | None = None
    cwd: str | None = None
    env: dict[str, str] | None = None
    initialize_timeout_seconds: float = 30.0
    request_timeout_seconds: float | None = None
    shutdown_timeout_seconds: float | None = 1.0
    # Callbacks run outside the reader; observe the Event to release work on cancellation.
    on_user_question: UserQuestionHandler | None = None


class HarnessClient:
    """Synchronous JSON-RPC client for the DeepSeek Harness SDK runtime over stdio."""

    def __init__(
        self,
        config: HarnessConfig | None = None,
        *,
        _launch_args: tuple[str, ...] | None = None,
    ) -> None:
        self.config = config or HarnessConfig()
        self._launch_args = _launch_args
        self._proc: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._lifecycle = threading.RLock()
        self._write_lock = threading.Lock()
        self._responses: dict[str, queue.Queue[JsonValue | BaseException]] = {}
        self._notifications = _BoundedQueue("SDK notification queue")
        self._notification_subscribers: dict[
            str, tuple[queue.Queue[Notification | BaseException], NotificationFilter | None]
        ] = {}
        self._session_parents: dict[str, str] = {}
        self._requests = _BoundedQueue("SDK incoming request queue")
        self._stderr_lines = _StderrTail()
        self._reader_thread: threading.Thread | None = None
        self._stderr_thread: threading.Thread | None = None
        self._question_tasks: dict[str, tuple[threading.Event, threading.Thread]] = {}
        self._closing = False
        self._user_question_handler: UserQuestionHandler | None = None

    @property
    def lifecycle(self) -> AbstractContextManager[object]:
        return self._lifecycle

    def __enter__(self) -> "HarnessClient":
        self.start()
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    def start(self) -> None:
        if self._proc is not None:
            return
        with self._lifecycle:
            if self._proc is not None:
                return
            with self._lock:
                self._session_parents.clear()
                self._question_tasks.clear()
                self._closing = False
                self._user_question_handler = self.config.on_user_question
                self._notifications = _BoundedQueue("SDK notification queue")
                self._requests = _BoundedQueue("SDK incoming request queue")
                self._stderr_lines = _StderrTail()
            env = os.environ.copy()
            if self.config.env:
                env.update(self.config.env)
            args = list(self._launch_args or self._default_launch_args(env))
            proc = subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                cwd=None if self.config.cwd is None else str(Path(self.config.cwd).resolve()),
                env=env,
                bufsize=1,
            )
            with self._lock:
                self._proc = proc
            self._start_reader_thread(proc)
            self._start_stderr_thread(proc, self._stderr_lines)

    def close(self) -> None:
        """Close the runtime after a bounded opportunity to flush durable state."""
        with self._lifecycle:
            self._close_locked()

    def _close_locked(self) -> None:
        with self._lock:
            self._closing = True
            question_tasks = list(self._question_tasks.values())
            for cancelled, _thread in question_tasks:
                cancelled.set()
        proc = self._proc
        if proc is None:
            return
        shutdown_completed = False
        try:
            self.request("shutdown", None, response_model=_EmptyResponse, timeout_seconds=self.config.shutdown_timeout_seconds)
            shutdown_completed = True
        except Exception as exc:
            self._stderr_lines.append(f"shutdown request failed: {exc}")
        if proc.stdin:
            try:
                proc.stdin.close()
            except Exception as exc:
                self._stderr_lines.append(f"stdin close failed: {exc}")
        if shutdown_completed:
            try:
                proc.wait(timeout=self.config.shutdown_timeout_seconds)
            except subprocess.TimeoutExpired:
                pass
        if proc.poll() is None:
            try:
                proc.terminate()
            except ProcessLookupError:
                pass
        if proc.poll() is None:
            try:
                proc.wait(timeout=self.config.shutdown_timeout_seconds)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        with self._lock:
            self._proc = None
        self._fail_waiters(self._runtime_closed_error("DeepSeek Harness runtime closed"))
        if self._reader_thread and self._reader_thread.is_alive():
            self._reader_thread.join(timeout=0.5)
        if self._stderr_thread and self._stderr_thread.is_alive():
            self._stderr_thread.join(timeout=0.5)
        deadline = time.monotonic() + 0.5
        for _cancelled, thread in question_tasks:
            if thread is not threading.current_thread():
                thread.join(timeout=max(0, deadline - time.monotonic()))

    def initialize(
        self,
        *,
        cwd: str,
        provider: str,
        model: str,
        reasoning_effort: str | None = None,
        max_tokens: int | None = None,
        approval_requests: bool = False,
    ) -> InitializeResponse:
        """Initialize the runtime; approval_requests enables approval/request reception.

        When enabled, drain next_request() concurrently with blocking waits and
        return one-operation decisions through respond(). Omission preserves the
        runtime's composed approval answerers.
        """
        payload: JsonObject = {
            "cwd": str(Path(cwd).resolve()),
            "provider": provider,
            "model": model,
        }
        if approval_requests:
            payload["approvalRequests"] = True
        if reasoning_effort is not None:
            payload["reasoningEffort"] = reasoning_effort
        if max_tokens is not None:
            payload["maxTokens"] = max_tokens
        if self._user_question_handler is not None:
            payload["capabilities"] = {"userQuestions": True}
        try:
            return self.request(
                "initialize",
                payload,
                response_model=InitializeResponse,
                timeout_seconds=self.config.initialize_timeout_seconds,
            )
        except TimeoutError as error:
            self.close()
            raise TimeoutError(f"{error}\nselected dsh profile {self.config.profile!r}") from error
        except BaseException as error:
            self.close()
            diagnostics = self._runtime_diagnostics()
            if isinstance(error, JsonRpcError) and diagnostics:
                raise JsonRpcError(
                    error.code,
                    f"{error.message}\n{diagnostics}",
                    error.data,
                ) from error
            raise

    def session_prompt(
        self,
        session_id: str,
        content_blocks: list[JsonObject],
        *,
        on_notification: Callable[[Notification], None] | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> str:
        payload: JsonObject = {"sessionId": session_id, "contentBlocks": content_blocks}
        response = self.request(
            "session/prompt",
            payload,
            response_model=_SessionPromptResponse,
            on_notification=on_notification,
            notification_filter=self._notification_belongs_to_session_tree(session_id),
            notification_subscription=notification_subscription,
        )
        return response.messageId

    def resume_session(self, session_id: str) -> None:
        """Restore a persisted session without sending a prompt; propagate restoration failures."""
        self.request(
            "session/resume",
            {"sessionId": session_id},
            response_model=_EmptyResponse,
        )

    def _query(
        self, session_id: str, input: str | list[JsonObject],
    ) -> str | CommandExecution:
        """Return a validated prompt receipt or command result for high-level run callers."""
        blocks = [{"type": "text", "text": input}] if isinstance(input, str) else input
        result = self._request_raw("session/query", {
            "sessionId": session_id, "contentBlocks": blocks,
        })
        if isinstance(result, dict):
            if result.get("kind") == "prompt" and isinstance(result.get("messageId"), str) and result["messageId"]:
                return result["messageId"]
            if result.get("kind") == "command":
                return _command_execution(result.get("execution"))
        raise SdkProtocolError("session/query requires a prompt messageId or command execution result")

    def get_working_directory(self, session_id: str) -> str:
        """Read the effective directory, recovering a missing directory to the Session origin."""
        response = self.request(
            "session/working-directory/get",
            {"sessionId": session_id},
            response_model=_WorkingDirectoryResponse,
        )
        return response.cwd

    def set_working_directory(self, session_id: str, path: str) -> str:
        """Enter an absolute or Session-relative directory without changing origin or permissions."""
        response = self.request(
            "session/working-directory/set",
            {"sessionId": session_id, "path": path},
            response_model=_WorkingDirectoryResponse,
        )
        return response.cwd

    def request(
        self,
        method: str,
        params: JsonObject | None,
        *,
        response_model: type[ModelT],
        timeout_seconds: float | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        notification_filter: NotificationFilter | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> ModelT:
        result = self._request_raw(
            method,
            params,
            timeout_seconds=timeout_seconds,
            on_notification=on_notification,
            notification_filter=notification_filter,
            notification_subscription=notification_subscription,
        )
        if not isinstance(result, dict):
            raise TypeError(f"{method} response must be a JSON object")
        return response_model.model_validate(result)

    def notify(self, method: str, params: JsonObject | None = None) -> None:
        message: JsonObject = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            message["params"] = params
        self._write_message(message)

    def next_notification(self) -> Notification:
        item = self._notifications.get()
        if isinstance(item, BaseException):
            raise item
        return item

    def subscribe_notifications(
        self,
        notification_filter: NotificationFilter | None = None,
    ) -> "NotificationSubscription":
        subscription_id = str(uuid.uuid4())
        notifications = _BoundedQueue("SDK notification subscription")
        with self._lock:
            self._notification_subscribers[subscription_id] = (notifications, notification_filter)
        return NotificationSubscription(self, subscription_id, notifications)

    def subscribe_session_notifications(self, session_id: str) -> "NotificationSubscription":
        """Subscribe to a session and descendants discovered from subagent lifecycle edges."""
        return self.subscribe_notifications(self._notification_belongs_to_session_tree(session_id))

    def next_request(self) -> IncomingRequest:
        item = self._requests.get()
        if isinstance(item, BaseException):
            raise item
        return item

    def respond(self, request_id: str | int, result: JsonValue) -> None:
        self._write_message({"jsonrpc": "2.0", "id": request_id, "result": result})

    def respond_error(
        self,
        request_id: str | int,
        *,
        code: int,
        message: str,
        data: JsonValue | None = None,
    ) -> None:
        error: JsonObject = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        self._write_message({"jsonrpc": "2.0", "id": request_id, "error": error})

    def _request_raw(
        self,
        method: str,
        params: JsonObject | None = None,
        *,
        timeout_seconds: float | None = None,
        on_notification: Callable[[Notification], None] | None = None,
        notification_filter: NotificationFilter | None = None,
        notification_subscription: "NotificationSubscription | None" = None,
    ) -> JsonValue:
        request_id = str(uuid.uuid4())
        waiter: queue.Queue[JsonValue | BaseException] = queue.Queue(maxsize=1)
        temp_subscription: NotificationSubscription | None = None
        subscription = notification_subscription
        with self._lock:
            self._responses[request_id] = waiter
        if on_notification is not None and subscription is None:
            temp_subscription = self.subscribe_notifications(notification_filter)
            subscription = temp_subscription
        try:
            message: JsonObject = {"jsonrpc": "2.0", "id": request_id, "method": method}
            if params is not None:
                message["params"] = params
            self._write_message(message)
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        timeout = self.config.request_timeout_seconds if timeout_seconds is None else timeout_seconds
        deadline = None if timeout is None else time.monotonic() + timeout
        try:
            while True:
                if on_notification is not None and subscription is not None:
                    subscription.drain(on_notification)
                wait_timeout = None
                if on_notification is not None:
                    wait_timeout = 0.05
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        with self._lock:
                            self._responses.pop(request_id, None)
                        diagnostics = self._runtime_diagnostics()
                        suffix = f"\n{diagnostics}" if diagnostics else ""
                        raise TimeoutError(
                            f"{method} timed out waiting for DeepSeek Harness runtime{suffix}"
                        )
                    wait_timeout = remaining if wait_timeout is None else min(wait_timeout, remaining)
                try:
                    item = waiter.get(timeout=wait_timeout)
                    if on_notification is not None and subscription is not None:
                        subscription.drain(on_notification)
                    break
                except queue.Empty:
                    continue
        except BaseException:
            with self._lock:
                self._responses.pop(request_id, None)
            if temp_subscription is not None:
                temp_subscription.close()
            raise
        finally:
            if temp_subscription is not None:
                temp_subscription.close()
        if isinstance(item, BaseException):
            raise item
        return item

    def _write_message(self, message: JsonObject) -> None:
        proc = self._proc
        if proc is None or proc.stdin is None:
            raise TransportClosedError("DeepSeek Harness runtime is not running")
        try:
            payload = json.dumps(message, separators=(",", ":")) + "\n"
            with self._write_lock:
                proc.stdin.write(payload)
                proc.stdin.flush()
        except Exception as exc:
            raise self._runtime_closed_error("Failed to write to DeepSeek Harness runtime") from exc

    def _start_reader_thread(self, proc: subprocess.Popen[str]) -> None:
        self._reader_thread = threading.Thread(target=self._reader_loop, args=(proc,), name="dsh-runtime-reader", daemon=True)
        self._reader_thread.start()

    def _start_stderr_thread(self, proc: subprocess.Popen[str], lines: _StderrTail) -> None:
        self._stderr_thread = threading.Thread(target=self._stderr_loop, args=(proc, lines), name="dsh-runtime-stderr", daemon=True)
        self._stderr_thread.start()

    def _reader_loop(self, proc: subprocess.Popen[str]) -> None:
        if proc.stdout is None:
            return
        try:
            for line in proc.stdout:
                if self._proc is not proc:
                    return
                if not line.strip():
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    continue
                self._handle_message(message)
        except BaseException as exc:
            self._fail_waiters(exc, proc)
        finally:
            self._fail_waiters(self._runtime_closed_error("DeepSeek Harness runtime stdout closed"), proc)

    def _stderr_loop(self, proc: subprocess.Popen[str], lines: _StderrTail) -> None:
        stream = proc.stderr
        if stream is None:
            return
        while True:
            chunk = stream.readline(STDERR_LINE_LIMIT)
            if chunk == "":
                return
            if chunk.endswith("\n") or len(chunk) < STDERR_LINE_LIMIT:
                lines.append(chunk.rstrip())
                continue
            lines.append(chunk.rstrip() + STDERR_TRUNCATED_SUFFIX)
            while True:
                rest = stream.readline(STDERR_LINE_LIMIT)
                if rest == "" or rest.endswith("\n"):
                    break

    def _handle_message(self, message: object) -> None:
        if not isinstance(message, dict):
            return
        msg_id = message.get("id")
        method = message.get("method")
        if isinstance(msg_id, (str, int)) and isinstance(method, str):
            params = message.get("params")
            request = IncomingRequest(id=msg_id, method=method, payload=params if isinstance(params, dict) else {})
            if method == "user-question/ask" and self._user_question_handler is not None:
                self._start_user_question(request)
            else:
                self._offer(self._requests, request)
            return
        if isinstance(msg_id, (str, int)):
            with self._lock:
                waiter = self._responses.pop(str(msg_id), None)
            if waiter is None:
                return
            if isinstance(message.get("error"), dict):
                err = message["error"]
                waiter.put(JsonRpcError(_int_or_none(err.get("code")), str(err.get("message", "JSON-RPC error")), err.get("data")))
            else:
                waiter.put(message.get("result"))
            return
        if isinstance(method, str):
            params = message.get("params")
            notification = Notification(method=method, payload=params if isinstance(params, dict) else {})
            with self._lock:
                if method == "user-question.cancelled":
                    task = self._question_tasks.get(str(notification.payload.get("requestId")))
                    if task is not None:
                        task[0].set()
                self._record_session_relationship_locked(notification)
                subscribers = list(self._notification_subscribers.items())
            delivered = False
            for subscription_id, (subscriber, predicate) in subscribers:
                try:
                    matches = predicate is None or predicate(notification)
                except BaseException as exc:
                    with self._lock:
                        current = self._notification_subscribers.get(subscription_id)
                        if current is not None and current[0] is subscriber:
                            self._notification_subscribers.pop(subscription_id, None)
                        subscriber.offer(exc)
                    continue
                if matches:
                    with self._lock:
                        accepted = subscriber.offer(notification)
                        if not accepted:
                            current = self._notification_subscribers.get(subscription_id)
                            if current is not None and current[0] is subscriber:
                                self._notification_subscribers.pop(subscription_id, None)
                    delivered = True
            if not delivered:
                self._offer(self._notifications, notification)

    def _offer(self, target: _BoundedQueue, item: object) -> None:
        with self._lock:
            target.offer(item)

    def _fail_waiters(self, exc: BaseException, proc: subprocess.Popen[str] | None = None) -> None:
        with self._lock:
            if proc is not None and self._proc is not proc:
                return
            for cancelled, _thread in self._question_tasks.values():
                cancelled.set()
            waiters = list(self._responses.values())
            self._responses.clear()
            subscribers = list(self._notification_subscribers.values())
            self._notification_subscribers.clear()
            for waiter in waiters:
                waiter.put(exc)
            for subscriber, _predicate in subscribers:
                subscriber.offer(exc)
            self._notifications.offer(exc)
            self._requests.offer(exc)

    def _start_user_question(self, incoming: IncomingRequest) -> None:
        """Keep the reader free to receive cancellation, other responses, and shutdown."""
        handler = self._user_question_handler
        proc = self._proc
        try:
            request = UserQuestionRequest.model_validate(incoming.payload)
            if any(not isinstance(item.get("id"), str) or not isinstance(item.get("question"), str) for item in request.questions):
                raise ValueError("questions require id and question strings")
        except ValueError:
            self.respond_error(incoming.id, code=-32602, message="invalid user-question/ask parameters")
            return
        cancelled = threading.Event()

        def answer() -> None:
            try:
                if cancelled.is_set() or handler is None:
                    return
                result = handler(request, cancelled)
                wire_result = result.model_dump(exclude_none=True) if isinstance(result, UserQuestionAnswer) else result
                with self._lock:
                    if not cancelled.is_set() and self._proc is proc:
                        self.respond(incoming.id, wire_result)
            except Exception as exc:
                with self._lock:
                    if not cancelled.is_set() and self._proc is proc:
                        try:
                            self.respond_error(incoming.id, code=-32603, message=str(exc))
                        except TransportClosedError:
                            cancelled.set()
            finally:
                with self._lock:
                    current = self._question_tasks.get(request.request_id)
                    if current is not None and current[0] is cancelled:
                        self._question_tasks.pop(request.request_id, None)

        thread = threading.Thread(target=answer, name="dsh-user-question", daemon=True)
        with self._lock:
            if self._closing:
                return
            if request.request_id in self._question_tasks:
                self.respond_error(incoming.id, code=-32602, message="duplicate user-question requestId")
                return
            self._question_tasks[request.request_id] = (cancelled, thread)
            try:
                thread.start()
            except BaseException:
                self._question_tasks.pop(request.request_id, None)
                cancelled.set()
                raise

    def _runtime_closed_error(self, reason: str) -> TransportClosedError:
        diagnostics = self._runtime_diagnostics()
        return TransportClosedError(f"{reason}\n{diagnostics}" if diagnostics else reason)

    def _runtime_diagnostics(self) -> str:
        """Return available subprocess state for transport failures and timeouts."""
        proc = self._proc
        if (
            proc is not None
            and proc.poll() is not None
            and self._stderr_thread is not None
            and self._stderr_thread.is_alive()
            and threading.current_thread() is not self._stderr_thread
        ):
            self._stderr_thread.join(timeout=0.1)

        parts: list[str] = []
        if proc is not None:
            exit_code = proc.poll()
            if exit_code is not None:
                parts.append(f"exit code: {exit_code}")
        if self._stderr_lines:
            parts.append("stderr tail:\n" + self._stderr_lines.text())
        return "\n".join(parts)

    def _default_launch_args(self, env: dict[str, str]) -> tuple[str, ...]:
        if self.config.dsh_bin is None:
            try:
                from deepseek_harness_runtime import resolve_bundled_launch_args
            except ImportError as exc:
                raise FileNotFoundError(
                    "Unable to locate the bundled DeepSeek Harness dsh runtime. "
                    "Install deepseek-harness-runtime-bin."
                ) from exc
            base = resolve_bundled_launch_args()
        else:
            base = (str(Path(self.config.dsh_bin).expanduser().resolve()),)

        if self.config.dsh_home is not None:
            if not self.config.dsh_home.strip():
                raise ValueError("HarnessConfig requires a non-empty dsh_home")
            env["DSH_HOME"] = str(Path(self.config.dsh_home).expanduser().resolve())
        elif not env.get("DSH_HOME", "").strip():
            raise ValueError(
                "HarnessConfig requires an explicit dsh_home or non-empty DSH_HOME; "
                "the Python SDK never uses ~/.dsh implicitly"
            )

        patches = tuple(
            argument
            for patch in self.config.patches
            for argument in ("--patch", str(Path(patch).expanduser().resolve()))
        )
        return (*base, "--profile", self.config.profile, *patches)

    def _unsubscribe_notifications(self, subscription_id: str) -> None:
        with self._lock:
            self._notification_subscribers.pop(subscription_id, None)

    def _record_session_relationship_locked(self, notification: Notification) -> None:
        if notification.method != "subagent.started":
            return
        parent_id = notification.payload.get("parentSessionId")
        child_id = notification.payload.get("childSessionId")
        if (
            isinstance(parent_id, str)
            and parent_id
            and isinstance(child_id, str)
            and child_id
            and parent_id != child_id
        ):
            self._session_parents[child_id] = parent_id

    def _notification_belongs_to_session_tree(self, session_id: str) -> NotificationFilter:
        def belongs(notification: Notification) -> bool:
            payload = notification.payload
            if notification.method in {"subagent.started", "subagent.finished"}:
                parent_id = payload.get("parentSessionId")
                if (
                    isinstance(parent_id, str)
                    and self._session_is_descendant_of(parent_id, session_id)
                ):
                    return True
                return payload.get("childSessionId") == session_id
            related_id = payload.get("sessionId")
            return (
                isinstance(related_id, str)
                and self._session_is_descendant_of(related_id, session_id)
            )

        return belongs

    def _session_is_descendant_of(self, session_id: str, root_session_id: str) -> bool:
        current = session_id
        visited: set[str] = set()
        while current not in visited:
            if current == root_session_id:
                return True
            visited.add(current)
            parent = self._session_parents.get(current)
            if parent is None:
                return False
            current = parent
        return False


class NotificationSubscription:
    def __init__(
        self,
        client: HarnessClient,
        subscription_id: str,
        notifications: _BoundedQueue,
    ) -> None:
        self._client = client
        self._subscription_id = subscription_id
        self._notifications = notifications
        self._closed = False

    def __enter__(self) -> "NotificationSubscription":
        return self

    def __exit__(self, _exc_type, _exc, _tb) -> None:
        self.close()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._client._unsubscribe_notifications(self._subscription_id)

    def next(self, timeout_seconds: float | None = None) -> Notification:
        """Read one notification; an optional timeout stops only this local wait."""
        try:
            item = self._notifications.get(timeout=timeout_seconds)
        except queue.Empty as exc:
            raise TimeoutError("timed out waiting for an SDK notification") from exc
        if isinstance(item, BaseException):
            raise item
        return item

    def drain(self, on_notification: Callable[[Notification], None]) -> None:
        while True:
            try:
                item = self._notifications.get_nowait()
            except queue.Empty:
                return
            if isinstance(item, BaseException):
                raise item
            on_notification(item)


class _SessionPromptResponse(BaseModel):
    messageId: str


class _WorkingDirectoryResponse(BaseModel):
    cwd: str


class _EmptyResponse(BaseModel):
    pass


def _int_or_none(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _command_execution(value: JsonValue) -> CommandExecution:
    """Decode native command results and report malformed data as a protocol error."""
    try:
        return CommandExecution.model_validate(value)
    except ValidationError as error:
        raise SdkProtocolError("session/query returned an invalid command result") from error
