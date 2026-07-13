# Implementation Plan: Repository Audit Process — Comprehensive Codebase Assessment

**Branch**: `007-repository-audit-process` | **Date**: 2026-07-03 | **Spec**: `specs/007-repository-audit-process/spec.md`

**Input**: Feature specification from `specs/007-repository-audit-process/spec.md`

## Summary

Define a repeatable, multi-phase repository audit process that any AI agent can execute to produce a comprehensive production readiness assessment. The audit covers 19 phases organized into 3 priority tiers, produces structured output (finding tables, debt register, risk register, scorecard, roadmap), and is strictly read-only.

## Technical Context

**Language/Version**: Language-agnostic — the audit process adapts to any codebase language

**Primary Tools**: File reading (read), content search (grep/ripgrep), file pattern matching (glob), git log, bash for line counting and structural analysis

**Storage**: Output written to `docs/audits/AUDIT_REPORT_<timestamp>.md` — no database needed

**Testing**: The audit process is self-validating — each phase has acceptance scenarios that verify the output

**Target Platform**: Works in any environment with a filesystem and a capable AI agent

**Project Type**: Meta-process — this spec defines how to audit any repository, not code to be written

**Performance Goals**: Complete audit of 100k-line codebase in under 30 minutes

**Constraints**: Strictly read-only — no file modifications. All output goes to a single report file. Findings require file:line evidence.

**Scale/Scope**: The audit process works for any codebase of any size. The 19 phases are designed to be executed sequentially but can be parallelized.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Security & Secrets | ✅ Pass | Audit is read-only — no secrets touched. Findings may identify security issues. |
| II. Code Quality | ✅ Pass | Audit process itself follows spec conventions. Output is structured and evidence-based. |
| III. Testing Standards | ✅ Pass | Each phase has acceptance scenarios for self-validation. |
| IV. UX Consistency | ✅ Pass | Output follows a consistent report template across all phases. |
| V. Performance | ✅ Pass | Audit is designed to complete in <30 min for 100k lines. |
| VI. Async-First | ✅ Pass | Agents can parallelize independent phases. |
| VII. Containerized | ✅ Pass | Works in any environment — no container needed. |
| VIII. Observability | ✅ Pass | The audit itself produces observability assessment. |

## Project Structure

### Documentation (this feature)

```text
specs/007-repository-audit-process/
├── spec.md              # Feature specification — 19 user stories
├── plan.md              # This file
└── tasks.md             # Implementation tasks
```

### Output

```text
docs/audits/
└── AUDIT_REPORT_<timestamp>.md   # Generated audit report
```

## Audit Execution Workflow

### Phase Execution Order

The 19 phases are designed to be executed in a specific order to maximize efficiency:

```
Phase 1: Product Review (P3)        ─┐
Phase 2: Repo Structure (P2)       ──┤── parallel group 1 (structure + product)
                                      │
Phase 3: Architecture (P2)          ──┤
Phase 4: Code Quality (P2)         ──┤── parallel group 2 (code analysis)
                                      │
Phase 5: AI Engineering (P2)       ──┤
Phase 6: API Review (P2)           ──┤
Phase 7: Database Review (P2)      ──┤
                                      │
Phase 8: Security (P1)             ──┤
Phase 9: CI/CD (P1)                ──┤── parallel group 3 (production safety)
Phase 10: Docker & Infra (P1)      ──┤
                                      │
Phase 11: Performance (P2)         ──┤
Phase 12: Observability (P1)       ──┤── parallel group 4 (operations)
                                      │
Phase 13: Testing (P2)             ──┤
Phase 14: Documentation (P3)       ──┤
Phase 15: Developer Experience (P3)──┤── parallel group 5 (quality)
                                      │
Phase 16: Scalability (P3)         ──┘
                                      │
Phase 17: Tech Debt Register       ──┐
Phase 18: Risk Register            ──┤── sequential (depends on all prior phases)
Phase 19: Production Scorecard     ──┤
Phase 19: Roadmap                  ──┘
```

### Key Design Decisions

1. **Read-only constraint**: The audit MUST NOT modify any files. This is enforced by using only read tools (Read, Grep, Glob, Bash for git log and line counts). No edit/write tools used until the final output report.

2. **File:line evidence**: Every finding must reference specific file paths and line numbers. This enables immediate actionability — developers can navigate directly to the issue.

3. **Severity classification**: Security findings use Critical/High/Medium/Low based on CVSS-like criteria: exploitability, impact, and likelihood. Technical debt uses the same scale but weighted toward maintainability impact.

4. **Parallelization**: Independent phases can run in parallel. The 5 parallel groups above allow a team of agents to complete the audit in ~1/5 the time. A single agent runs them sequentially.

5. **Output structure**: The report follows a consistent format: Executive Summary → 19 phase sections → Consolidated Registers → Scorecard → Roadmap → Final Verdict. This mirrors the phase execution order.

6. **Self-validation**: Each phase has acceptance scenarios. Before marking a phase complete, the agent verifies its output against these scenarios. Missing evidence means the phase is not done.

### Search Patterns Reference

The agent should use these patterns during audit:

| Audit Dimension | Search Pattern | Tool |
|----------------|---------------|------|
| Unauthenticated endpoints | `router.(get|post|put|delete|patch)` near `def` with no `Depends` auth | Grep |
| Secrets in code | `api_key`, `password`, `secret`, `token`, `sk-` (OpenAI key prefix) | Grep |
| Hardcoded credentials | `user.*=.*postgres`, `password.*=.*postgres` | Grep |
| Deprecated APIs | `utcnow()`, `utcfromtimestamp()` | Grep |
| Raw SQL queries | `text(`, `execute(`, `raw_connection` | Grep |
| SSRF vectors | `httpx.AsyncClient(`, `aiohttp.ClientSession(` + user-provided URL | Grep |
| Root containers | `USER` directive absent in Dockerfile | Grep |
| Missing healthchecks | `HEALTHCHECK` absent in Dockerfile | Grep |
| Code duplication | Similar code blocks across different files | Manual analysis |
| Large files | Files over 500 lines | Bash `wc -l` |
| Missing indexes | Model definition without `Index` or `index=True` | Grep model files |
| Missing pagination | Route handlers returning lists without `page`/`limit`/`offset` params | Grep router files |
| GOD classes | Files over 500 lines | Bash `wc -l` on all Python files |
