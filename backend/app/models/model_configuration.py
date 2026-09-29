"""Persisted language-model configurations."""

from datetime import date, datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Boolean, CheckConstraint, Date, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now

if TYPE_CHECKING:
    from .provider_configuration import ProviderConfiguration


class ModelConfiguration(Base):
    """A selectable model linked to a reusable provider connection."""

    __tablename__ = "model_configurations"
    __table_args__ = (
        CheckConstraint(
            "pricing_mode IN ('catalog', 'automatic', 'manual', 'unavailable')",
            name="pricing_mode_valid",
        ),
        CheckConstraint(
            "requests_per_minute IS NULL OR requests_per_minute > 0",
            name="requests_per_minute_positive",
        ),
        CheckConstraint(
            "max_concurrent_requests IS NULL OR max_concurrent_requests > 0",
            name="max_concurrent_requests_positive",
        ),
        CheckConstraint(
            "(input_price_micro_usd_per_million IS NULL AND "
            "output_price_micro_usd_per_million IS NULL AND "
            "pricing_currency IS NULL AND pricing_source IS NULL AND "
            "pricing_effective_date IS NULL) OR "
            "(input_price_micro_usd_per_million IS NOT NULL AND "
            "output_price_micro_usd_per_million IS NOT NULL AND "
            "pricing_currency = 'USD' AND "
            "pricing_source IN ('catalog', 'manual', 'openrouter') AND "
            "pricing_effective_date IS NOT NULL)",
            name="pricing_complete",
        ),
        CheckConstraint(
            "input_price_micro_usd_per_million IS NULL OR "
            "input_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
            name="input_price_bounded",
        ),
        CheckConstraint(
            "output_price_micro_usd_per_million IS NULL OR "
            "output_price_micro_usd_per_million BETWEEN 0 AND 1000000000",
            name="output_price_bounded",
        ),
    )

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
    pricing_mode: Mapped[str] = mapped_column(
        String(20), nullable=False, default="catalog"
    )
    input_price_micro_usd_per_million: Mapped[int | None] = mapped_column()
    output_price_micro_usd_per_million: Mapped[int | None] = mapped_column()
    pricing_currency: Mapped[str | None] = mapped_column(String(3))
    pricing_source: Mapped[str | None] = mapped_column(String(20))
    pricing_effective_date: Mapped[date | None] = mapped_column(Date)
    pricing_source_url: Mapped[str | None] = mapped_column(String(2000))
    pricing_fetched_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    requests_per_minute: Mapped[int | None] = mapped_column(Integer)
    max_concurrent_requests: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )

    provider: Mapped["ProviderConfiguration"] = relationship(back_populates="models")
