"""Shared LLM factory for every agent, with retries on transient Groq errors.

Why this exists: a full 4-agent analysis makes ~10-15 LLM calls, and the
Groq free tier caps gpt-oss at 8,000 tokens/minute. A single agent (e.g. the
SPARTA Analyst, which calls two tools) can burn through that budget inside
its own task, so pausing *between* tasks isn't enough. Without retries, one
429 -- or one network blip (seen in testing: "getaddrinfo failed") -- turns
the whole run into status=ERROR. A live 5-class run failed 3/5 this way.

RetryingLLM retries only errors that are safe to repeat (rate limits,
server/connection errors, timeouts), waiting as long as Groq says to
("Please try again in 6.32s") or with exponential backoff otherwise.
Groq's tool_use_failed (a malformed tool call the model generated) is also
retried, since the next sample is usually valid. Everything else (other bad
requests, auth, model not found) raises immediately.

Env vars:
  LLM_MODEL        model string (default groq/openai/gpt-oss-120b)
  LLM_MAX_RETRIES  retries per call (default 6)
"""
import os
import re
import time
from typing import Any

from crewai import LLM

DEFAULT_MODEL = "groq/openai/gpt-oss-120b"

_RETRYABLE_TYPES = (
    "RateLimitError",
    "InternalServerError",
    "APIConnectionError",
    "ServiceUnavailableError",
    "Timeout",
    "APITimeoutError",
)
_RETRYABLE_TEXT = (
    "rate limit", "getaddrinfo failed", "connection reset", "timed out", "503", "502",
    # Groq rejects a malformed tool call the model generated (a 400, but the
    # generation is sampled, so a retry usually produces a valid call).
    "tool_use_failed",
)
_RETRY_AFTER = re.compile(r"try again in\s+(?:(\d+)m)?\s*([\d.]+)\s*(ms|s)", re.I)


def _is_retryable(exc: Exception) -> bool:
    names = {c.__name__ for c in type(exc).__mro__}
    if names.intersection(_RETRYABLE_TYPES):
        return True
    text = str(exc).lower()
    return any(t in text for t in _RETRYABLE_TEXT)


def _wait_seconds(exc: Exception, attempt: int) -> float:
    """Groq's own 'try again in Xs' hint (+1s margin), else exponential backoff."""
    m = _RETRY_AFTER.search(str(exc))
    if m:
        minutes = int(m.group(1) or 0)
        value = float(m.group(2))
        secs = minutes * 60 + (value / 1000 if m.group(3).lower() == "ms" else value)
        return min(secs + 1.0, 65.0)
    return min(5.0 * (2 ** attempt), 60.0)


class RetryingLLM(LLM):
    """crewai.LLM that retries transient provider/network failures."""

    def call(self, *args: Any, **kwargs: Any) -> Any:
        max_retries = int(os.getenv("LLM_MAX_RETRIES", "6"))
        attempt = 0
        while True:
            try:
                return super().call(*args, **kwargs)
            except Exception as exc:
                if attempt >= max_retries or not _is_retryable(exc):
                    raise
                wait = _wait_seconds(exc, attempt)
                attempt += 1
                print(
                    f"[llm retry {attempt}/{max_retries}] {type(exc).__name__}; "
                    f"waiting {wait:.1f}s before retrying",
                    flush=True,
                )
                time.sleep(wait)


def make_llm() -> LLM:
    return RetryingLLM(model=os.getenv("LLM_MODEL", DEFAULT_MODEL))
