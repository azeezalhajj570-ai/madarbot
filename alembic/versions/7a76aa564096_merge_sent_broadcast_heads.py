"""merge sent_broadcast heads

Revision ID: 7a76aa564096
Revises: 20260512_0020, 0b752aab0c01
Create Date: 2026-05-13 22:55:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = "7a76aa564096"
down_revision = ("20260512_0020", "0b752aab0c01")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
