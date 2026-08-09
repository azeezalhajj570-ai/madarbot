"""make agent_notifications.group_id nullable

Self-linked agents (browser login auto-link) have no group, but
create_notification fell back to group_id=0 when no group was resolved.
agent_notifications.group_id is a NOT NULL FK to groups, so the insert
raised a ForeignKeyViolationError and broke POST /api/agents/{id}/member-adds
(500). Align the column with the ORM model so agent-level notifications can
exist without a group.

Revision ID: 20260809_002
Revises: 20260809_001
Create Date: 2026-08-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260809_002"
down_revision: Union[str, None] = "20260809_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    group_id = next(
        (c for c in inspector.get_columns("agent_notifications") if c["name"] == "group_id"), None
    )
    if group_id is not None and group_id.get("nullable") is False:
        op.alter_column("agent_notifications", "group_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    group_id = next(
        (c for c in inspector.get_columns("agent_notifications") if c["name"] == "group_id"), None
    )
    if group_id is not None and group_id.get("nullable") is True:
        op.alter_column("agent_notifications", "group_id", existing_type=sa.Integer(), nullable=False)
