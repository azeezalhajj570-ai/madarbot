"""make agents.group_id nullable and align constraints with the ORM model

The Agent ORM model (bot/db/models/agent.py) declares group_id as nullable
with FK ON DELETE SET NULL and a unique constraint on
(linked_by_user_id, external_account_id), but the DB schema still matches the
original 20260310_0002 migration: group_id NOT NULL, FK ON DELETE CASCADE and
unique (group_id, external_account_id).

Self-registered agents (browser login auto-link) are created without a group,
so every insert hit a NotNullViolationError on agents.group_id and the
Activate button never appeared in the dashboard.

Revision ID: 20260809_001
Revises: 20260808_001
Create Date: 2026-08-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260809_001"
down_revision: Union[str, None] = "20260808_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _group_id_fk(inspector) -> Union[dict, None]:
    for fk in inspector.get_foreign_keys("agents"):
        if fk.get("referred_table") == "groups":
            return fk
    return None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    group_id = next((c for c in inspector.get_columns("agents") if c["name"] == "group_id"), None)
    if group_id is not None and group_id.get("nullable") is False:
        op.alter_column("agents", "group_id", existing_type=sa.Integer(), nullable=True)

    fk = _group_id_fk(inspector)
    if fk:
        fk_name = fk.get("name")
        ondelete = fk.get("options", {}).get("ondelete")
        if ondelete != "SET NULL":
            op.drop_constraint(fk_name, "agents", type_="foreignkey")
            op.create_foreign_key(
                fk_name,
                "agents",
                "groups",
                ["group_id"],
                ["id"],
                ondelete="SET NULL",
            )

    constraints = {c["name"] for c in inspector.get_unique_constraints("agents")}
    if "uq_agent_group_external_account" in constraints:
        op.drop_constraint("uq_agent_group_external_account", "agents", type_="unique")
    if "uq_agent_linked_user_external_account" not in constraints:
        op.create_unique_constraint(
            "uq_agent_linked_user_external_account",
            "agents",
            ["linked_by_user_id", "external_account_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)

    constraints = {c["name"] for c in inspector.get_unique_constraints("agents")}
    if "uq_agent_linked_user_external_account" in constraints:
        op.drop_constraint("uq_agent_linked_user_external_account", "agents", type_="unique")
    if "uq_agent_group_external_account" not in constraints:
        op.create_unique_constraint(
            "uq_agent_group_external_account",
            "agents",
            ["group_id", "external_account_id"],
        )

    fk = _group_id_fk(inspector)
    if fk:
        fk_name = fk.get("name")
        op.drop_constraint(fk_name, "agents", type_="foreignkey")
        op.create_foreign_key(
            fk_name,
            "agents",
            "groups",
            ["group_id"],
            ["id"],
            ondelete="CASCADE",
        )

    group_id = next((c for c in inspector.get_columns("agents") if c["name"] == "group_id"), None)
    if group_id is not None and group_id.get("nullable") is True:
        op.alter_column("agents", "group_id", existing_type=sa.Integer(), nullable=False)
