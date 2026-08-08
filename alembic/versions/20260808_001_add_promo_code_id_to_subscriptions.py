"""add promo_code_id to subscriptions

The Subscription ORM model (bot/db/models/billing.py) references
promotion_codes via promo_code_id, but the column was never added to the
DB schema — SELECT on subscriptions therefore raised UndefinedColumnError
and broke /api/workspace (500).

Revision ID: 20260808_001
Revises: 20260730_003
Create Date: 2026-08-08

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260808_001"
down_revision: Union[str, None] = "20260730_003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "promo_code_id" not in {c["name"] for c in inspector.get_columns("subscriptions")}:
        op.add_column(
            "subscriptions",
            sa.Column("promo_code_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_subscriptions_promo_code_id_promotion_codes",
            "subscriptions",
            "promotion_codes",
            ["promo_code_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    if "promo_code_id" in {c["name"] for c in inspector.get_columns("subscriptions")}:
        op.drop_constraint("fk_subscriptions_promo_code_id_promotion_codes", "subscriptions", type_="foreignkey")
        op.drop_column("subscriptions", "promo_code_id")
