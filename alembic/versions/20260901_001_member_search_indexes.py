"""member search composite indexes

Adds the composite indexes that back the dynamic member search EXISTS
subqueries, per-group member dedup and claim lookups. Indexes only — no schema
change. The full-text GIN indexes (search_vector + message_text trigram) were
added in admission_001 and are reused as-is.

Revision ID: 20260901_001
Revises: 20260818_002
Create Date: 2026-09-01

"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260901_001"
down_revision: str | None = "021_per_agent_members"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # EXISTS subquery scans: WHERE sender_user_id = ? AND tg_group_id IN (...) AND message_date >= ...
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraped_messages_group_sender_date "
        "ON scraped_messages (tg_group_id, sender_user_id, message_date)"
    )
    # Per-member aggregation (last active / message count) across all groups.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraped_messages_sender_date "
        "ON scraped_messages (sender_user_id, message_date)"
    )
    # Per-group member dedup by tg_user_id (visibility + member rows).
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraped_members_group_user "
        "ON scraped_members (tg_group_id, tg_user_id)"
    )
    # member.status / role filtering within a group scope.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_scraped_members_group_role "
        "ON scraped_members (tg_group_id, role)"
    )
    # Claim status EXISTS: active claims per tenant + member.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_member_claims_tenant_member_status "
        "ON member_claims (tenant_id, tg_user_id) WHERE status = 'active'"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_member_claims_tenant_member_status")
    op.execute("DROP INDEX IF EXISTS ix_scraped_members_group_role")
    op.execute("DROP INDEX IF EXISTS ix_scraped_members_group_user")
    op.execute("DROP INDEX IF EXISTS ix_scraped_messages_sender_date")
    op.execute("DROP INDEX IF EXISTS ix_scraped_messages_group_sender_date")
