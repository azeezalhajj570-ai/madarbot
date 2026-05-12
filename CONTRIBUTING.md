# Contributing to MadarBot

## Workflow

- Branch from `main` using short-lived branches.
- Use the format `<type>/<short-description>` (e.g. `fix/lead-dedup`, `feat/support-agent`).
- Open a pull request to `main` when ready.
- No direct commits to `main` except emergency hotfixes.

## Commit Messages

```
<type>: <short description>
```

Types: `feat`, `fix`, `test`, `docs`, `chore`, `refactor`, `perf`, `ci`.

## Before Committing

1. Review the diff (`git diff --check` for whitespace).
2. Remove debug code and secrets.
3. Run relevant tests (`pytest`).
4. Run lint and format checks (`ruff check .`, `ruff format --check .`).
5. Update docs if behavior changes.

## Pull Requests

Every PR must include:

- **Summary** — what and why
- **Testing** — what was tested
- **Risk** — what could go wrong
- **Rollback Plan** — how to revert

## Database Migrations

- Create Alembic migrations for schema changes.
- Verify both `upgrade()` and `downgrade()`.
- Plan rollback before deploying.

## Security

Never commit:

- `.env` files or real secrets
- API keys, tokens, passwords
- Telegram session files (`*.session`)
- Production logs
- Private keys

Use `.env.example` for placeholder values only.

## Definition of Done

- Code is implemented
- Tests pass
- Docs are updated
- Migrations verified
- Deployment impact understood
- Rollback path clear
- PR reviewed and merged

See `docs/DEVELOPMENT_WORKFLOW.md` and `docs/TESTING_STRATEGY.md` for full policies.
