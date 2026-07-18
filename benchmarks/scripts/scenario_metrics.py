from __future__ import annotations

import http.client
import json
import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from typing import Any


@dataclass(frozen=True)
class ScenarioSample:
    requests_per_second: float
    success_rate: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    total_seconds: float
    status_codes: dict[str, int]
    completed_cycles: int
    state_checks: int

    def as_json(self) -> dict[str, object]:
        return asdict(self)


def run_stytch_todo_crud(
    port: int,
    concurrency: int,
    duration_seconds: int,
    keep_alive: bool,
) -> ScenarioSample:
    if concurrency < 1 or duration_seconds < 1:
        raise ValueError("concurrency and duration must be positive")

    started = time.perf_counter()
    deadline = started + duration_seconds
    start = threading.Event()
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(
                _run_worker,
                port,
                worker,
                deadline,
                start,
                keep_alive,
            )
            for worker in range(concurrency)
        ]
        start.set()
        results = [future.result() for future in futures]
    elapsed = time.perf_counter() - started
    latencies = [latency for result in results for latency in result[0]]
    cycles = sum(result[1] for result in results)
    state_checks = sum(result[2] for result in results)
    if not latencies or cycles < concurrency or state_checks != concurrency:
        raise RuntimeError(
            "CRUD scenario did not complete one checked cycle per worker: "
            f"requests={len(latencies)}, cycles={cycles}, checks={state_checks}"
        )
    return ScenarioSample(
        requests_per_second=len(latencies) / elapsed,
        success_rate=1.0,
        p50_ms=percentile(latencies, 0.50),
        p95_ms=percentile(latencies, 0.95),
        p99_ms=percentile(latencies, 0.99),
        max_ms=max(latencies),
        total_seconds=elapsed,
        status_codes={"200": len(latencies)},
        completed_cycles=cycles,
        state_checks=state_checks,
    )


def probe_stytch_todo_crud(port: int, keep_alive: bool, worker: int = 1024) -> None:
    user = f"benchmark-user-{worker}"
    text = f"bench-{worker}"
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        _run_cycle(connection, keep_alive, user, text, [])
        final = _raw_request(connection, keep_alive, "GET", "/api/todos", user, None)
        _assert_http_response(final, "recovery")
        validate_stytch_todo_response("delete", final[1], text)
    finally:
        connection.close()


def percentile(values: list[float], fraction: float) -> float:
    if not values or not 0 < fraction <= 1:
        raise ValueError("percentile requires values and a fraction in (0, 1]")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(fraction * len(ordered)) - 1)]


def validate_stytch_todo_response(
    step: str,
    body: bytes,
    expected_text: str,
    expected_id: str | None = None,
) -> str | None:
    try:
        payload = json.loads(body)
        todos = payload["todos"]
    except (KeyError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError(f"malformed TODO {step} response") from error
    if not isinstance(todos, list):
        raise RuntimeError(f"TODO {step} response does not contain an array")
    if step == "delete":
        if todos != []:
            raise RuntimeError(f"TODO delete did not restore empty state: {payload}")
        return None
    if len(todos) != 1 or not isinstance(todos[0], dict):
        raise RuntimeError(f"TODO {step} did not retain exactly one record: {payload}")
    todo: dict[str, Any] = todos[0]
    todo_id = todo.get("id")
    completed = todo.get("completed")
    if (
        not isinstance(todo_id, str)
        or not todo_id.isdigit()
        or todo.get("text") != expected_text
        or (expected_id is not None and todo_id != expected_id)
        or completed is not (step == "complete")
    ):
        raise RuntimeError(f"TODO {step} state mismatch: {payload}")
    return todo_id


def _run_worker(
    port: int,
    worker: int,
    deadline: float,
    start: threading.Event,
    keep_alive: bool,
) -> tuple[list[float], int, int]:
    user = f"benchmark-user-{worker}"
    text = f"bench-{worker}"
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    latencies: list[float] = []
    cycles = 0
    start.wait()
    try:
        while cycles == 0 or time.perf_counter() < deadline:
            _run_cycle(connection, keep_alive, user, text, latencies)
            cycles += 1

        final = _raw_request(connection, keep_alive, "GET", "/api/todos", user, None)
        _assert_http_response(final, "recovery")
        validate_stytch_todo_response("delete", final[1], text)
        return latencies, cycles, 1
    finally:
        connection.close()


def _run_cycle(
    connection: http.client.HTTPConnection,
    keep_alive: bool,
    user: str,
    text: str,
    latencies: list[float],
) -> None:
    todo_id = _request(
        connection,
        keep_alive,
        "POST",
        "/api/todos",
        user,
        text,
        "create",
        b'{"todoText":"' + text.encode() + b'"}',
        latencies,
    )
    _request(
        connection,
        keep_alive,
        "GET",
        "/api/todos",
        user,
        text,
        "list",
        None,
        latencies,
        todo_id,
    )
    _request(
        connection,
        keep_alive,
        "POST",
        f"/api/todos/{todo_id}/complete",
        user,
        text,
        "complete",
        None,
        latencies,
        todo_id,
    )
    _request(
        connection,
        keep_alive,
        "DELETE",
        f"/api/todos/{todo_id}",
        user,
        text,
        "delete",
        None,
        latencies,
        todo_id,
    )


def _request(
    connection: http.client.HTTPConnection,
    keep_alive: bool,
    method: str,
    path: str,
    user: str,
    text: str,
    step: str,
    body: bytes | None,
    latencies: list[float],
    expected_id: str | None = None,
) -> str | None:
    started = time.perf_counter_ns()
    response = _raw_request(connection, keep_alive, method, path, user, body)
    latencies.append((time.perf_counter_ns() - started) / 1_000_000)
    _assert_http_response(response, step)
    return validate_stytch_todo_response(step, response[1], text, expected_id)


def _raw_request(
    connection: http.client.HTTPConnection,
    keep_alive: bool,
    method: str,
    path: str,
    user: str,
    body: bytes | None,
) -> tuple[int, bytes, str | None]:
    if not keep_alive:
        connection.close()
    headers = {
        "Connection": "keep-alive" if keep_alive else "close",
        "Cookie": f"stytch_session_jwt={user}",
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    connection.request(method, path, body=body, headers=headers)
    response = connection.getresponse()
    response_body = response.read()
    return response.status, response_body, response.getheader("content-type")


def _assert_http_response(response: tuple[int, bytes, str | None], step: str) -> None:
    status, _body, content_type = response
    normalized = (content_type or "").replace(" ", "").lower()
    if status != 200 or normalized != "application/json":
        raise RuntimeError(
            f"TODO {step} HTTP mismatch: status={status}, content-type={content_type}"
        )
