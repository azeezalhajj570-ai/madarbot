"""Dynamic member search engine.

Public entry: :class:`bot.services.member_search_service.MemberSearchService`
orchestrates the pipeline below:

    FilterValidator → FilterNormalizer → QueryPlanner → QueryCompiler
        → MemberSearchRepository

The Mini App communicates with the backend using the filter AST (not SQL), so
the query engine can evolve without changing the API contract.
"""

from bot.search.exceptions import (
    FilterValidationError,
    MemberSearchError,
    SearchQueryTooComplexError,
)
from bot.search.filter_ast import Condition, FilterGroup, FilterNode, from_dict, to_dict
from bot.search.filter_normalizer import normalize
from bot.search.filter_validator import (
    ALLOWED_FIELDS,
    ALLOWED_OPERATORS,
    ALLOWED_SORTS,
    MAX_CONDITIONS,
    MAX_DEPTH,
    MAX_GROUP_IDS,
    MAX_KEYWORD_LENGTH,
    MAX_KEYWORDS,
    validate_filter,
    validate_group_ids,
    validate_sort,
)

__all__ = [
    "ALLOWED_FIELDS",
    "ALLOWED_OPERATORS",
    "ALLOWED_SORTS",
    "MAX_CONDITIONS",
    "MAX_DEPTH",
    "MAX_GROUP_IDS",
    "MAX_KEYWORDS",
    "MAX_KEYWORD_LENGTH",
    "Condition",
    "FilterGroup",
    "FilterNode",
    "FilterValidationError",
    "MemberSearchError",
    "SearchQueryTooComplexError",
    "from_dict",
    "normalize",
    "to_dict",
    "validate_filter",
    "validate_group_ids",
    "validate_sort",
]
