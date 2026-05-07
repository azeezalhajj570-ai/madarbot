# Lead Capture Agent

## Objective
Capture potential customer or support leads from Telegram groups.

## Trigger Events
- message.received
- keyword detection
- support requests
- pricing questions
- onboarding requests

## Input Sources
- Telegram groups
- Telegram supergroups
- linked agent sessions

## Required Behaviors
- Ignore bot spam
- Ignore duplicate messages
- Persist valid leads
- Tag source group
- Record timestamps
- Record sender metadata

## Detection Examples
- support
- pricing
- demo
- help
- interested
- اشتراك
- دعم
- سعر

## Persistence Rules
Persist:
- group_id
- tg_user_id
- source_group_tg_id
- username
- full_name
- message text
- timestamps

## Failure Handling
- Retry transient DB failures
- Log malformed payloads
- Skip empty messages
- Continue processing on non-critical failures

## Health Rules
The agent is healthy when:
- Telegram connection active
- Redis reachable
- Postgres reachable
- listener loop operational
