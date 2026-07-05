"""backfill NULL rate limits on agents with defaults

Revision ID: 20260705_rate_limit_defaults
Revises: 20260705_auto_broadcast
Create Date: 2026-07-05
"""
from typing import Sequence, Union

from alembic import op


revision: str = "20260705_rate_limit_defaults"
down_revision: Union[str, tuple[str, ...]] = "7ccff1383072"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "UPDATE agents SET max_actions_per_hour = 50 WHERE max_actions_per_hour IS NULL"
    )
    op.execute(
        "UPDATE agents SET max_messages_per_day = 200 WHERE max_messages_per_day IS NULL"
    )
    op.execute(
        "UPDATE agents SET min_delay_seconds = 30.0 WHERE min_delay_seconds IS NULL"
    )
    op.execute(
        "UPDATE agents SET cooldown_minutes = 60 WHERE cooldown_minutes IS NULL"
    )


def downgrade() -> None:
    pass
