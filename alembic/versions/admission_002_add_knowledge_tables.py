"""add admission knowledge tables (universities, majors, cutoffs, faqs)

Revision ID: admission_002
Revises: admission_001
Create Date: 2026-07-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'admission_002'
down_revision: Union[str, None] = 'admission_001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'admission_universities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name_ar', sa.String(255), nullable=False),
        sa.Column('name_en', sa.String(255), nullable=True),
        sa.Column('aliases', sa.Text(), nullable=True),
        sa.Column('city', sa.String(128), nullable=True),
        sa.Column('country', sa.String(64), server_default='Saudi Arabia'),
        sa.Column('is_public', sa.Boolean(), server_default='true'),
        sa.Column('source_count', sa.Integer(), server_default='0'),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admission_universities_name_ar', 'admission_universities', ['name_ar'])

    op.create_table(
        'admission_majors',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name_ar', sa.String(255), nullable=False),
        sa.Column('name_en', sa.String(255), nullable=True),
        sa.Column('aliases', sa.Text(), nullable=True),
        sa.Column('category', sa.String(64), nullable=True),
        sa.Column('source_count', sa.Integer(), server_default='0'),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admission_majors_name_ar', 'admission_majors', ['name_ar'])

    op.create_table(
        'admission_cutoffs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('university_id', sa.Integer(), nullable=False),
        sa.Column('major_id', sa.Integer(), nullable=False),
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('source_message_id', sa.BigInteger(), nullable=True),
        sa.Column('source_group_id', sa.BigInteger(), nullable=True),
        sa.Column('confidence', sa.String(16), server_default='medium'),
        sa.Column('extracted_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(['university_id'], ['admission_universities.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['major_id'], ['admission_majors.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_admission_cutoffs_uni_major_year',
        'admission_cutoffs',
        ['university_id', 'major_id', 'year'],
    )
    op.create_index('ix_admission_cutoffs_university_id', 'admission_cutoffs', ['university_id'])
    op.create_index('ix_admission_cutoffs_major_id', 'admission_cutoffs', ['major_id'])

    op.create_table(
        'admission_faqs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('answer', sa.Text(), nullable=False),
        sa.Column('category', sa.String(64), nullable=True),
        sa.Column('frequency', sa.Integer(), server_default='1'),
        sa.Column('source_group_id', sa.BigInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_admission_faqs_question', 'admission_faqs', ['question'],
        postgresql_using='gin', postgresql_ops={'question': 'gin_trgm_ops'},
    )

    op.create_table(
        'admission_knowledge_extractions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(32), server_default='pending'),
        sa.Column('entity_type', sa.String(32), nullable=False),
        sa.Column('group_id', sa.BigInteger(), nullable=True),
        sa.Column('messages_scanned', sa.Integer(), server_default='0'),
        sa.Column('entities_found', sa.Integer(), server_default='0'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('admission_knowledge_extractions')
    op.drop_table('admission_faqs')
    op.drop_table('admission_cutoffs')
    op.drop_table('admission_majors')
    op.drop_table('admission_universities')
