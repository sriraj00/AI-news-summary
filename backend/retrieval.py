from functools import lru_cache
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
from fastapi import HTTPException


@lru_cache(maxsize=1)
def model() -> SentenceTransformer:
    return SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")


def retrieve(claims: list[dict], passages: list[dict], top_k: int = 3) -> list[dict]:
    if not claims:
        return []
    if not passages:
        return [{**claim, "evidence": []} for claim in claims]
    try:
        texts = [p["text"] for p in passages]
        vectors = model().encode(texts, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False).astype("float32")
        index = faiss.IndexFlatIP(vectors.shape[1])
        index.add(vectors)
        queries = model().encode([c["text"] for c in claims], convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False).astype("float32")
        scores, ids = index.search(queries, min(top_k, len(passages)))
        output = []
        for claim, row_scores, row_ids in zip(claims, scores, ids):
            evidence = [{**passages[int(idx)], "score": float(score)} for score, idx in zip(row_scores, row_ids) if idx >= 0]
            output.append({**claim, "evidence": evidence})
        return output
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Source retrieval could not run. Check the Sentence Transformers and FAISS installation: {exc}") from exc
