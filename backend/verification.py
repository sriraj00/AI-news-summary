import asyncio
import logging
import re
from threading import Lock

from fastapi import HTTPException

from .config import settings

logger = logging.getLogger(__name__)

LABELS = {
    "entailment": "entailment",
    "supports": "entailment",
    "support": "entailment",
    "contradiction": "contradiction",
    "contradicts": "contradiction",
    "neutral": "neutral",
    "not enough information": "neutral",
    "insufficient evidence": "neutral",
}

_model = None
_tokenizer = None
_torch = None
_device = None
_label_ids = None
_load_error = None
_inference_lock = Lock()


def _label_mapping(id2label: dict, num_labels: int) -> dict[int, str]:
    mapping = {}
    for label_id in range(num_labels):
        label = id2label.get(label_id, id2label.get(str(label_id)))
        if not isinstance(label, str):
            raise ValueError(f"NLI model has no label configured for output {label_id}")
        normalized = re.sub(r"[_-]+", " ", label.strip().lower())
        category = LABELS.get(normalized)
        if category is None:
            raise ValueError(f"Cannot safely map NLI model output label '{label}'")
        mapping[label_id] = category
    if set(mapping.values()) != {"entailment", "contradiction", "neutral"}:
        raise ValueError("NLI model must expose entailment, contradiction, and neutral output labels")
    return mapping


def load_model() -> None:
    global _model, _tokenizer, _torch, _device, _label_ids, _load_error

    try:
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        configured_device = settings.hf_nli_device.strip().lower()
        if configured_device == "auto":
            device_name = "cuda" if torch.cuda.is_available() else "cpu"
        elif configured_device in {"cpu", "cuda"}:
            if configured_device == "cuda" and not torch.cuda.is_available():
                raise RuntimeError("HF_NLI_DEVICE is cuda, but CUDA is not available")
            device_name = configured_device
        else:
            raise ValueError("HF_NLI_DEVICE must be 'auto', 'cpu', or 'cuda'")
        if settings.hf_nli_batch_size < 1:
            raise ValueError("HF_NLI_BATCH_SIZE must be at least 1")

        tokenizer = AutoTokenizer.from_pretrained(settings.hf_nli_model)
        model = AutoModelForSequenceClassification.from_pretrained(settings.hf_nli_model)
        try:
            model.to(device_name)
        except (MemoryError, RuntimeError, torch.cuda.OutOfMemoryError) as exc:
            message = str(exc).lower()
            is_cuda_oom = isinstance(exc, (MemoryError, torch.cuda.OutOfMemoryError)) or (
                "out of memory" in message or "cublas_status_alloc_failed" in message
            )
            if device_name != "cuda" or not is_cuda_oom:
                raise
            logger.warning("Falling back to CPU because the NLI model does not fit in CUDA memory")
            torch.cuda.empty_cache()
            model.to("cpu")
            device_name = "cpu"
        model.eval()
        label_ids = _label_mapping(model.config.id2label, model.config.num_labels)

        _torch = torch
        _device = torch.device(device_name)
        _tokenizer = tokenizer
        _model = model
        _label_ids = label_ids
        _load_error = None
        logger.info("Loaded local NLI model %s on %s", settings.hf_nli_model, device_name)
    except Exception as exc:
        _model = None
        _tokenizer = None
        _torch = None
        _device = None
        _label_ids = None
        _load_error = f"{type(exc).__name__}: {exc}"
        raise


def model_loaded() -> bool:
    return _model is not None


def _require_model() -> None:
    if _model is None:
        detail = "The local NLI model is not available."
        if _load_error:
            detail += f" Model loading failed: {_load_error}"
        else:
            detail += " Model loading has not completed."
        raise HTTPException(status_code=503, detail=detail)


def _is_out_of_memory(exc: Exception) -> bool:
    if isinstance(exc, MemoryError):
        return True
    if _torch is not None and isinstance(exc, _torch.cuda.OutOfMemoryError):
        return True
    message = str(exc).lower()
    return "out of memory" in message or "cublas_status_alloc_failed" in message


def _classify_pairs(pairs: list[tuple[str, str]]) -> list[dict[str, float]]:
    global _device

    _require_model()
    results = []
    batch_size = settings.hf_nli_batch_size
    cursor = 0

    with _inference_lock:
        while cursor < len(pairs):
            batch = pairs[cursor:cursor + batch_size]
            try:
                encoded = _tokenizer(
                    [evidence for _, evidence in batch],
                    [claim for claim, _ in batch],
                    padding=True,
                    truncation=True,
                    max_length=512,
                    return_tensors="pt",
                )
                encoded = {name: tensor.to(_device) for name, tensor in encoded.items()}
                with _torch.inference_mode():
                    logits = _model(**encoded).logits
                    probabilities = _torch.softmax(logits, dim=-1).cpu().tolist()
                if len(probabilities) != len(batch):
                    raise ValueError("NLI model returned an unexpected batch size")
                batch_results = []
                for row in probabilities:
                    if len(row) != len(_label_ids):
                        raise ValueError("NLI model returned an unexpected number of labels")
                    scores = {label: 0.0 for label in ("entailment", "contradiction", "neutral")}
                    for label_id, score in enumerate(row):
                        scores[_label_ids[label_id]] = float(score)
                    batch_results.append(scores)
            except Exception as exc:
                if not _is_out_of_memory(exc):
                    raise
                if _device.type == "cuda":
                    _torch.cuda.empty_cache()
                if batch_size > 1:
                    batch_size = max(1, batch_size // 2)
                    logger.warning("Reducing local NLI batch size to %d after an out-of-memory error", batch_size)
                    continue
                if _device.type == "cuda":
                    logger.warning("Falling back to CPU for local NLI inference after a CUDA memory error")
                    _model.to("cpu")
                    _device = _torch.device("cpu")
                    continue
                raise
            results.extend(batch_results)
            cursor += len(batch)
    return results


async def classify_pair(claim: str, evidence: str) -> dict[str, float]:
    try:
        return (await asyncio.to_thread(_classify_pairs, [(claim, evidence)]))[0]
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Local NLI inference failed")
        raise HTTPException(status_code=503, detail=f"Local NLI inference failed: {exc}") from exc


async def verify_claims(claims: list[dict]) -> list[dict]:
    comparisons: list[list[dict]] = [[] for _ in claims]
    pairs = []
    pair_claim_indexes = []

    for claim_index, claim in enumerate(claims):
        if not isinstance(claim, dict) or not isinstance(claim.get("text"), str) or not claim["text"].strip():
            raise HTTPException(status_code=422, detail="Each claim must include non-empty text.")
        evidence = claim.get("evidence")
        if evidence is None:
            evidence = []
        if not isinstance(evidence, list):
            raise HTTPException(status_code=422, detail="Claim evidence must be a list of source passages.")
        for passage in evidence:
            if not isinstance(passage, dict) or not isinstance(passage.get("text"), str) or not passage["text"].strip():
                raise HTTPException(status_code=422, detail="Each evidence passage must include non-empty text.")
            pairs.append((claim["text"], passage["text"]))
            pair_claim_indexes.append(claim_index)

    if pairs:
        try:
            pair_scores = await asyncio.to_thread(_classify_pairs, pairs)
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Local NLI inference failed")
            raise HTTPException(status_code=503, detail=f"Local NLI inference failed: {exc}") from exc
        for claim_index, scores in zip(pair_claim_indexes, pair_scores):
            comparisons[claim_index].append(scores)

    checked = []
    for claim, claim_comparisons in zip(claims, comparisons):
        if not claim_comparisons:
            checked.append({
                **claim,
                "status": "INSUFFICIENT EVIDENCE",
                "confidence": None,
                "explanation": "No relevant source passage was retrieved. Retrieval similarity is not evidence of support.",
            })
            continue

        best_entail = max(claim_comparisons, key=lambda score: score["entailment"])
        best_contra = max(claim_comparisons, key=lambda score: score["contradiction"])
        if best_entail["entailment"] >= 0.75 and best_entail["entailment"] > best_entail["contradiction"] + 0.15:
            status, confidence = "ENTAILED", best_entail["entailment"]
            explanation = "The NLI model judged this retrieved passage to entail the claim. Read the source passage to confirm context; this is a model assessment, not independent fact-checking."
        elif best_contra["contradiction"] >= 0.75 and best_contra["contradiction"] > best_contra["entailment"] + 0.15:
            status, confidence = "CONTRADICTED", best_contra["contradiction"]
            explanation = "The NLI model judged this retrieved passage to conflict with the claim. Inspect the passage and article context before drawing a conclusion."
        else:
            confidence = max(max(scores.values()) for scores in claim_comparisons)
            if max(scores["neutral"] for scores in claim_comparisons) >= max(
                max(scores["entailment"], scores["contradiction"]) for scores in claim_comparisons
            ):
                explanation = "The NLI model judged the retrieved evidence as neutral or inconclusive. Neutral is not treated as entailment or contradiction."
            else:
                explanation = "The retrieved passage did not establish a sufficiently confident entailment or contradiction. Semantic similarity alone is not treated as proof."
            status = "INSUFFICIENT EVIDENCE"
        checked.append({**claim, "status": status, "confidence": confidence, "explanation": explanation})
    return checked
