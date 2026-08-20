# Workspace-Wide Member Claiming for Parallel Bulk Operations

## Overview

Enable multiple agents/users belonging to the same workspace to work in parallel
when performing bulk member operations.

When one agent selects members from a source group for a bulk-add operation,
those members must immediately become held/claimed for that agent's operation.
Other agents in the same workspace must not be able to select or claim those
same members until the claim is released, expires, or the operation completes.

The goal is to allow multiple workspace agents to safely process different
members of the same source group in parallel without duplicate work.

## Problem

Currently, multiple agents in the same workspace may be able to select the
same group members for bulk operations.

Example:

Agent A selects:

- Member 1
- Member 2
- Member 3

At the same time, Agent B can see and select the same members.

This creates duplicate work and race conditions during bulk operations.

## Goals

1. Allow multiple workspace agents to process members concurrently.
2. Ensure a member can only be actively claimed by one agent/operation at a time.
3. Make claims workspace-aware.
4. Prevent other agents from selecting already-claimed members.
5. Clearly show which members are currently held by another agent.
6. Automatically release abandoned claims.
7. Release claims when an operation finishes or is cancelled.
8. Prevent race conditions at the backend/database level.
9. Preserve the existing bulk-add workflow where possible.

## Non-Goals

- Redesigning workspace membership.
- Redesigning agent authentication.
- Changing Telegram group membership behavior.
- Permanently locking members.
- Preventing the same member from participating in unrelated future operations
  when no active claim exists.
- Implementing distributed locking outside the application/database.

## Terminology

### Agent

A user/account operating inside a workspace.

### Claim

A temporary reservation of a source-group member by an agent's bulk operation.

### Held Member

A member that currently has an active claim.

### Operation

A bulk operation initiated by an agent, such as adding selected members to
a target group.

## Functional Requirements

### FR-1 Workspace Isolation

Claims must be isolated by workspace.

A claim created by Agent A in Workspace A must not block the same member from
operations performed by users in Workspace B.

### FR-2 Member Claiming

When an agent selects members for a bulk operation, the backend must claim
those members for the operation.

A successful claim must contain at minimum:

- workspace_id
- source_group_id
- member_id
- operation_id
- claimed_by_agent_id
- claimed_at
- expires_at
- status

### FR-3 Atomic Claim

Claim creation must be atomic.

If two agents attempt to claim the same member simultaneously, exactly one
claim must succeed.

The second agent must receive an indication that the member is already held.

The frontend alone must not be responsible for enforcing exclusivity.

### FR-4 Selection Filtering

When Agent B loads/selects members from a source group, members with an active
claim belonging to another agent must not be selectable.

They may remain visible for transparency, but must appear as unavailable/held.

### FR-5 Own Claims

An agent must be able to see members held by its own active operation and
continue working with them.

### FR-6 Other Agent Claims

Members held by another agent must display sufficient state to indicate that
they are currently being processed by another workspace agent.

Example:

    Held by Agent A

The exact amount of agent information shown should follow existing workspace
permission/privacy rules.

### FR-7 Bulk Claiming

Selecting 100 members must create claims for the selected members as part of
the bulk operation.

The system must handle partial conflicts safely.

Example:

- 80 members available
- 20 members already claimed

The operation must not accidentally claim the 20 conflicting members.

The UI must clearly report the result.

### FR-8 Claim Release

Claims must be released when:

1. The operation completes successfully.
2. The operation is cancelled.
3. The operation explicitly releases its selection.
4. The claim expires.
5. The operation fails and the members are eligible for retry.

### FR-9 Claim Expiration

Claims must have an expiration/lease mechanism.

If an agent disconnects, crashes, or abandons an operation, its members must
eventually become available again.

The expiration period must be configurable.

### FR-10 Concurrent Agents

Multiple agents must be able to process different members from the same
source group simultaneously.

Example:

    Agent A → Members 1-100
    Agent B → Members 101-200
    Agent C → Members 201-300

All three operations must be allowed to proceed concurrently.

### FR-11 Duplicate Prevention

The system must prevent two active operations in the same workspace from
successfully claiming the same source-group member at the same time.

### FR-12 Backend Enforcement

All claim validation must be enforced by backend/database logic.

A malicious or outdated frontend request must not allow an agent to operate
on a member that is currently claimed by another agent.

### FR-13 Operation Ownership

Each claim must be associated with the operation that created it.

This allows the system to release or recover all claims belonging to an
operation.

### FR-14 Recovery

The system must safely recover stale claims after:

- browser closure
- agent logout
- workspace disconnection
- worker failure
- server restart
- interrupted bulk operation

## User Experience

### Available Member

```text
☐ John Doe
   Available
````

### Member Held by Current Agent

```text
☑ John Doe
   Selected by you
```

### Member Held by Another Agent

```text
☐ Jane Doe
   Held by another agent
```

The unavailable member must not be selectable.

### Conflict During Selection

If another agent claims a member between loading the member list and submitting
the operation, the backend must reject that member from the claim request.

The UI must refresh/update the member state and inform the agent.

## Acceptance Criteria

### AC-1

Given two agents in the same workspace,
when Agent A claims member X,
then Agent B cannot claim member X.

### AC-2

Given Agent A has claimed members 1-100,
when Agent B opens the same source group,
then members 1-100 are unavailable to Agent B.

### AC-3

Given Agent A has claimed members 1-100,
when Agent B selects members 101-200,
then Agent B can successfully claim and process them.

### AC-4

Given two agents attempt to claim member X at exactly the same time,
then only one claim succeeds.

### AC-5

Given Agent A completes its operation,
then its claims are released or transitioned to the appropriate final state.

### AC-6

Given Agent A abandons an operation,
then its claims eventually expire and become available.

### AC-7

Given a claim belongs to Workspace A,
then it does not block an equivalent operation in Workspace B.

### AC-8

Given Agent B submits a stale request containing a member claimed by Agent A,
then the backend rejects that member regardless of frontend state.

### AC-9

Given a bulk request contains both available and already-claimed members,
then the system does not steal or overwrite the existing claims.

### AC-10

Given multiple agents are processing different member sets,
then their operations can execute concurrently without duplicate member claims.

## Data Integrity

The implementation must provide a database-level mechanism that guarantees
active claim uniqueness.

The uniqueness boundary should prevent multiple active claims for the same:

```
workspace + source_group + member
```

combination.

The exact implementation may use a unique constraint/index or an equivalent
transaction-safe mechanism appropriate to the existing database architecture.

## Observability

The system should make it possible to determine:

* who claimed a member
* which operation owns the claim
* when it was claimed
* when it expires
* whether it completed
* whether it was released
* whether it expired

Logs should include operation/claim identifiers where appropriate.

## Security

A user must only be able to manipulate claims belonging to their authorized
workspace.

An agent must not be able to:

* release another workspace's claim
* overwrite another agent's claim
* claim members outside its workspace
* modify an operation it does not own

## Performance

The implementation must support large bulk selections without creating
one expensive request per member.

Bulk claim creation should use efficient batch/database operations where
supported by the existing architecture.

The solution must not require locking the entire source group while a bulk
operation is running.

## Backward Compatibility

Existing single-agent bulk operations should continue to work.

If no competing agent exists, the normal workflow should remain effectively
unchanged from the user's perspective.

## Definition of Done

* Backend claim model/storage implemented.
* Atomic claim acquisition implemented.
* Claim release implemented.
* Claim expiration/recovery implemented.
* Bulk selection integrates with claims.
* Frontend displays held/unavailable members.
* Backend prevents conflicting operations.
* Workspace isolation verified.
* Concurrent operations tested.
* Failure/recovery scenarios tested.
* Documentation updated.