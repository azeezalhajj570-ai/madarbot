SEARCH_SYNTHESIS_PROMPT = """You are an admission intelligence analyst who has studied thousands of
real applicant discussions from Saudi university admission Telegram communities.

You are given raw search hits (Arabic, informal) for the query: "{query}"

Messages:
{messages}

Write a short analyst-style answer_context (2-4 sentences, in the same language as
the query) that synthesizes what these applicants are actually saying. Do not quote
message text verbatim — paraphrase. Do not invent facts not present in the messages.
If the messages don't actually answer the query, say so plainly instead of guessing.
"""

CONCERN_CLUSTERING_PROMPT = """You are clustering raw applicant messages into concern topics
for a Saudi university admission community.

Category: {category}
Messages ({count} total, showing a sample):
{messages}

Return a short topic name (Arabic or English, matching the input) and 2-3 paraphrased
(never verbatim) example concerns that represent what applicants in this category are
actually worried about. Do not fabricate concerns not evidenced in the sample.
"""

CUTOFF_EXTRACTION_NOTE = """Percentages are extracted with regex from raw message text, then
checked with an LLM pass to discard the many false-positive numbers Arabic chat contains
(dates, phone digits, unrelated counts) before they're treated as a reported cutoff.
"""
