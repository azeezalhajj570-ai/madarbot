"""Shared timeout/retry wrapper for Telethon RPCs with timing instrumentation."""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator, Callable, Coroutine, TypeVar

import structlog

T = TypeVar("T")

logger = structlog.get_logger(__name__)

DEFAULT_TIMEOUT: float = 20.0
HEALTH_CHECK_TIMEOUT: float = 10.0
ITER_PARTICIPANTS_TIMEOUT: float = 30.0
DEFAULT_MAX_RETRIES: int = 2
DEFAULT_RETRY_DELAY: float = 1.0
DEFAULT_BACKOFF: float = 2.0

SLOW_RPC_THRESHOLD: float = 0.5


async def call_with_retry(
    client: Any,
    rpc_factory: Callable[[], Coroutine[Any, Any, T]],
    *,
    rpc_name: str,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_MAX_RETRIES,
    retry_delay: float = DEFAULT_RETRY_DELAY,
    backoff: float = DEFAULT_BACKOFF,
) -> T:
    last_exc: Exception | None = None
    for attempt in range(max_retries + 1):
        start = time.monotonic()
        try:
            result = await asyncio.wait_for(rpc_factory(), timeout=timeout)
            elapsed = time.monotonic() - start
            if elapsed > SLOW_RPC_THRESHOLD:
                logger.info(
                    "rpc_completed",
                    rpc=rpc_name,
                    elapsed=round(elapsed, 3),
                    attempt=attempt,
                )
            return result
        except asyncio.TimeoutError as exc:
            elapsed = time.monotonic() - start
            logger.warning(
                "rpc_timed_out",
                rpc=rpc_name,
                timeout=timeout,
                attempt=attempt,
                max_retries=max_retries,
                elapsed=round(elapsed, 3),
            )
            last_exc = exc
            if attempt < max_retries:
                wait = retry_delay * (backoff**attempt)
                await asyncio.sleep(wait)
        except Exception as exc:
            elapsed = time.monotonic() - start
            exc_type = type(exc).__name__
            exc_module = type(exc).__module__
            exc_repr = repr(exc)
            exc_mro = [c.__name__ for c in type(exc).__mro__]
            extra: dict[str, Any] = {}
            for attr in ("seconds", "code", "message", "request", "captcha"):
                if hasattr(exc, attr):
                    try:
                        extra[attr] = getattr(exc, attr)
                    except Exception:
                        pass
            logger.warning(
                "rpc_failed",
                rpc=rpc_name,
                attempt=attempt,
                exc_type=exc_type,
                exc_module=exc_module,
                exc_repr=exc_repr[:200],
                exc_mro=exc_mro,
                elapsed=round(elapsed, 3),
                **extra,
            )
            raise
    raise last_exc  # type: ignore[misc]


async def iter_participants_with_timeout(
    client: Any,
    entity: Any,
    *,
    timeout: float = ITER_PARTICIPANTS_TIMEOUT,
    rpc_name: str = "iter_participants",
    **kwargs: Any,
) -> AsyncIterator[Any]:
    start = time.monotonic()
    total_yielded = 0
    ait = client.iter_participants(entity, **kwargs)
    try:
        while True:
            batch_start = time.monotonic()
            try:
                participant = await asyncio.wait_for(
                    ait.__anext__(), timeout=timeout
                )
                total_yielded += 1
                yield participant
            except StopAsyncIteration:
                elapsed = time.monotonic() - start
                logger.info(
                    "iter_participants_completed",
                    rpc=rpc_name,
                    total=total_yielded,
                    elapsed=round(elapsed, 3),
                )
                return
            except asyncio.TimeoutError:
                elapsed = time.monotonic() - batch_start
                total_elapsed = time.monotonic() - start
                logger.warning(
                    "iter_participants_batch_timed_out",
                    rpc=rpc_name,
                    timeout=timeout,
                    yielded=total_yielded,
                    batch_elapsed=round(elapsed, 3),
                    total_elapsed=round(total_elapsed, 3),
                )
                raise TimeoutError(
                    f"iter_participants timed out after {total_yielded} "
                    f"participants (batch timeout={timeout}s)"
                ) from None
    finally:
        try:
            await ait.aclose()
        except Exception:
            pass


SEND_FILE_TIMEOUT: float = 120.0


async def send_file_with_timeout(
    client: Any,
    entity: Any,
    text: str,
    media_url: str,
    *,
    timeout: float = SEND_FILE_TIMEOUT,
) -> Any:
    import aiohttp
    import os
    import tempfile

    start = time.monotonic()
    temp_path: str | None = None
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                media_url, timeout=aiohttp.ClientTimeout(total=timeout)
            ) as resp:
                resp.raise_for_status()
                fd, temp_path = tempfile.mkstemp(suffix=".media")
                with os.fdopen(fd, "wb") as f:
                    async for chunk in resp.content.iter_chunked(65536):
                        f.write(chunk)

        result = await call_with_retry(
            client,
            lambda: client.send_file(entity, temp_path, caption=text),
            rpc_name="send_file",
            timeout=timeout,
            max_retries=0,
        )
        elapsed = time.monotonic() - start
        logger.info(
            "rpc_send_file_completed",
            elapsed=round(elapsed, 3),
        )
        return result
    except Exception as exc:
        elapsed = time.monotonic() - start
        exc_type = type(exc).__name__
        exc_module = type(exc).__module__
        logger.warning(
            "rpc_send_file_failed",
            elapsed=round(elapsed, 3),
            exc_type=exc_type,
            exc_module=exc_module,
            error=str(exc)[:200],
        )
        # Fall back to text-only send
        return await call_with_retry(
            client,
            lambda: client.send_message(entity, text),
            rpc_name="send_message",
            timeout=DEFAULT_TIMEOUT,
            max_retries=0,
        )
    finally:
        if temp_path is not None:
            try:
                os.unlink(temp_path)
            except Exception:
                pass


async def check_agent_health(
    client: Any,
    *,
    rpc_name: str = "get_me",
) -> bool:
    try:
        await call_with_retry(
            client,
            lambda: client.get_me(),
            rpc_name=rpc_name,
            timeout=HEALTH_CHECK_TIMEOUT,
            max_retries=1,
        )
        logger.info("agent_health_check_passed")
        return True
    except Exception as exc:
        logger.warning("agent_health_check_failed", error=str(exc)[:200])
        raise
