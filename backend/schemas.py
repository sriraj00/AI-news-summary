from typing import Any
from pydantic import BaseModel, Field


class Article(BaseModel):
    id: str | None = None
    title: str = "Untitled article"
    publisher: str = "Unknown publisher"
    text: str = Field(min_length=1)
    url: str | None = None


class ProcessRequest(BaseModel):
    articles: list[Article] | None = None
    url: str | None = None


class SummaryRequest(BaseModel):
    articles: list[Article]


class ExtractRequest(BaseModel):
    summary: dict[str, Any]
    articles: list[Article]


class RetrieveRequest(BaseModel):
    claims: list[dict[str, Any]]
    passages: list[dict[str, Any]]


class VerifyRequest(BaseModel):
    claims: list[dict[str, Any]]


class AuditRequest(BaseModel):
    summary: dict[str, Any]
    articles: list[Article]
    claims: list[dict[str, Any]]
    findings: list[str] = []
    common_information: list[str] = []
    conflicts: list[str] = []


class AnalysisRecord(BaseModel):
    id: str | None = None
    summary: str | None = None
    article_summaries: list[dict[str, Any]] = []
    findings: list[str] = []
    common_information: list[str] = []
    conflicts: list[str] = []
    claims: list[dict[str, Any]] = []
    created_at: str | None = None
