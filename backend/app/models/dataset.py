"""Persistent datasets and their reusable test cases."""

from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import JSON, CheckConstraint, ForeignKey, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now


class Dataset(Base):
    """A named collection of one or more evaluation test cases."""

    __tablename__ = "datasets"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    name_key: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, onupdate=utc_now
    )
    test_cases: Mapped[list["TestCase"]] = relationship(
        back_populates="dataset",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class TestCase(Base):
    """One traceable input and expected answer within a dataset."""

    __tablename__ = "test_cases"
    __table_args__ = (
        CheckConstraint(
            "case_type IN ('standard', 'security')",
            name="case_type_valid",
        ),
        CheckConstraint(
            "(case_type = 'standard' AND security_test_type IS NULL) OR "
            "(case_type = 'security' AND security_test_type IN "
            "('direct_prompt_injection', 'instruction_override', "
            "'system_prompt_extraction'))",
            name="security_type_consistent",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    dataset_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("datasets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    input: Mapped[str] = mapped_column(Text, nullable=False)
    expected_answer: Mapped[str] = mapped_column(Text, nullable=False)
    case_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standard"
    )
    security_test_type: Mapped[str | None] = mapped_column(String(50))
    category: Mapped[str | None] = mapped_column(String(100))
    metadata_json: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSON)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now, onupdate=utc_now
    )
    dataset: Mapped[Dataset] = relationship(back_populates="test_cases")
