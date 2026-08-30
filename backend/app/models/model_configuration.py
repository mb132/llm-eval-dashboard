"""Persisted language-model configurations."""

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now

if TYPE_CHECKING:
    from .provider_configuration import ProviderConfiguration


class ModelConfiguration(Base):
    """A selectable model linked to a reusable provider connection."""

    __tablename__ = "model_configurations"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    provider_id: Mapped[int] = mapped_column(
        ForeignKey("provider_configurations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    model_name: Mapped[str] = mapped_column(String(300), nullable=False)
    parameters: Mapped[dict[str, Any]] = mapped_column(
        JSON, nullable=False, default=dict
    )
    active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )

    provider: Mapped["ProviderConfiguration"] = relationship(back_populates="models")
