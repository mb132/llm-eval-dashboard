"""Persisted reusable provider connections and encrypted credentials."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now

if TYPE_CHECKING:
    from .model_configuration import ModelConfiguration


class ProviderConfiguration(Base):
    """One named provider endpoint shared by one or more model configurations."""

    __tablename__ = "provider_configurations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    kind: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    base_url: Mapped[str | None] = mapped_column(String(2000))
    api_key_ciphertext: Mapped[str | None] = mapped_column(Text())
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )

    models: Mapped[list["ModelConfiguration"]] = relationship(
        back_populates="provider", passive_deletes=True
    )
