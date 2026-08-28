"""Domain exceptions for the agent subsystem."""


class AgentError(Exception):
    """Base exception for agent subsystem."""


class AgentSessionError(AgentError):
    """Session file missing, expired, or corrupted."""


class AgentSessionRevokedError(AgentSessionError):
    """Agent session is no longer authorized and must be linked again."""


class AgentFloodWaitError(AgentError):
    def __init__(self, retry_after: int):
        self.retry_after = retry_after
        super().__init__(f"Flood wait: retry after {retry_after}s")


class AgentStopError(AgentError):
    """Graceful stop of a job due to a rate-limit / cooldown condition.

    Unlike unexpected exceptions (which Dramatiq treats as failures and
    retries), this signals the worker to persist the current progress, mark
    the job PENDING, and re-dispatch after `delay` seconds so the job resumes
    from the remaining recipients rather than starting over.
    """

    def __init__(
        self,
        *,
        stop_reason: str,
        delay: int,
        progress: dict | None = None,
    ) -> None:
        self.stop_reason = stop_reason
        self.delay = max(1, int(delay))
        self.progress = dict(progress or {})
        super().__init__(f"Stopped: {stop_reason} (retry in {self.delay}s)")


class AgentBannedError(AgentError):
    """Agent account has been banned by Telegram."""


class AgentAuthError(AgentError):
    """Authentication step failed."""


class JobValidationError(AgentError):
    """Job payload validation failed before dispatch."""

    def __init__(self, message: str, details: dict | None = None):
        self.details = details or {}
        super().__init__(message)
