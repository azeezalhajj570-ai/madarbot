"""Typed exceptions for the member search filter engine."""

from __future__ import annotations


class FilterValidationError(ValueError):
    """The client-supplied filter violates validation or complexity rules.

    Raised by FilterValidator / FilterNormalizer; carries a stable error code
    (mapped by the API to 422 with a structured error payload).
    """

    def __init__(
        self, message: str, *, code: str = "INVALID_FILTER", field: str | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.field = field


class SearchQueryTooComplexError(FilterValidationError):
    """The filter tree exceeds the configured complexity limits."""

    def __init__(self, message: str, *, field: str | None = None) -> None:
        super().__init__(message, code="FILTER_TOO_COMPLEX", field=field)


class MemberSearchError(Exception):
    """Unexpected member-search failure (mapped by the API to a 500 with no internals exposed)."""
