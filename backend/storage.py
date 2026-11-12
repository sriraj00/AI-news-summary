from datetime import datetime, timezone
import logging
from uuid import uuid4
import httpx
from fastapi import HTTPException
from .config import settings

logger = logging.getLogger(__name__)


def configured() -> bool:
    return bool(settings.supabase_url.strip() and (settings.supabase_service_role_key.strip() or settings.supabase_secret_key.strip()))


def headers(prefer: str | None = None) -> dict:
    key = settings.supabase_service_role_key.strip() or settings.supabase_secret_key.strip()
    out = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if prefer: out["Prefer"] = prefer
    return out


async def save_report(report: dict) -> dict:
    payload = {**report, "id": report.get("id") or str(uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}
    if not configured():
        return {**payload, "persisted": False, "history_message": "History is not configured. This report is available now but will not be saved after you leave or refresh."}
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{settings.supabase_table}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(url, headers=headers("return=representation"), json=payload)
            response.raise_for_status()
            rows = response.json()
        if not isinstance(rows, list) or not rows or not isinstance(rows[0], dict):
            raise ValueError("Supabase did not confirm that the report was saved.")
        return {**payload, **rows[0], "persisted": True, "history_message": ""}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Supabase report save failed: %s", exc)
        return {**payload, "persisted": False, "history_message": f"Analysis completed, but history could not be saved. {_history_error_message(exc, 'save')}"}


async def list_reports() -> dict:
    if not configured():
        return {"items": [], "persistent": False, "message": "History is not configured. Analyses still work, but reports will not be saved."}
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{settings.supabase_table}?select=id,summary,article_summaries,findings,common_information,conflicts,claims,created_at&order=created_at.desc&limit=100"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers())
            response.raise_for_status()
            rows = response.json()
        if not isinstance(rows, list):
            raise ValueError("Supabase returned an unexpected history response.")
        return {"items": rows, "persistent": True, "message": ""}
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Supabase history load failed: %s", exc)
        return {"items": [], "persistent": False, "message": f"History is currently unavailable. {_history_error_message(exc, 'load')}"}


async def get_report(report_id: str) -> dict:
    if not configured(): raise HTTPException(status_code=503, detail="History is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY to backend/.env.")
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{settings.supabase_table}?id=eq.{report_id}&select=*"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url, headers=headers()); response.raise_for_status(); rows = response.json()
        if not rows: raise HTTPException(status_code=404, detail="Analysis was not found.")
        return rows[0]
    except httpx.HTTPError as exc: raise HTTPException(status_code=502, detail=f"Could not load this analysis. {_history_error_message(exc, 'load')}") from exc


async def delete_report(report_id: str) -> None:
    if not configured(): raise HTTPException(status_code=503, detail="History is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY to backend/.env.")
    url = f"{settings.supabase_url.rstrip('/')}/rest/v1/{settings.supabase_table}?id=eq.{report_id}"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.delete(url, headers=headers("return=minimal")); response.raise_for_status()
    except httpx.HTTPError as exc: raise HTTPException(status_code=502, detail=f"Could not delete this analysis. {_history_error_message(exc, 'delete')}") from exc


def _history_error_message(exc: Exception, action: str) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in {401, 403}:
            return "Supabase rejected the backend credentials. Check SUPABASE_URL and the configured server-only key."
        if status == 404:
            return "The Supabase table or REST endpoint was not found. Check SUPABASE_TABLE and apply backend/schema.sql."
        if status == 429:
            return "Supabase rate limited the request. Try again later."
        return f"Supabase returned HTTP {status} while attempting to {action} history."
    if isinstance(exc, httpx.TimeoutException):
        return f"Supabase timed out while attempting to {action} history."
    if isinstance(exc, ValueError):
        return f"Supabase returned an invalid response while attempting to {action} history."
    return f"Could not connect to Supabase while attempting to {action} history."
