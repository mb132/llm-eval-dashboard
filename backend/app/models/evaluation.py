"""Persistent evaluation runs and immutable per-request result snapshots."""

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    Float,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UTCDateTime, utc_now


class EvaluationRun(Base):
    """One persistently tracked execution of a validated configuration."""

    __tablename__ = "evaluation_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name="status_valid",
        ),
        CheckConstraint("repetitions >= 1", name="repetitions_positive"),
        CheckConstraint("total_requests >= 1", name="total_requests_positive"),
        CheckConstraint(
            "completed_requests >= 0 AND completed_requests <= total_requests",
            name="completed_requests_valid",
        ),
        CheckConstraint(
            "successful_requests >= 0 AND failed_requests >= 0",
            name="result_counts_nonnegative",
        ),
        CheckConstraint(
            "successful_requests + failed_requests = completed_requests",
            name="result_counts_consistent",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    dataset_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    dataset_name: Mapped[str] = mapped_column(String(120), nullable=False)
    repetitions: Mapped[int] = mapped_column(nullable=False)
    total_requests: Mapped[int] = mapped_column(nullable=False)
    completed_requests: Mapped[int] = mapped_column(nullable=False, default=0)
    successful_requests: Mapped[int] = mapped_column(nullable=False, default=0)
    failed_requests: Mapped[int] = mapped_column(nullable=False, default=0)
    failure_message: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    results: Mapped[list["EvaluationResult"]] = relationship(
        back_populates="evaluation",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class EvaluationResult(Base):
    """Immutable inputs and mutable outcome for one provider request."""

    __tablename__ = "evaluation_results"
    __table_args__ = (
        UniqueConstraint(
            "evaluation_id",
            "sequence_number",
            name="uq_evaluation_results_evaluation_id_sequence_number",
        ),
        CheckConstraint(
            "status IN ('pending', 'running', 'succeeded', 'failed')",
            name="status_valid",
        ),
        CheckConstraint("sequence_number >= 1", name="sequence_number_positive"),
        CheckConstraint("repetition >= 1", name="repetition_positive"),
        CheckConstraint("max_output_tokens >= 1", name="max_output_tokens_positive"),
        CheckConstraint(
            "latency_ms IS NULL OR latency_ms >= 0", name="latency_nonnegative"
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="input_tokens_nonnegative",
        ),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens <= 1000000000",
            name="input_tokens_bounded",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="output_tokens_nonnegative",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens <= 1000000000",
            name="output_tokens_bounded",
        ),
        CheckConstraint(
            "total_tokens IS NULL OR total_tokens >= 0",
            name="total_tokens_nonnegative",
        ),
        CheckConstraint(
            "total_tokens IS NULL OR total_tokens <= 1000000000",
            name="total_tokens_bounded",
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
            "estimated_cost_nano_usd IS NULL OR estimated_cost_nano_usd >= 0",
            name="estimated_cost_nonnegative",
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
        CheckConstraint(
            "case_type IN ('standard', 'security')",
            name="case_type_valid",
        ),
        CheckConstraint(
            "(case_type = 'standard' AND security_test_type IS NULL AND "
            "security_metric_version IS NULL AND security_passed IS NULL) OR "
            "(case_type = 'security' AND security_test_type IN "
            "('direct_prompt_injection', 'instruction_override', "
            "'system_prompt_extraction') AND security_metric_version >= 1)",
            name="security_snapshot_consistent",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    evaluation_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("evaluation_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sequence_number: Mapped[int] = mapped_column(nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    model_id: Mapped[str] = mapped_column(String(100), nullable=False)
    model_provider: Mapped[str] = mapped_column(String(50), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    provider_configuration_id: Mapped[int | None] = mapped_column()
    provider_model_name: Mapped[str | None] = mapped_column(String(300))
    model_base_url: Mapped[str | None] = mapped_column(String(2000))
    model_parameters: Mapped[dict[str, object] | None] = mapped_column(JSON)
    input_price_micro_usd_per_million: Mapped[int | None] = mapped_column()
    output_price_micro_usd_per_million: Mapped[int | None] = mapped_column()
    pricing_currency: Mapped[str | None] = mapped_column(String(3))
    pricing_source: Mapped[str | None] = mapped_column(String(20))
    pricing_effective_date: Mapped[date | None] = mapped_column(Date)
    pricing_source_url: Mapped[str | None] = mapped_column(String(2000))
    pricing_fetched_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    pricing_stale: Mapped[bool] = mapped_column(default=False, nullable=False)
    requests_per_minute: Mapped[int | None] = mapped_column()
    max_concurrent_requests: Mapped[int | None] = mapped_column()
    estimated_cost_nano_usd: Mapped[int | None] = mapped_column()
    reported_model_name: Mapped[str | None] = mapped_column(String(200))
    prompt_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    prompt_version_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    prompt_name: Mapped[str] = mapped_column(String(120), nullable=False)
    prompt_version_number: Mapped[int] = mapped_column(nullable=False)
    test_case_id: Mapped[UUID] = mapped_column(Uuid, nullable=False)
    test_category: Mapped[str | None] = mapped_column(String(100))
    case_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default="standard"
    )
    security_test_type: Mapped[str | None] = mapped_column(String(50))
    security_metric_version: Mapped[int | None] = mapped_column()
    security_passed: Mapped[bool | None] = mapped_column()
    repetition: Mapped[int] = mapped_column(nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    rendered_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    test_input: Mapped[str] = mapped_column(Text, nullable=False)
    expected_output: Mapped[str] = mapped_column(Text, nullable=False)
    generated_output: Mapped[str | None] = mapped_column(Text)
    error_code: Mapped[str | None] = mapped_column(String(50))
    error_message: Mapped[str | None] = mapped_column(String(500))
    latency_ms: Mapped[int | None] = mapped_column()
    input_tokens: Mapped[int | None] = mapped_column()
    output_tokens: Mapped[int | None] = mapped_column()
    total_tokens: Mapped[int | None] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    started_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime())
    evaluation: Mapped[EvaluationRun] = relationship(back_populates="results")
    quality_scores: Mapped[list["EvaluationQualityScore"]] = relationship(
        back_populates="result",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class EvaluationQualityScore(Base):
    """One versioned quality metric assigned to an evaluation result."""

    __tablename__ = "evaluation_quality_scores"
    __table_args__ = (
        UniqueConstraint(
            "result_id",
            "method",
            "metric_version",
            name="uq_quality_scores_result_method_version",
        ),
        CheckConstraint("metric_version >= 1", name="metric_version_positive"),
        CheckConstraint(
            "score IS NULL OR (score >= 0 AND score <= 1)",
            name="score_valid",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    result_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("evaluation_results.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    method: Mapped[str] = mapped_column(String(50), nullable=False)
    metric_version: Mapped[int] = mapped_column(nullable=False)
    score: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        UTCDateTime(), nullable=False, default=utc_now
    )
    result: Mapped[EvaluationResult] = relationship(back_populates="quality_scores")
