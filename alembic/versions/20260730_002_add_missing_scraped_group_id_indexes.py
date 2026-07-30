"""Add missing indexes on scraped_members.scraped_group_id and scraped_messages.scraped_group_id

The `index=True` on the ForeignKey columns in the model was not included in
the hand-written initial migration (20260413_0013_add_scraper_tables.py), so
these indexes were never created. Without them, COUNT queries on the
scraped_members (~50k rows) and scraped_messages (~1.1M rows) tables do a
full sequential scan each time the scraper group info card is loaded.

Revision ID: 20260730_002
Revises: 20260730_001
Create Date: 2026-07-30
"""

from typing import Sequence, Union

from alembic import op


revision: str = "20260730_002"
down_revision: Union[str, None] = "20260730_001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_scraped_members_scraped_group_id",
        "scraped_members",
        ["scraped_group_id"],
        if_not_exists=True,
    )
    op.create_index(
        "ix_scraped_messages_scraped_group_id",
        "scraped_messages",
        ["scraped_group_id"],
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_index("ix_scraped_members_scraped_group_id", table_name="scraped_members", if_exists=True)
    op.drop_index("ix_scraped_messages_scraped_group_id", table_name="scraped_messages", if_exists=True)
