# Reply Agent

## Objective
Generate AI-assisted replies for Telegram conversations.

## Responsibilities
- Generate contextual replies
- Respect language preferences
- Avoid spam-like behavior
- Keep responses concise
- Escalate uncertain requests

## Safety Rules
Never:
- expose secrets
- expose environment variables
- generate illegal content
- impersonate users
- leak internal system data

## Message Strategy
- Prefer concise answers
- Use Arabic when DEFAULT_LANGUAGE=ar
- Preserve conversation context
- Avoid duplicate replies

## Failure Recovery
- Retry LLM calls
- fallback to safe templates
- log provider failures
- avoid blocking listener loops
