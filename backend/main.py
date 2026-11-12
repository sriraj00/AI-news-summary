from contextlib import asynccontextmanager
import asyncio
import logging
from ipaddress import ip_address
from pathlib import Path
from socket import getaddrinfo
from uuid import uuid4
from urllib.parse import urlparse
import io
import trafilatura
from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pypdf import PdfReader
from . import ai, retrieval, storage, verification
from .config import settings
from .schemas import AuditRequest, ExtractRequest, ProcessRequest, RetrieveRequest, SummaryRequest, VerifyRequest

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        await asyncio.to_thread(verification.load_model)
    except Exception:
        logger.exception("Could not load the local NLI model; claim verification will be unavailable")
    yield


app = FastAPI(title="AI News Trace API", version="1.0.0", description="Grounded news summarization, source retrieval and NLI claim verification.", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


def public_article(article) -> dict:
    data = article.model_dump() if hasattr(article, "model_dump") else article
    return {**data, "id": data.get("id") or str(uuid4())}


def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=422, detail="Enter a complete http or https article URL.")
    try:
        addresses = {row[4][0] for row in getaddrinfo(parsed.hostname, None)}
        if any(not ip_address(addr).is_global for addr in addresses):
            raise HTTPException(status_code=422, detail="Private and local network URLs cannot be fetched.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"The URL host could not be resolved: {exc}") from exc


@app.get("/health")
async def health():
    return {"status": "ok", "groq_configured": bool(settings.groq_api_key), "hf_configured": verification.model_loaded(), "supabase_configured": storage.configured()}


@app.post("/articles/upload")
async def upload_article(file: UploadFile = File(...)):
    filename = file.filename or "article"
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".txt", ".docx"}:
        raise HTTPException(status_code=415, detail="Supported formats are PDF, TXT and DOCX.")
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Files must be 15 MB or smaller.")
    try:
        if suffix == ".txt": text = raw.decode("utf-8-sig")
        elif suffix == ".pdf": text = "\n\n".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(raw)).pages)
        else: text = "\n\n".join(paragraph.text for paragraph in Document(io.BytesIO(raw)).paragraphs if paragraph.text.strip())
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read this document: {exc}") from exc
    text = text.strip()
    if len(text) < 30:
        raise HTTPException(status_code=422, detail="No readable article text was found. Scanned PDFs need OCR before upload.")
    return {"id": str(uuid4()), "title": Path(filename).stem, "text": text, "filename": filename}


@app.post("/articles/process")
async def process_articles(request: ProcessRequest):
    if request.url:
        validate_public_url(request.url)
        try:
            downloaded = trafilatura.fetch_url(request.url)
            text = trafilatura.extract(downloaded, include_comments=False, include_tables=True) if downloaded else None
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not fetch this article URL: {exc}. You can paste the article text instead.") from exc
        if not text or len(text.strip()) < 30:
            raise HTTPException(status_code=422, detail="Could not extract readable article text from this URL. Paste the text instead.")
        host = urlparse(request.url).hostname or "Unknown publisher"
        articles = [{"id": str(uuid4()), "title": host, "publisher": host, "text": text, "url": request.url}]
    elif request.articles:
        articles = [public_article(a) for a in request.articles]
        if any(len(a["text"].strip()) < 25 for a in articles):
            raise HTTPException(status_code=422, detail="Each article needs at least 25 characters of source text.")
    else:
        raise HTTPException(status_code=422, detail="Add article text or provide an article URL.")
    passages = ai.paragraphs_for(articles)
    if not passages:
        raise HTTPException(status_code=422, detail="No source passages could be prepared from these articles.")
    return {"articles": articles, "passages": passages, "article_count": len(articles), "passage_count": len(passages)}


@app.post("/summarize")
async def summarize(request: SummaryRequest):
    return await ai.summarize([public_article(a) for a in request.articles])


@app.post("/claims/extract")
async def extract_claims(request: ExtractRequest):
    return {"claims": await ai.extract_claims(request.summary, [public_article(a) for a in request.articles])}


@app.post("/sources/retrieve")
async def retrieve_sources(request: RetrieveRequest):
    return {"claims": retrieval.retrieve(request.claims, request.passages)}


@app.post("/claims/verify")
async def verify(request: VerifyRequest):
    return {"claims": await verification.verify_claims(request.claims)}


@app.post("/audit/generate")
async def generate_audit(request: AuditRequest):
    summary = request.summary
    report = {"summary": summary.get("summary", ""), "article_summaries": summary.get("article_summaries", []), "findings": request.findings or summary.get("findings", []), "common_information": request.common_information or summary.get("common_information", []), "conflicts": request.conflicts or summary.get("conflicts", []), "claims": request.claims, "source_articles": [{"id": a.id, "title": a.title, "publisher": a.publisher, "url": a.url} for a in request.articles]}
    return await storage.save_report(report)


@app.get("/history")
async def history():
    return await storage.list_reports()


@app.get("/history/{analysis_id}")
async def history_item(analysis_id: str):
    return await storage.get_report(analysis_id)


@app.delete("/history/{analysis_id}")
async def history_delete(analysis_id: str):
    await storage.delete_report(analysis_id)
    return {"deleted": True, "id": analysis_id}
