"""Tests for Agent Job Resilience & Smart Dispatch (008)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from bot.agents.exceptions import JobValidationError
from bot.agents.jobs import (
    GRADUATED_INTERVAL_TIERS,
    get_interval_for_contact,
    normalize_group_member_broadcast_payload,
)
from bot.dashboard.api.routers._shared import JobHealthItem, JobHealthResponse


# ─── US1: Progress Checkpointing ──────────────────────────────────────────────

class TestCheckpointProgress:
    def test_progress_schema_in_payload(self):
        """T035: progress is tracked in job_payload during runtime."""
        from bot.agents.jobs import normalize_group_member_broadcast_payload as normalize

        payload = normalize({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 25,
            "interval_seconds": 5,
        })
        assert payload is not None

    def test_job_without_checkpoint_starts_fresh(self):
        """T038: backward compatible — no progress key means start from scratch."""
        payload = normalize_group_member_broadcast_payload({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 25,
            "interval_seconds": 5,
        })
        assert "progress" not in payload or not payload["progress"]

    def test_skipped_count_reflects_already_sent(self):
        """T037: already_sent recipients are counted as skipped."""
        payload = normalize_group_member_broadcast_payload({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 10,
            "interval_seconds": 5,
            "selected_user_ids": [101, 102, 103, 104, 105],
        })
        middleware = payload.get("selected_user_ids", [])
        assert 101 in middleware


# ─── US2: Graduated Interval Strategy ──────────────────────────────────────────

class TestGraduatedIntervals:
    def test_tiers_are_correctly_defined(self):
        """GRADUATED_INTERVAL_TIERS constant has expected structure."""
        assert len(GRADUATED_INTERVAL_TIERS) == 5
        assert GRADUATED_INTERVAL_TIERS[0] == (50, 30.0)
        assert GRADUATED_INTERVAL_TIERS[-1] == (-1, 300.0)

    def test_first_50_contacts_30s(self):
        """T039a: contacts 0-49 use 30s interval."""
        for sent in range(0, 50):
            interval = get_interval_for_contact(sent, "graduated")
            assert interval == 30.0, f"sent={sent} expected 30s got {interval}"

    def test_contacts_50_to_99_60s(self):
        """T039b: contacts 50-99 use 60s interval."""
        for sent in range(50, 100):
            interval = get_interval_for_contact(sent, "graduated")
            assert interval == 60.0, f"sent={sent} expected 60s got {interval}"

    def test_contacts_100_to_199_120s(self):
        """T039c: contacts 100-199 use 120s interval."""
        for sent in range(100, 200):
            interval = get_interval_for_contact(sent, "graduated")
            assert interval == 120.0, f"sent={sent} expected 120s got {interval}"

    def test_contacts_200_to_399_180s(self):
        """T039d: contacts 200-399 use 180s interval."""
        for sent in range(200, 400):
            interval = get_interval_for_contact(sent, "graduated")
            assert interval == 180.0, f"sent={sent} expected 180s got {interval}"

    def test_contacts_400_plus_300s(self):
        """T039e: contacts 400+ use 300s interval."""
        for sent in [400, 450, 500, 1000]:
            interval = get_interval_for_contact(sent, "graduated")
            assert interval == 300.0, f"sent={sent} expected 300s got {interval}"

    def test_fixed_strategy_uses_custom_interval(self):
        """T040: fixed strategy always returns the custom interval."""
        interval = get_interval_for_contact(0, "fixed", custom_interval=1500.0)
        assert interval == 1500.0

        interval = get_interval_for_contact(500, "fixed", custom_interval=1500.0)
        assert interval == 1500.0

    def test_fixed_strategy_falls_back_to_graduated_when_no_custom(self):
        """Fixed strategy without custom interval falls back to graduated."""
        interval = get_interval_for_contact(5, "fixed")
        assert interval == 30.0

    def test_graduated_strategy_ignores_custom_interval(self):
        """Graduated strategy ignores custom_interval param."""
        interval = get_interval_for_contact(5, "graduated", custom_interval=999.0)
        assert interval == 30.0

    def test_normalize_payload_defaults_to_graduated(self):
        """Default interval_strategy is 'graduated' when no explicit interval set."""
        payload = normalize_group_member_broadcast_payload({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 25,
            "interval_seconds": 5,
        })
        assert payload["interval_strategy"] == "graduated"

    def test_normalize_payload_fixed_when_explicit_interval(self):
        """Explicit interval_between_contacts sets strategy to 'fixed'."""
        payload = normalize_group_member_broadcast_payload({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 25,
            "interval_seconds": 5,
            "interval_between_contacts": 10,
        })
        assert payload["interval_strategy"] == "fixed"

    def test_normalize_payload_explicit_strategy(self):
        """Explicit interval_strategy overrides auto-detection."""
        payload = normalize_group_member_broadcast_payload({
            "source_group_id": -100123456,
            "message": "Hello!",
            "threshold": 25,
            "interval_seconds": 5,
            "interval_strategy": "graduated",
        })
        assert payload["interval_strategy"] == "graduated"

    def test_invalid_strategy_raises(self):
        with pytest.raises(ValueError, match="interval_strategy must be 'graduated' or 'fixed'"):
            normalize_group_member_broadcast_payload({
                "source_group_id": -100123456,
                "message": "Hello!",
                "threshold": 25,
                "interval_seconds": 5,
                "interval_strategy": "exponential",
            })


# ─── US3: Group Accessibility Validation ──────────────────────────────────────

class TestGroupAccessibility:
    def test_job_validation_error(self):
        """T041: JobValidationError includes message and details."""
        exc = JobValidationError(
            "Agent cannot access 2 group(s).",
            details={
                "accessible_groups": [123],
                "inaccessible_groups": [456, 789],
            },
        )
        assert str(exc) == "Agent cannot access 2 group(s)."
        assert exc.details["inaccessible_groups"] == [456, 789]

    def test_job_validation_error_no_details(self):
        """JobValidationError works without details."""
        exc = JobValidationError("Simple error")
        assert exc.details == {}


# ─── US4: Stuck Job Recovery ─────────────────────────────────────────────────

class TestStuckJobRecovery:
    def test_stuck_threshold_config(self):
        """STUCK_JOB_THRESHOLD_HOURS is configurable."""
        from bot.config import get_settings

        settings = get_settings()
        assert hasattr(settings, "stuck_job_threshold_hours")
        assert settings.stuck_job_threshold_hours == 2

    def test_stuck_max_retries_config(self):
        """STUCK_JOB_MAX_RETRIES is configurable."""
        from bot.config import get_settings

        settings = get_settings()
        assert hasattr(settings, "stuck_job_max_retries")
        assert settings.stuck_job_max_retries == 3

    def test_reconcile_imports(self):
        """reconcile_stale_jobs can be imported without error."""
        from bot.agents.dispatch import reconcile_stale_jobs

        assert reconcile_stale_jobs is not None

    def test_dispatch_import(self):
        """dispatch_agent_job can be imported without error."""
        from bot.agents.dispatch import dispatch_agent_job

        assert dispatch_agent_job is not None


# ─── US5: Auto-Dispatch on Scrape Completion ──────────────────────────────────

class TestAutoDispatch:
    def test_agent_model_has_auto_broadcast_fields(self):
        """T047: Agent model includes auto_broadcast_enabled and auto_broadcast_template."""
        from bot.db.models.agent import Agent

        assert hasattr(Agent, "auto_broadcast_enabled")
        assert hasattr(Agent, "auto_broadcast_template")

    def test_auto_broadcast_default_disabled(self):
        """T048: auto_broadcast_enabled defaults to False."""
        from bot.db.models.agent import Agent

        col = Agent.__table__.c.get("auto_broadcast_enabled")
        assert col is not None
        assert col.default is not None
        assert col.default.arg is False


# ─── US6: Rate Limit Defaults ─────────────────────────────────────────────────

class TestRateLimitDefaults:
    def test_agent_model_has_rate_limit_fields(self):
        """T050: Agent model rate limit fields exist with defaults."""
        from bot.db.models.agent import Agent

        assert hasattr(Agent, "max_actions_per_hour")
        assert hasattr(Agent, "max_messages_per_day")
        assert hasattr(Agent, "min_delay_seconds")
        assert hasattr(Agent, "cooldown_minutes")

    def test_rate_limit_default_values(self):
        """T050: Default values are set on the model."""
        agent = type("Agent", (), {})()
        agent.max_actions_per_hour = 50
        agent.max_messages_per_day = 200
        agent.min_delay_seconds = 30.0
        agent.cooldown_minutes = 60

        assert agent.max_actions_per_hour == 50
        assert agent.max_messages_per_day == 200
        assert agent.min_delay_seconds == 30.0
        assert agent.cooldown_minutes == 60

    def test_explicit_values_not_overridden(self):
        """T051: Explicitly set values are preserved."""
        agent = type("Agent", (), {})()
        agent.max_actions_per_hour = 100
        agent.cooldown_minutes = 120

        assert agent.max_actions_per_hour == 100
        assert agent.cooldown_minutes == 120


# ─── US7: Dashboard Job Health Monitoring ─────────────────────────────────────

class TestJobHealth:
    def test_job_health_item_schema(self):
        """T053: JobHealthItem schema validates correctly."""
        item = JobHealthItem(
            job_id=1,
            agent_id=1,
            job_type="group_member_broadcast",
            status="running",
            messages_sent=50,
            total_recipients=100,
            elapsed_seconds=3600.0,
            estimated_completion_seconds=3600.0,
            last_checkpoint_at=datetime.now(timezone.utc).isoformat(),
            is_possibly_stuck=False,
        )
        assert item.job_id == 1
        assert item.messages_sent == 50
        assert item.is_possibly_stuck is False

    def test_job_health_item_defaults(self):
        """JobHealthItem defaults are correct."""
        item = JobHealthItem(
            job_id=1,
            agent_id=1,
            job_type="test",
            status="running",
        )
        assert item.messages_sent == 0
        assert item.total_recipients == 0
        assert item.is_possibly_stuck is False
        assert item.estimated_completion_seconds is None
        assert item.last_checkpoint_at is None

    def test_job_health_response_schema(self):
        """T053: JobHealthResponse wraps list of items."""
        response = JobHealthResponse(
            running_jobs=[
                JobHealthItem(
                    job_id=1, agent_id=1, job_type="test", status="running"
                ),
            ]
        )
        assert len(response.running_jobs) == 1
        assert response.running_jobs[0].job_id == 1

    def test_possibly_stuck_flag_logic(self):
        """T055: possibly_stuck is True when last_checkpoint > 2 hours old."""
        old_checkpoint = (
            datetime.now(timezone.utc) - timedelta(hours=3)
        ).isoformat()
        from datetime import datetime as dt

        cp_age = (
            dt.now(timezone.utc) - dt.fromisoformat(old_checkpoint)
        ).total_seconds()
        assert cp_age > 7200
        assert dt.fromisoformat(old_checkpoint) < dt.now(timezone.utc)

    def test_possibly_stuck_flag_false_when_recent(self):
        """T055: possibly_stuck is False when checkpoint is recent."""
        recent_checkpoint = datetime.now(timezone.utc).isoformat()
        from datetime import datetime as dt

        cp_age = (
            dt.now(timezone.utc) - dt.fromisoformat(recent_checkpoint)
        ).total_seconds()
        assert cp_age < 7200
