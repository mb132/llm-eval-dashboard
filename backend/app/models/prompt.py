"""Persistent prompt and immutable prompt-version models."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, Text, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now


class Prompt(Base):
    """A named prompt whose content is stored in immutable versions."""

    __tablename__ = "prompts"

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
    versions: Mapped[list["PromptVersion"]] = relationship(back_populates="prompt")


class PromptVersion(Base):
    """An immutable prompt template revision."""

    __tablename__ = "prompt_versions"
    __table_args__ = (
        UniqueConstraint(
            "prompt_id",
            "version_number",
            name="uq_prompt_versions_prompt_id_version_number",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    prompt_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("prompts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    version_number: Mapped[int] = mapped_column(nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    prompt: Mapped[Prompt] = relationship(back_populates="versions")
