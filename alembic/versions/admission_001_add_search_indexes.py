"""add admission search indexes (pg_trgm, tsvector, GIN)

Revision ID: admission_001
Revises: 3732ae906737
Create Date: 2026-07-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import TSVECTOR

revision: str = 'admission_001'
down_revision: Union[str, None] = '3732ae906737'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Enable pg_trgm extension for Arabic fuzzy matching
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    # 2. Add tsvector column for full-text search
    op.add_column(
        'scraped_messages',
        sa.Column('search_vector', TSVECTOR(), nullable=True),
    )

    # 3. Backfill tsvector column for existing messages
    op.execute(
        "UPDATE scraped_messages SET search_vector = "
        "to_tsvector('arabic', coalesce(message_text, '')) "
        "WHERE search_vector IS NULL"
    )

    # 4. Make search_vector NOT NULL after backfill
    op.alter_column('scraped_messages', 'search_vector', nullable=False)

    # 5. Auto-maintain search_vector on future inserts/updates
    op.execute(
        "CREATE OR REPLACE FUNCTION scraped_messages_search_vector_update() "
        "RETURNS trigger AS $$ "
        "BEGIN "
        "  NEW.search_vector := to_tsvector('arabic', coalesce(NEW.message_text, '')); "
        "  RETURN NEW; "
        "END; "
        "$$ LANGUAGE plpgsql"
    )
    op.execute(
        "CREATE TRIGGER trg_scraped_messages_search_vector "
        "BEFORE INSERT OR UPDATE OF message_text ON scraped_messages "
        "FOR EACH ROW EXECUTE FUNCTION scraped_messages_search_vector_update()"
    )

    # 6. GIN index on tsvector for full-text search queries
    op.create_index(
        'ix_scraped_messages_search_vector_gin',
        'scraped_messages',
        ['search_vector'],
        postgresql_using='gin',
    )

    # 7. GIN trigram index on message_text for fuzzy/ILIKE fallback
    op.create_index(
        'ix_scraped_messages_text_trgm_gin',
        'scraped_messages',
        ['message_text'],
        postgresql_using='gin',
        postgresql_ops={'message_text': 'gin_trgm_ops'},
    )


def downgrade() -> None:
    op.drop_index('ix_scraped_messages_text_trgm_gin', table_name='scraped_messages')
    op.drop_index('ix_scraped_messages_search_vector_gin', table_name='scraped_messages')
    op.execute('DROP TRIGGER IF EXISTS trg_scraped_messages_search_vector ON scraped_messages')
    op.execute('DROP FUNCTION IF EXISTS scraped_messages_search_vector_update()')
    op.drop_column('scraped_messages', 'search_vector')
