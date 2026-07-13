"""merge all parallel heads into one

Revision ID: 20260705_merge_heads
Revises: 20260511_0073, 20260516_add_campaigns, 20260616_cm01, 20260705_auto_broadcast, 20260705_message_id
Create Date: 2026-07-05

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20260705_merge_heads"
down_revision: Union[str, tuple[str, ...]] = (
    "20260511_0073",
    "20260516_add_campaigns",
    "20260616_cm01",
    "20260705_auto_broadcast",
    "20260705_message_id",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
