# Testing Strategy

## Purpose
This document defines the testing expectations for MadarBot.

## Testing Pyramid
Prioritize:
1. Unit tests
2. Integration tests
3. End-to-end tests

Avoid relying only on manual testing.

## Unit Tests
Unit tests should validate:
- business logic
- deduplication rules
- parsing
- validation
- helper functions
- retry logic
- task routing

Examples:
- lead deduplication
- keyword matching
- task dispatch
- payload validation

## Integration Tests
Integration tests should validate:
- database persistence
- Redis integration
- Telegram session behavior
- API endpoints
- task execution flow
- migration compatibility

Examples:
- message -> task -> DB persistence
- listener -> automation pipeline
- migration -> startup compatibility

## End-to-End Tests
E2E tests should validate:
- full Telegram workflows
- Docker startup
- API + DB + Redis integration
- automation execution lifecycle

Examples:
- incoming Telegram message creates lead
- support keyword triggers workflow
- failed task retries correctly

## Regression Tests
Every production bug should receive:
- a regression test
- a documented root cause

Never fix a critical bug without adding a test.

## Database Testing
For database-related changes:
- test on a clean DB
- test on existing schema
- test migration upgrades
- test nullable and unique constraints

## Async Testing
Async code should use async-aware tests.

Examples:
- async task execution
- async database sessions
- Telegram listeners
- retry behavior

## Performance Testing
Performance-sensitive areas:
- listener throughput
- task execution queue
- Redis operations
- DB queries
- message processing latency

## Security Testing
Validate:
- secrets are protected
- authentication checks
- input validation
- injection safety
- rate limiting
- permission boundaries

## Smoke Tests
After deployment:
- bot connects
- DB reachable
- Redis reachable
- API healthy
- agent listener running
- automation tasks execute

## CI Expectations
CI should block merges when:
- tests fail
- lint fails
- formatting fails
- migrations break
- builds fail
