"""Admission Intelligence domain models."""

from __future__ import annotations
from typing import Optional

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Index, Integer, String, Text, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from bot.db.base import Base


class AdmissionUniversity(Base):
    """Canonical university entity extracted from Telegram data."""

    __tablename__ = "admission_universities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    aliases: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    city: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    country: Mapped[str] = mapped_column(String(64), default="Saudi Arabia")
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    first_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_admission_universities_name_ar", "name_ar"),
    )


class AdmissionMajor(Base):
    """Canonical major/program entity."""

    __tablename__ = "admission_majors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(255), nullable=False)
    name_en: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    aliases: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True
    )  # medical, engineering, science, humanities
    source_count: Mapped[int] = mapped_column(Integer, default=0)
    first_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_admission_majors_name_ar", "name_ar"),
    )


class AdmissionCutoff(Base):
    """Extracted cutoff score for a university-major-year combination."""

    __tablename__ = "admission_cutoffs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    university_id: Mapped[int] = mapped_column(
        ForeignKey("admission_universities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    major_id: Mapped[int] = mapped_column(
        ForeignKey("admission_majors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    source_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    source_group_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    confidence: Mapped[str] = mapped_column(String(16), default="medium")
    extracted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    university: Mapped["AdmissionUniversity"] = relationship()
    major: Mapped["AdmissionMajor"] = relationship()

    __table_args__ = (
        Index("ix_admission_cutoffs_uni_major_year", "university_id", "major_id", "year"),
    )


class AdmissionFAQ(Base):
    """Extracted FAQ from repeated admission questions."""

    __tablename__ = "admission_faqs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    frequency: Mapped[int] = mapped_column(Integer, default=1)
    source_group_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        Index("ix_admission_faqs_question", "question", postgresql_using="gin"),
    )


class AdmissionKnowledgeExtraction(Base):
    """Tracks extraction runs for admission knowledge."""

    __tablename__ = "admission_knowledge_extractions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    entity_type: Mapped[str] = mapped_column(
        String(32), nullable=False
    )  # university, major, cutoff, faq
    group_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    messages_scanned: Mapped[int] = mapped_column(Integer, default=0)
    entities_found: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
