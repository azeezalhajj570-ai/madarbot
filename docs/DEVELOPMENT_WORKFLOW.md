# Development Workflow and Coding Rules

## Purpose
This document defines the required engineering workflow for MadarBot before code is committed, pushed, merged, or deployed.

## Core Principles
- Keep changes small and reviewable.
- Write tests for every behavior change.
- Prefer clear code over clever code.
- Never commit secrets.
- Never deploy untested code.
- Keep production deploys reproducible.
- Log operationally important behavior.
- Make failures visible and recoverable.

## Branching Workflow
Use short-lived branches from `main`.

Branch naming examples:
- `fix/lead-capture-deduplication`
- `feat/support-agent`
- `docs/agent-workflow`
- `test/task-service-regression`
- `chore/docker-healthcheck`

Rules:
- Do not commit directly to `main` unless it is an emergency hotfix.
- Open a pull request for every normal change.
- Keep each PR focused on one goal.
- Rebase or merge latest `main` before final validation.

## Commit Rules
Before every commit:
1. Review your diff.
2. Remove debug prints.
3. Remove temporary files.
4. Confirm no secrets are included.
5. Run the relevant tests.
6. Update docs when behavior changes.

Recommended commit format:

```text
<type>: <short description>
```

Types:
- `feat`: new feature
- `fix`: bug fix
- `test`: tests only
- `docs`: documentation only
- `chore`: maintenance
- `refactor`: internal code change without behavior change
- `perf`: performance improvement
- `ci`: CI/CD changes

Examples:
- `fix: persist bot lead capture records`
- `test: add task service lead capture regression tests`
- `docs: add agent deployment checklist`

## Pull Request Rules
Every PR should include:
- Summary of what changed
- Why it changed
- Testing performed
- Risk level
- Rollback plan for deploy-related changes

PR checklist:
- [ ] Code is focused and minimal
- [ ] Tests added or updated
- [ ] All tests pass locally or in CI
- [ ] Migrations tested if database changed
- [ ] `.env.example` updated if config changed
- [ ] No secrets committed
- [ ] Logs are structured and useful
- [ ] Deployment impact documented

## Required Tests Before Commit
Run the smallest useful test set before committing.

For Python backend changes:
```bash
pytest
```

For a focused test file:
```bash
pytest tests/path/to/test_file.py
```

For a single test:
```bash
pytest tests/path/to/test_file.py::test_name
```

For async/database changes, run the tests that cover:
- service layer
- database persistence
- migrations
- deduplication logic
- task execution

## Required Checks Before Push
Before pushing a branch, run:

```bash
git diff --check
pytest
```

Recommended when available:

```bash
ruff check .
ruff format --check .
mypy .
```

If frontend code exists, also run the relevant frontend checks:

```bash
npm test
npm run lint
npm run build
```

## Required Checks Before Merge
Before merging to `main`:
- All CI checks must pass.
- PR must be reviewed, unless it is a solo emergency hotfix.
- Database migrations must be tested from a clean database.
- Docker compose startup must be validated for deployment changes.
- Runtime logs must be checked after startup.

## Required Checks Before Deploy
Before deploying:

```bash
git status --short
git log --oneline -5
pytest
docker compose config
```

For Docker deploy changes:

```bash
docker compose build
docker compose up -d
docker compose ps
docker compose logs --tail=200 backend bot agent_worker
```

For database migrations:

```bash
alembic heads
alembic current
alembic upgrade head
```

After deployment, verify:
- API is reachable
- bot connects to Telegram
- agent session becomes healthy
- groups sync successfully
- lead_capture task triggers
- AgentLead rows are persisted
- no crash loop is present

## Rollback Rules
Every deploy should have a rollback plan.

Before deploy, record:
- current commit SHA
- database migration state
- current Docker image or build source

Rollback options:
- revert the commit
- redeploy the previous commit
- restore database backup if migration is destructive
- disable the feature flag if available

## Secrets Rules
Never commit:
- `.env`
- Telegram session files
- API keys
- bot tokens
- database passwords
- private keys
- production logs containing credentials

Use `.env.example` for templates only.

## Database Change Rules
For database changes:
- Add an Alembic migration.
- Test migration from a clean database.
- Test migration from an existing database.
- Add regression tests for service behavior.
- Avoid destructive migrations unless there is a backup and rollback plan.

Migration checklist:
- [ ] `alembic heads` shows expected heads
- [ ] `alembic upgrade head` succeeds
- [ ] downgrade path considered or documented
- [ ] app starts after migration
- [ ] affected queries tested

## Logging Rules
Use structured logs for important events.

Log:
- agent session state changes
- listener startup/shutdown
- group sync counts
- task execution events
- lead persistence events
- retry attempts
- permanent failures

Do not log:
- tokens
- secrets
- full environment variables
- raw credentials
- private session strings

## Error Handling Rules
- Fail fast on missing required config.
- Retry transient network failures.
- Do not retry validation errors forever.
- Log enough context to debug failures.
- Keep listener loops alive when individual messages fail.

## Code Review Rules
Reviewers should check:
- correctness
- security
- tests
- migration safety
- operational impact
- logging quality
- readability
- rollback plan

## Definition of Done
A change is done only when:
- code is implemented
- tests pass
- docs are updated
- config templates are updated if needed
- migrations are verified if needed
- deployment impact is understood
- PR is merged safely
