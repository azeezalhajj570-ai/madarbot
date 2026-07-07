# Deployment Checklist

## Pre-Deploy
- [ ] Pull latest code
- [ ] Verify branch and commit SHA
- [ ] Run tests
- [ ] Review migrations
- [ ] Backup production database
- [ ] Confirm environment variables
- [ ] Verify Docker compose config
- [ ] Verify rollback plan

## Build Phase
```bash
docker compose build
```

## Startup Phase
```bash
docker compose up -d
```

## Verification Phase
```bash
docker compose ps
docker compose logs --tail=200
```

Verify:
- [ ] backend healthy
- [ ] bot healthy
- [ ] Redis healthy
- [ ] Postgres healthy
- [ ] agent session connected (state=healthy)
- [ ] agents show correct group count in dashboard
- [ ] owner dashboard shows scoped data (groups, agents, stats)
- [ ] flood wait countdown decreases over time (not stuck)
- [ ] no restart loop
- [ ] lead_capture works
- [ ] subscription endpoint returns 200

## Database Verification
```bash
alembic current
alembic heads
```

Verify:
- [ ] migrations reached head
- [ ] no migration conflicts
- [ ] DB queries working

## Runtime Verification
Verify logs contain:
- agent_session_state_changed
- agent_listener_started
- agent_groups_synced
- agent_message_received_for_task
- agent_groups_synced with per-agent count

Verify no repeated:
- connection failures
- migration errors
- crash loops
- auth failures
- request_validation_error on subscription endpoint (should be 200)

## Rollback Procedure
If deploy fails:
1. stop new deployment
2. revert to previous commit
3. redeploy stable version
4. restore DB backup if necessary
5. verify services healthy
