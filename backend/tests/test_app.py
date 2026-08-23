from app.main import app
from fastapi import FastAPI


def test_app_can_be_imported() -> None:
    assert isinstance(app, FastAPI)
    assert app.title == "LLM Evaluation Platform"
