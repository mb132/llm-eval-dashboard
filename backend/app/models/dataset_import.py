"""Idempotency receipts for completed dataset imports."""

from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON, ForeignKey, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UTCDateTime, utc_now


class DatasetImportReceipt(Base):
    """Persist the outcome of one import request without retaining its file."""

    __tablename__ = "dataset_import_receipts"

    import_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    dataset_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False
    )
    response_json: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
