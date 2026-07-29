# Feature Management & Entitlement Systems — Research & Data Model

## Sources

- **LaunchDarkly**: [Flag hierarchy & prerequisites](https://docs.launchdarkly.com/guides/flags/flag-hierarchy), [Flag lifecycle stages](https://docs.launchdarkly.com/home/flags/flag-status), [Creating flags](https://docs.launchdarkly.com/home/flags/new), [Environments](https://docs.launchdarkly.com/home/account/environment), [Get feature flag API](https://docs.launchdarkly.com/api/feature-flags/get-feature-flag)
- **GitHub**: [Enterprise accounts](https://docs.github.com/en/enterprise-cloud@latest/admin/overview/about-enterprise-accounts), [Budgets & alerts](https://docs.github.com/en/billing/concepts/budgets-and-alerts), [Product usage per plan](https://docs.github.com/en/billing/reference/product-usage-included), [How billing works](https://docs.github.com/en/billing/managing-billing-for-your-github-account/about-billing-for-github-accounts)
- **Slack**: [Entitlements API (Slack platform)](https://api.slack.com/docs/entitlements)

---

## Key Patterns Observed

### 1. Feature Catalog / Registry

**LaunchDarkly** models features as flags with:
- `key` (immutable, used in code)
- `name` (human-readable, mutable)
- `kind` (boolean | multivariate)
- `temporary` (vs permanent — maps to lifecycle intent)
- `tags` (free-form categorisation)
- `customProperties` (extensible metadata — e.g. Jira issue links)
- `templates` (release, kill-switch, experiment, migration — encodes *purpose*)
- `maintainerId` / `maintainerTeamKey` (ownership)
- `variations` (typed values the flag can return)
- `environments` map (per-environment config, targeting, rollout)

**Key insight**: Features are versioned via `_version` integer (optimistic locking). No separate version table.

### 2. Feature-to-Plan Mapping (No Booleans on User Records)

Instead of storing `has_feature_x = true` on user rows:
- **GitHub** uses a **plan→allowance** table: one row per (plan, product, usage_type) with an included amount. Entitlement is derived by joining the account's plan to this table.
- **LaunchDarkly** attaches features to **projects** and controls access via **RBAC roles**, not per-user toggles.
- **Slack** uses an **entitlement** entity — a many-to-many join between (team/org) and (feature SKU) with `limit` and `period` fields.

**Pattern**: feature_access is a **derived** property computed from:
```
plan → plan_feature_associations (with limits) → feature definitions
```

No per-user boolean columns. Overrides are stored as **explicit entitlement records** (not column values).

### 3. Dependency Modeling

**LaunchDarkly prerequisites**:
- Flag A declares Flag B as a prerequisite with a required variation
- Multiple prereqs = AND
- Circular deps are rejected server-side
- Prerequisite flags cannot be deleted while dependents exist
- Dependencies are evaluated first in the evaluation sequence
- Environment-specific: prereqs can differ per environment

### 4. Resource Limits

**GitHub budgets model** is the reference:
- **Hard limit** ("Stop usage when budget limit is reached") — blocks further usage
- **Soft limit** (budget with alerts at 75%, 90%, 100%) — warns but allows
- **Included usage alerts** at 90% and 100% of plan allowance
- **Product-usage matrix**: each plan has a table of (product, usage_type, allowed_amount)
- **Scope**: budget can apply to whole account, org, cost center, user, or repo
- **Tiered**: personal account / team / enterprise have different base allowances

Limit types observed:
| Type | Description | Example |
|------|-------------|---------|
| `hard` | Hard ceiling, blocks action | GitHub Actions budget stop |
| `soft` | Warns but allows overage | 75%/90%/100% budget alerts |
| `plan_included` | Free allowance in plan | 2000 Actions min/month (Free) |
| `overage` | Post-allowance per-unit charge | $0.008/min after free mins |

### 5. Billing Metrics

**GitHub billing categories**:
| Metric | Unit | Scope |
|--------|------|-------|
| Actions minutes | minutes/month | per-org |
| Actions storage | GB/month | per-org |
| Codespaces core hours | hours/month | per-user |
| Codespaces storage | GB/month | per-user |
| Packages storage | GB | per-org |
| Packages bandwidth | GB/month | per-org |
| LFS storage | GB | per-org |
| LFS bandwidth | GB/month | per-org |
| Copilot | per-seat/month | per-user |
| Secret protection | flat/month | per-org |
| Enterprise | per-seat/month | per-account |

### 6. Rollout Flags

**LaunchDarkly rollout model**:
- `percentage` rollout with weighted variations
- `seed` for deterministic bucketing
- `bucketBy` attribute for consistent assignment
- `individualTargeting` for specific users/contexts
- Per-environment targeting rules
- Flag states: `off` → `on` with gradual percentage increase
- `fallthrough` variation for unmatched contexts
- `offVariation` default when targeting is disabled

**Lifecycle stages** (automatic + manual):
| Stage | Trigger |
|-------|---------|
| Live | Created <30d or permanent or Active status |
| Ready for code removal | Launched in all critical envs, ≥30d, has code refs |
| Ready to archive | Inactive, no code refs, not a prereq |
| Deprecated | Manually marked (still serving to old clients) |
| Archived | Manually archived (not serving) |
| Deleted | Removed after archive |

### 7. Feature Visibility Controls

**LaunchDarkly flag statuses** (per-environment):
- `New` — created <7d ago, never evaluated
- `Active` — being evaluated, multiple variations, modified <7d ago, or toggled off
- `Launched` — serving one variation, stable for ≥7d
- `Inactive` — not evaluated for ≥7d

Together with `temporary`/`permanent` classification and `deprecated`/`archived` booleans, this gives a full visibility spectrum: **internal → beta → GA → deprecated**.

---

## Proposed Data Model

```sql
-- ============================================================
-- 1. FEATURE CATALOG (aka feature registry)
-- ============================================================
CREATE TABLE features (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key             VARCHAR(128) NOT NULL UNIQUE,  -- immutable, used in code
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    kind            VARCHAR(16) NOT NULL DEFAULT 'boolean'
                    CHECK (kind IN ('boolean','string','number','json')),

    -- Lifecycle
    visibility      VARCHAR(16) NOT NULL DEFAULT 'internal'
                    CHECK (visibility IN ('internal','beta','ga','deprecated','archived')),
    is_temporary    BOOLEAN NOT NULL DEFAULT TRUE,
    purpose         VARCHAR(32)  -- 'release','kill_switch','experiment','migration', NULL=mixed

    -- Ownership
    maintainer_id   UUID REFERENCES users(id),
    maintainer_team VARCHAR(128),

    -- Categorisation
    tags            JSONB NOT NULL DEFAULT '[]',
    metadata        JSONB NOT NULL DEFAULT '{}',  -- extensible custom properties

    -- Versioning
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_features_key ON features(key);

-- ============================================================
-- 2. FEATURE VARIATIONS (typed values a flag can serve)
-- ============================================================
CREATE TABLE feature_variations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id  UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    index       SMALLINT NOT NULL,  -- ordering within the flag
    name        VARCHAR(128),
    value       JSONB NOT NULL,     -- the actual value (true/false, string, number, object)
    is_default_on  BOOLEAN NOT NULL DEFAULT FALSE,
    is_default_off BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE UNIQUE INDEX idx_fv_feature_index ON feature_variations(feature_id, index);

-- ============================================================
-- 3. FEATURE DEPENDENCIES (prerequisite pattern à la LaunchDarkly)
-- ============================================================
CREATE TABLE feature_dependencies (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dependent_feature_id    UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    prerequisite_feature_id UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    required_variation_id   UUID REFERENCES feature_variations(id),
    -- Environment-scoped: NULL means all environments
    environment_id          UUID REFERENCES environments(id),

    CONSTRAINT chk_no_self_dep CHECK (dependent_feature_id != prerequisite_feature_id)
);

CREATE UNIQUE INDEX idx_fd_dep_prereq
    ON feature_dependencies(dependent_feature_id, prerequisite_feature_id, environment_id);

-- ============================================================
-- 4. PLANS (what customers buy)
-- ============================================================
CREATE TABLE plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key         VARCHAR(64) NOT NULL UNIQUE,  -- 'free', 'pro', 'team', 'enterprise'
    name        VARCHAR(128) NOT NULL,
    description TEXT,
    sort_order  INT NOT NULL DEFAULT 0,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. PLAN-FEATURE ASSOCIATIONS (entitlements per plan)
-- Replaces boolean columns on user records.
-- ============================================================
CREATE TYPE limit_period AS ENUM ('monthly', 'yearly', 'one_time', 'lifetime');

CREATE TABLE plan_features (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id         UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,

    -- Whether this plan has this feature at all (gate)
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,

    -- Rollout override pin (optional): force a specific variation
    pinned_variation_id UUID REFERENCES feature_variations(id),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_id, feature_id)
);

-- ============================================================
-- 6. RESOURCE LIMITS (per plan-feature, with hard/soft/threshold)
-- ============================================================
CREATE TABLE feature_limits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_feature_id UUID NOT NULL REFERENCES plan_features(id) ON DELETE CASCADE,
    metric_key      VARCHAR(64) NOT NULL,  -- 'messages_per_month','seats','storage_gb','api_calls_per_day'

    -- Limit values
    hard_limit      BIGINT,       -- absolute ceiling; NULL = unlimited
    soft_limit      BIGINT,       -- warning threshold; NULL = no warning
    plan_included   BIGINT,       -- what's included in plan price; NULL = N/A

    -- Warning thresholds (percentage of soft_limit or plan_included)
    warn_at_pct     INT[] NOT NULL DEFAULT '{75,90,100}',

    -- Grace: extra amount above hard_limit allowed temporarily
    grace_amount    BIGINT NOT NULL DEFAULT 0,
    grace_period    INTERVAL,     -- e.g. '7 days'; NULL = no grace period

    period          limit_period NOT NULL DEFAULT 'monthly',
    unit_label      VARCHAR(64),  -- 'messages', 'GB', 'seats', 'requests'

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (plan_feature_id, metric_key)
);

-- ============================================================
-- 7. BILLING METERS (usage tracking units)
-- ============================================================
CREATE TABLE billing_meters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key             VARCHAR(64) NOT NULL UNIQUE,  -- 'messages','seats','storage_gb'
    name            VARCHAR(128) NOT NULL,
    unit_label      VARCHAR(64) NOT NULL,          -- 'per message', 'per seat/month', 'per GB/month'
    aggregation     VARCHAR(16) NOT NULL DEFAULT 'sum'
                    CHECK (aggregation IN ('sum','max','count_distinct','latest')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. BILLING METER → FEATURE associations
-- Which meter(s) a feature consumes
-- ============================================================
CREATE TABLE feature_meters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    meter_id        UUID NOT NULL REFERENCES billing_meters(id) ON DELETE CASCADE,
    conversion_factor NUMERIC(20,6) NOT NULL DEFAULT 1.0,  -- e.g. 1 message = 1.0 units
    UNIQUE (feature_id, meter_id)
);

-- ============================================================
-- 9. ACCOUNT / SUBSCRIPTION (tenant)
-- ============================================================
CREATE TABLE accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    plan_id         UUID NOT NULL REFERENCES plans(id),
    -- Current subscription period
    billing_period_start DATE NOT NULL,
    billing_period_end   DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 10. EXPLICIT OVERRIDES (for plan exceptions / add-ons)
-- Not booleans on user records — separate entitlement rows.
-- ============================================================
CREATE TABLE account_feature_overrides (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,

    -- Override: enable a feature not in plan, or disable one that is
    is_enabled      BOOLEAN NOT NULL,

    -- Override specific limits for this account
    override_limits JSONB,  -- [{metric_key: "messages", hard_limit: 50000, soft_limit: 40000, ...}]

    -- Override pinned variation
    pinned_variation_id UUID REFERENCES feature_variations(id),

    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, feature_id)
);

-- ============================================================
-- 11. ROLLOUT CONFIGURATIONS (phased / percentage-based)
-- Like LaunchDarkly's per-environment targeting.
-- ============================================================
CREATE TABLE rollout_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    environment_id  UUID REFERENCES environments(id),  -- NULL = all envs

    -- Targeting
    context_key     VARCHAR(128),       -- 'account_id','user_id','org_id'
    context_values  JSONB,              -- specific keys to target
    percentage      NUMERIC(5,2),       -- 0.00 to 100.00

    -- Which variation to serve
    variation_id    UUID NOT NULL REFERENCES feature_variations(id),

    -- Bucketing
    seed            INTEGER,
    bucket_by       VARCHAR(128),       -- attribute used for consistent bucketing

    priority        INT NOT NULL DEFAULT 0,  -- evaluation order
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 12. FEATURE FLAG STATES (per environment)
-- ============================================================
CREATE TABLE feature_states (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_id      UUID NOT NULL REFERENCES features(id) ON DELETE CASCADE,
    environment_id  UUID NOT NULL REFERENCES environments(id) ON DELETE CASCADE,

    is_on           BOOLEAN NOT NULL DEFAULT FALSE,
    off_variation_id UUID REFERENCES feature_variations(id),

    UNIQUE (feature_id, environment_id)
);

-- ============================================================
-- VIEW: derived feature entitlement for an account
-- ============================================================
CREATE VIEW account_entitlements AS
SELECT
    a.id AS account_id,
    f.id AS feature_id,
    f.key AS feature_key,
    f.visibility,
    COALESCE(afo.is_enabled, pf.is_enabled) AS is_enabled,
    COALESCE(afo.pinned_variation_id, pf.pinned_variation_id) AS pinned_variation_id,
    -- Merge limits: override wins, otherwise plan default
    COALESCE(afo.override_limits,
             (SELECT jsonb_agg(jsonb_build_object(
                 'metric_key', fl.metric_key,
                 'hard_limit', fl.hard_limit,
                 'soft_limit', fl.soft_limit,
                 'plan_included', fl.plan_included,
                 'grace_amount', fl.grace_amount,
                 'grace_period', fl.grace_period,
                 'period', fl.period,
                 'warn_at_pct', fl.warn_at_pct
             ))
              FROM feature_limits fl
              WHERE fl.plan_feature_id = pf.id
             )) AS limits
FROM accounts a
JOIN plan_features pf ON pf.plan_id = a.plan_id
JOIN features f ON f.id = pf.feature_id
LEFT JOIN account_feature_overrides afo
    ON afo.account_id = a.id AND afo.feature_id = f.id
WHERE (afo.is_enabled IS NOT NULL OR pf.is_enabled = true)
  AND (afo.expires_at IS NULL OR afo.expires_at > now());
```

## Usage Patterns

### Checking if an account can use a feature
```python
entitlement = account_entitlements.get(account_id, feature_key)
if not entitlement.is_enabled:
    raise FeatureNotAvailable(feature_key)

# If feature has dependencies, check those too
deps = feature_dependencies.get(feature_id, environment_id)
for dep in deps:
    dep_ent = account_entitlements.get(account_id, dep.feature_key)
    if not dep_ent.is_enabled or dep_ent.pinned_variation_id != dep.required_variation_id:
        raise DependencyNotMet(dep.prerequisite_feature_key)
```

### Checking a resource limit
```python
limit = entitlement.limits.get('messages_per_month')
current_usage = usage_repo.get(account_id, 'messages', period='monthly')
if limit.hard_limit and current_usage >= limit.hard_limit:
    if limit.grace_amount and limit.grace_period:
        grace_used = grace_repo.get(account_id, 'messages')
        if current_usage <= limit.hard_limit + limit.grace_amount:
            pass  # within grace
        else:
            raise QuotaExceeded('messages', limit.hard_limit + limit.grace_amount)
    else:
        raise QuotaExceeded('messages', limit.hard_limit)
elif limit.soft_limit and current_usage >= limit.soft_limit:
    emit_warning('approaching limit', current_usage, limit.soft_limit)
```

### Gradual rollout (percentage-based)
```python
rules = rollout_rules.get_active(feature_id, account.environment)
for rule in sorted(rules, key=lambda r: r.priority):
    if rule.context_key and account.id in rule.context_values:
        return rule.variation_id
    if rule.percentage:
        bucket = consistent_hash(account.id, rule.seed, rule.bucket_by)
        if bucket < rule.percentage:
            return rule.variation_id
return default_off_variation
```

---

## Key Design Decisions

1. **No booleans on user/account records.** Entitlement is a derived join: `account.plan → plan_features → features`. Overrides are separate rows, not new columns.
2. **Dependencies are first-class.** `feature_dependencies` with environment scoping, cycle detection at write time.
3. **Limits are JSON-encodable but have a structured base table.** `feature_limits` stores typed values; `account_feature_overrides.override_limits` allows full override per account as JSON for flexibility.
4. **Feature variations are separate rows.** Enables different plans to pin different defaults without forking the feature definition.
5. **Rollout rules are decoupled from feature definitions.** A feature exists independently; rollout rules control *how* it's served per environment.
6. **Grace periods prevent hard failures.** A grace of 10% for 7 days gives users time to upgrade before being blocked.
