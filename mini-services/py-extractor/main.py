# -*- coding: utf-8 -*-
"""
main.py — خدمة "المستخرج الأسطوري" v7.1 (FastAPI على المنفذ 8000).
تجمع كل وحدات core/ وتنفذ عقد API الملزم: /home/z/my-project/docs/api-contract.md

مبادئ ملزمة مطبقة هنا:
- "انقل ولا تصحّح": لا تصحيح صامت لأي قيمة مستخرجة في أي endpoint.
- "الغموض يُعلَّم": كل قيمة غير واثقة → REVIEW/LOW ولا تُخمَّن.
- مفاتيح API تُستخدم في الذاكرة للطلب فقط — لا تُحفظ في أي ملف (15.6).
- 15.10 المرونة الإقليمية: تصنيف أخطاء المزودين (error_type/error_ar عربي ملزم)
  + فحص توفر health/health_batch + سلسلة تراجع /api/extract/failover.
"""
import asyncio
import time
from typing import List, Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from core import analyzer, audit, benchmark, consensus, enhancer, evaluator
from core import exporter, extractor, glossary, kb, mechanic, merger
from core import pdfio, planner, providers, tuner, verifier

SERVICE = "py-extractor"
VERSION = "7.1"

MODULES = ["pdfio", "providers", "extractor", "enhancer", "analyzer",
           "planner", "evaluator", "tuner", "consensus", "verifier",
           "glossary", "mechanic", "kb", "merger", "exporter", "audit",
           "benchmark"]

app = FastAPI(title="المستخرج الأسطوري — py-extractor", version=VERSION)

# CORS مفتوح (الواجهة تصل عبر بوابة Caddy — عقد API §0)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_caps_cache = None


def capabilities() -> dict:
    """كشف قدرات بيئة التشغيل مرة واحدة: باركود (pyzbar) و OCR (tesseract)."""
    global _caps_cache
    if _caps_cache is not None:
        return _caps_cache
    caps = {"barcode": False, "ocr": False}
    try:
        from pyzbar.pyzbar import decode  # noqa: F401
        caps["barcode"] = True
    except Exception:
        caps["barcode"] = False
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        caps["ocr"] = True
    except Exception:
        caps["ocr"] = False
    _caps_cache = caps
    return caps


def ok(**data) -> dict:
    return {"ok": True, **data}


def err(message: str) -> dict:
    return {"ok": False, "error": str(message)}


# ═══════════════ نماذج الطلبات ═══════════════

class ModelsReq(BaseModel):
    base_url: str
    api_key: Optional[str] = None
    timeout: float = 20


class HealthCheckReq(BaseModel):
    base_url: str
    api_key: Optional[str] = None
    timeout: float = 8


class HealthProviderSpec(BaseModel):
    id: str
    base_url: str
    api_key: Optional[str] = None


class HealthBatchReq(BaseModel):
    providers: List[HealthProviderSpec]
    timeout: float = 8


class FailoverLink(BaseModel):
    provider: str
    model: str = ""
    base_url: Optional[str] = None
    api_key: Optional[str] = None


class FailoverReq(BaseModel):
    mode: str  # tables | mechanic | classify | verify
    images_b64: List[str]
    chain: List[FailoverLink]
    timeout: float = 120


class EnhanceReq(BaseModel):
    image_b64: str
    profile: str = "darken_clarity"


class ExtractReq(BaseModel):
    mode: str  # tables | mechanic | classify | verify
    images_b64: List[str]
    provider: str = "zai"
    model: str = ""
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    extra: Optional[dict] = None


class GroupReq(BaseModel):
    items: List[dict]  # [{label, image_b64}]


class ValidateReq(BaseModel):
    record: dict


class OcrCrossReq(BaseModel):
    field: str
    image_b64: str
    vl_value: str = ""


class ConsensusReq(BaseModel):
    results: List[dict]  # [{source, fields}]


class BenchmarkReq(BaseModel):
    image_b64: str
    models: List[str]
    provider: str = "zai"
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    timeout: float = 120


class ExportReq(BaseModel):
    kind: str = "tables"       # tables | mechanic
    format: str = "csv"        # csv | xlsx
    headers: List[str] = []
    rows: List[List[str]] = []


class MergeReq(BaseModel):
    rows: List[List[str]]
    headers: Optional[List[str]] = None
    mode: str = "boundary"     # boundary | global


class LearnReq(BaseModel):
    scope: str                 # tables | mechanic
    field: str
    wrong: str
    right: str
    context: Optional[str] = None


class FewshotReq(BaseModel):
    field: str
    wrong: Optional[str] = None


@app.exception_handler(Exception)
async def unhandled_exception(request, exc: Exception):
    return JSONResponse(status_code=500,
                        content=err(f"خطأ غير متوقع: {exc}"))


# ═══════════════ GET /api/health ═══════════════

@app.get("/api/health")
async def health():
    return ok(service=SERVICE, version=VERSION, modules=MODULES,
              capabilities=capabilities())


# ═══════════════ POST /api/providers/models ═══════════════

@app.post("/api/providers/models")
async def providers_models(req: ModelsReq):
    payload = await asyncio.to_thread(
        providers.models_payload, req.base_url, req.api_key, int(req.timeout))
    # لا نسجل المفتاح إطلاقاً — فقط المصدر وعدد النماذج
    audit.log("providers.models", target=req.base_url,
              details={"source": payload.get("source"),
                       "count": len(payload.get("models", []))})
    return payload


# ═══════════════ 15.10: POST /api/providers/health + health_batch ═══════════════

@app.post("/api/providers/health")
async def providers_health(req: HealthCheckReq):
    """فحص توفر خفيف لمزود واحد (ping /models) — لا يُخزَّن شيء على القرص."""
    ping = await asyncio.to_thread(
        providers.ping_provider, req.base_url, req.api_key, float(req.timeout))
    # لا يُسجَّل أي مفتاح — فقط المضيف ونتيجة الفحص
    audit.log("provider.health", target=ping.get("host") or "",
              details={"available": ping.get("available"),
                       "error_type": ping.get("error_type")})
    return {"ok": True, **ping}


@app.post("/api/providers/health_batch")
async def providers_health_batch(req: HealthBatchReq):
    """فحص متوازٍ لكل المزودات — فشل عنصر لا يُسقط البقية."""
    specs = list(req.providers or [])

    async def _one(spec: HealthProviderSpec):
        try:
            return spec.id, await asyncio.to_thread(
                providers.ping_provider, spec.base_url, spec.api_key,
                float(req.timeout))
        except Exception as e:  # noqa: BLE001 — فشل عنصر يظهر داخل النتيجة لا يُسقط الدفعة
            return spec.id, {"available": False, "status": None,
                             "error_type": "unknown",
                             "error_ar": f"فشل الفحص: {e}"[:200],
                             "host": "", "suggested_model": None}

    pairs = await asyncio.gather(*[_one(s) for s in specs])
    results = {pid: ping for pid, ping in pairs}
    available = sum(1 for p in results.values() if p.get("available"))
    audit.log("provider.health_batch", target=f"{len(specs)} مزود",
              details={"available": available,
                       "unavailable": len(results) - available})
    return {"ok": True, "results": results}


# ═══════════════ GET /api/enhance/profiles ═══════════════

@app.get("/api/enhance/profiles")
async def enhance_profiles():
    return ok(profiles=planner.profiles_payload())


# ═══════════════ POST /api/enhance ═══════════════

@app.post("/api/enhance")
async def enhance(req: EnhanceReq):
    t0 = time.time()
    try:
        img = pdfio.decode_b64_to_bgr(req.image_b64)
    except ValueError as e:
        return err(e)
    analysis = await asyncio.to_thread(analyzer.analyze, img)
    profile = req.profile if req.profile in planner.PROFILES else "darken_clarity"

    def _run():
        if profile == "none":
            # العقد: profile=none يطبق stretch الختام فقط (بلا tuner)
            plan = planner.build_plan(analysis, "none")
            out = enhancer.apply(img, plan, analysis)
            after = analyzer.analyze(out)
            return {"image": out, "profile_used": "none", "plan": plan,
                    "analysis_after": after, "tuned": False, "tried": []}
        return tuner.tune(img, profile, analysis, target="tables")

    res = await asyncio.to_thread(_run)
    out_b64 = await asyncio.to_thread(pdfio.encode_bgr_to_b64, res["image"])
    elapsed = int((time.time() - t0) * 1000)
    audit.log("enhance", target=f"profile={res['profile_used']}",
              details={"elapsed_ms": elapsed, "tuned": res.get("tuned", False),
                       "tried": res.get("tried", []),
                       "flags_before": analysis.get("flags")})
    return ok(image_b64=out_b64, analysis=analysis,
              plan=res["plan"], profile_used=res["profile_used"],
              elapsed_ms=elapsed, tuned=res.get("tuned", False),
              tried=res.get("tried", []),
              analysis_after=res.get("analysis_after"))


# ═══════════════ POST /api/pdf/parse ═══════════════

@app.post("/api/pdf/parse")
async def pdf_parse(file: UploadFile = File(...), dpi: int = Form(300)):
    t0 = time.time()
    data = await file.read()
    if not data:
        return err("الملف فارغ")
    try:
        parsed = await asyncio.to_thread(pdfio.parse_file, data,
                                         file.filename or "", dpi)
    except Exception as e:  # noqa: BLE001
        return err(f"فشل تحليل الملف: {e}")

    pages = []
    for p in parsed["pages"]:
        if p["kind"] == "native":
            pages.append({"kind": "native", "index": p["index"],
                          "tables": p["tables"]})
        else:
            b64 = await asyncio.to_thread(pdfio.encode_bgr_to_b64, p["img"])
            pages.append({"kind": "image", "index": p["index"],
                          "image_b64": b64})
    audit.log("pdf.parse", target=(file.filename or "")[:80],
              details={"is_pdf": parsed["is_pdf"], "pages": len(pages),
                       "dpi": dpi, "elapsed_ms": int((time.time() - t0) * 1000)})
    out = {"ok": True, "is_pdf": parsed["is_pdf"], "pages": pages}
    if parsed.get("warning"):
        out["warning"] = parsed["warning"]
    return out


# ═══════════════ POST /api/extract ═══════════════

def _do_extract(req: ExtractReq) -> dict:
    """مزامنة داخل thread — كل مسارات mode الأربعة."""
    mode = req.mode
    images = [b for b in (req.images_b64 or []) if (b or "").strip()]
    if not images:
        raise ValueError("images_b64 مطلوبة")
    extra = req.extra or {}
    timeout = float(extra.get("timeout", 120))
    model = req.model or ""

    if mode == "tables":
        prompt = extractor.TABLES_PROMPT
        text, attempts = extractor.call_vl(
            images[:1], req.provider, model, req.base_url, req.api_key,
            prompt, timeout)
        rows = extractor.parse_csv_tolerant(text)
        return {"text": text, "attempts": attempts, "parsed": rows,
                "model": model, "audit_details": {"rows": len(rows)}}

    if mode == "mechanic":
        prompt = extractor.MECHANIC_PROMPT
        # مسار موحد لكل المزودات (بما فيها Z.ai — مزود عادي): كل الصور في رسالة واحدة
        # عبر openai-compatible، ودمج/كشف تعارض الوجهين في Python عند الحاجة.
        text, attempts = extractor.call_vl(
            images, req.provider, model, req.base_url, req.api_key,
            prompt, timeout)
        obj = extractor.parse_json_tolerant(text)
        fields = extractor.normalize_fields(
            obj if isinstance(obj, dict) else {})
        raw_conf = obj.get("conflicts") if isinstance(obj, dict) else None
        conflicts = [str(c) for c in raw_conf] if isinstance(raw_conf, list) else []
        face_values = [{"face_index": 0, "fields": fields}]
        audit_extra = {"faces": len(images), "conflicts": conflicts}
        parsed = {"fields": fields, "conflicts": conflicts,
                  "face_values": face_values}
        return {"text": text, "attempts": attempts, "parsed": parsed,
                "model": model, "audit_details": audit_extra}

    if mode == "classify":
        prompt = extractor.CLASSIFY_PROMPT
        text, attempts = extractor.call_vl(
            images[:1], req.provider, model, req.base_url, req.api_key,
            prompt, timeout)
        obj = extractor.parse_json_tolerant(text)
        parsed = None
        if isinstance(obj, dict) and obj.get("label"):
            parsed = {"label": str(obj["label"]),
                      "confidence": obj.get("confidence", 0)}
            if parsed["label"] not in glossary.CLASSIFY_LABELS:
                parsed["label"] = "unknown"
        return {"text": text, "attempts": attempts, "parsed": parsed,
                "model": model, "audit_details":
                    {"label": (parsed or {}).get("label")}}

    if mode == "verify":
        prompt = verifier.build_verify_prompt(
            extra.get("current_fields"), extra.get("current_text"))
        text, attempts = extractor.call_vl(
            images[:1], req.provider, model, req.base_url, req.api_key,
            prompt, timeout)
        parsed = verifier.parse_verify_response(text)
        return {"text": text, "attempts": attempts, "parsed": parsed,
                "model": model,
                "audit_details": {"corrections":
                    len((parsed or {}).get("corrections", {}))}}

    raise ValueError(f"mode غير معروف: {mode} "
                     "(المسموح: tables | mechanic | classify | verify)")


@app.post("/api/extract")
async def extract(req: ExtractReq):
    t0 = time.time()
    try:
        res = await asyncio.to_thread(_do_extract, req)
    except extractor.ProviderError as e:  # قبل RuntimeError (فئة فرعية منها) — 15.10
        return {"ok": False, "error": str(e),
                "error_type": e.error_type.value,
                "error_ar": providers.ERROR_TYPE_AR[e.error_type]}
    except ValueError as e:
        return err(str(e))
    except RuntimeError as e:
        return err(str(e))
    except Exception as e:  # noqa: BLE001 — صنّف وأرفق error_type/error_ar (15.10.2)
        et = providers.classify_exception(e)
        return {"ok": False, "error": f"فشل الاستخراج: {e}",
                "error_type": et.value,
                "error_ar": providers.ERROR_TYPE_AR[et]}
    elapsed = int((time.time() - t0) * 1000)
    # لا يُسجَّل أي مفتاح — فقط النموذج والمحاولات والزمن
    audit.log("extract", target=req.mode, model=res["model"],
              details={"provider": req.provider, "attempts": res["attempts"],
                       "elapsed_ms": elapsed, **res["audit_details"]})
    return ok(text=res["text"], parsed=res.get("parsed"),
              attempts=res["attempts"], model=res["model"],
              elapsed_ms=elapsed)


# ═══════════════ 15.10.5: POST /api/extract/failover — سلسلة التراجع ═══════════════

@app.post("/api/extract/failover")
async def extract_failover(req: FailoverReq):
    """سلسلة تراجع واعية: تجربة المزودات بالترتيب، الحظر الجغرافي/الشبكة → التالي
    فوراً، حد المعدل → انتظار 2s ثم التالي، المفتاح الخاطئ → توقف فوراً بلا
    انتقال صامت. لا رسالة عامة أبداً — تفصيل لكل مزود.
    لا يُسجَّل أي مفتاح في audit إطلاقاً."""
    t0 = time.time()
    images = [b for b in (req.images_b64 or []) if (b or "").strip()]
    if not images:
        return err("images_b64 مطلوبة")
    chain = list(req.chain or [])
    if not chain:
        return err("chain مطلوبة (سلسلة مزودين بالترتيب)")

    failover_log: List[dict] = []
    failures: List[tuple] = []  # (link, exception) لتفصيل attempts_detail
    for i, link in enumerate(chain):
        sub = ExtractReq(mode=req.mode, images_b64=images,
                         provider=link.provider, model=link.model or "",
                         base_url=link.base_url, api_key=link.api_key,
                         extra={"timeout": req.timeout})
        t_link = time.time()
        try:
            res = await asyncio.to_thread(_do_extract, sub)
        except extractor.ProviderError as e:
            et = e.error_type
            failover_log.append({"provider": link.provider,
                                 "error_type": et.value,
                                 "error_ar": providers.ERROR_TYPE_AR[et],
                                 "elapsed_ms": int((time.time() - t_link) * 1000)})
            failures.append((link, e))
            nxt = chain[i + 1].provider if i + 1 < len(chain) else None
            audit.log("provider.failover", target=req.mode, model=link.provider,
                      details={"reason": et.value, "next": nxt,
                               "raw": str(e)[:160]})
            if et == providers.ProviderErrorType.AUTH_INVALID:
                # توقف فوراً ولا تنتقل صامتاً — قد يكون نفس السبب لكل السلسلة
                elapsed = int((time.time() - t0) * 1000)
                audit.log("extract.failover", target=req.mode, model=None,
                          details={"chain_len": len(chain), "used": 0,
                                   "failed_count": len(failover_log),
                                   "elapsed_ms": elapsed,
                                   "stopped": "auth_invalid"})
                return {"ok": False, "error_type": "auth_invalid",
                        "error": str(e),
                        "error_ar": providers.ERROR_TYPE_AR[et],
                        "failover_log": failover_log}
            if et == providers.ProviderErrorType.RATE_LIMITED:
                await asyncio.sleep(2)  # تراجع مهذب قبل المزود التالي
            continue
        except ValueError as e:
            return err(str(e))
        except Exception as e:  # noqa: BLE001 — خلل غير متوقع: صنّفه وانتقل (فشل عنصر لا يُسقط السلسلة)
            et = providers.classify_exception(e)
            failover_log.append({"provider": link.provider,
                                 "error_type": et.value,
                                 "error_ar": providers.ERROR_TYPE_AR[et],
                                 "elapsed_ms": int((time.time() - t_link) * 1000)})
            failures.append((link, e))
            nxt = chain[i + 1].provider if i + 1 < len(chain) else None
            audit.log("provider.failover", target=req.mode, model=link.provider,
                      details={"reason": et.value, "next": nxt,
                               "raw": str(e)[:160]})
            continue
        elapsed = int((time.time() - t0) * 1000)
        audit.log("extract.failover", target=req.mode, model=link.provider,
                  details={"chain_len": len(chain), "used": i + 1,
                           "failed_count": len(failover_log),
                           "elapsed_ms": elapsed})
        return {"ok": True, "text": res["text"], "parsed": res.get("parsed"),
                "attempts": res["attempts"], "model": res["model"],
                "elapsed_ms": elapsed, "used_provider": link.provider,
                "used_model": res["model"], "failover_log": failover_log}

    # استنفاد السلسلة كلها — تفصيل لكل مزود، لا رسالة عامة أبداً
    elapsed = int((time.time() - t0) * 1000)
    attempts_detail = []
    for link, e in failures:
        et = getattr(e, "error_type", providers.classify_exception(e))
        attempts_detail.append({"provider": link.provider,
                                "error_type": et.value,
                                "error_ar": providers.ERROR_TYPE_AR[et],
                                "detail": str(e)[:300]})
    all_geo = bool(failover_log) and all(
        f["error_type"] == providers.ProviderErrorType.GEO_BLOCKED.value
        for f in failover_log)
    if all_geo:
        error_ar = providers.ERROR_TYPE_AR[providers.ProviderErrorType.GEO_BLOCKED]
    else:
        error_ar = "فشلت جميع مزودات السلسلة — " + " | ".join(
            f"{f['provider']}: {f['error_ar']}" for f in failover_log)
    audit.log("extract.failover", target=req.mode, model=None,
              details={"chain_len": len(chain), "used": 0,
                       "failed_count": len(failover_log),
                       "elapsed_ms": elapsed,
                       "error_types": [f["error_type"] for f in failover_log]})
    return {"ok": False, "error_type": "all_failed",
            "error": f"فشلت جميع مزودات السلسلة ({len(chain)})",
            "error_ar": error_ar, "attempts_detail": attempts_detail,
            "failover_log": failover_log}


# ═══════════════ POST /api/mechanic/group ═══════════════

@app.post("/api/mechanic/group")
async def mechanic_group(req: GroupReq):
    t0 = time.time()
    try:
        groups, matched_by_barcode = await asyncio.to_thread(
            mechanic.group_faces_v2, req.items)
    except Exception as e:  # noqa: BLE001
        return err(f"فشل تجميع الوجوه: {e}")
    audit.log("mechanic.group", target=f"{len(req.items)} وجه",
              details={"groups": len(groups),
                       "matched_by_barcode": matched_by_barcode,
                       "elapsed_ms": int((time.time() - t0) * 1000)})
    return ok(groups=groups)


# ═══════════════ POST /api/mechanic/validate ═══════════════

@app.post("/api/mechanic/validate")
async def mechanic_validate(req: ValidateReq):
    # ملاحظة 15.1 الصريحة: chassis_no يُعاد كما هو حرفياً؛ نتيجة VIN عمود جانبي فقط
    result = mechanic.validate_record(req.record)
    audit.log("mechanic.validate", target="record",
              details={"vin_valid": result.get("chassis_no_vin_valid")})
    out = {"ok": True, "fields": result["fields"]}
    if result.get("chassis_no_vin_valid") is not None:
        out["chassis_no_vin_valid"] = result["chassis_no_vin_valid"]
    return out


# ═══════════════ POST /api/mechanic/ocr_cross ═══════════════

@app.post("/api/mechanic/ocr_cross")
async def mechanic_ocr_cross(req: OcrCrossReq):
    if not capabilities().get("ocr"):
        return err("tesseract غير متوفر في هذه البيئة")
    try:
        result = await asyncio.to_thread(
            mechanic.cross_verify_numeric, req.field,
            req.image_b64, req.vl_value)
    except Exception as e:  # noqa: BLE001
        return err(f"فشل التحقق المتقاطع: {e}")
    audit.log("mechanic.ocr_cross", target=req.field,
              details={"status": result.get("status")})
    return {"ok": True, **result}


# ═══════════════ POST /api/consensus ═══════════════

@app.post("/api/consensus")
async def consensus_vote(req: ConsensusReq):
    result = consensus.consensus_fields(req.results)
    audit.log("consensus", target=f"{len(req.results)} مصادر",
              details={"review_count": result["review_count"]})
    return ok(fields=result["fields"], review_count=result["review_count"])


# ═══════════════ POST /api/benchmark ═══════════════

@app.post("/api/benchmark")
async def benchmark_run(req: BenchmarkReq):
    t0 = time.time()
    try:
        result = await asyncio.to_thread(
            benchmark.run_benchmark, req.image_b64, req.models, req.provider,
            req.base_url, req.api_key, float(req.timeout))
    except Exception as e:  # noqa: BLE001
        return err(f"فشل سباق النماذج: {e}")
    audit.log("benchmark", target=f"{len(req.models)} نماذج",
              model=result.get("winner"),
              details={"elapsed_ms": int((time.time() - t0) * 1000),
                       "results": [{"model": r["model"], "score": r["score"],
                                    "error": r["error"]} for r in result["results"]]})
    return ok(**result)


# ═══════════════ POST /api/export ═══════════════

@app.post("/api/export")
async def export_data(req: ExportReq):
    try:
        filename, content, media_type = await asyncio.to_thread(
            exporter.export, req.kind, req.format, req.headers, req.rows)
    except Exception as e:  # noqa: BLE001
        return err(f"فشل التصدير: {e}")
    audit.log("export", target=filename,
              details={"kind": req.kind, "format": req.format,
                       "rows": len(req.rows), "bytes": len(content)})
    return Response(content=content, media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ═══════════════ POST /api/merge ═══════════════

@app.post("/api/merge")
async def merge_data(req: MergeReq):
    rows, removed = merger.merge_rows(req.rows, req.mode)
    audit.log("merge", target=f"mode={req.mode}",
              details={"removed": removed, "rows_after": len(rows)})
    return ok(rows=rows, removed=removed)


# ═══════════════ KB: stats / learn / fewshot ═══════════════

@app.get("/api/kb/stats")
async def kb_stats():
    return ok(**kb.stats())


@app.post("/api/kb/learn")
async def kb_learn(req: LearnReq):
    count = kb.learn(req.scope, req.field, req.wrong, req.right, req.context)
    audit.log("learn", target=f"{req.scope}/{req.field}",
              details={"wrong": req.wrong, "right": req.right})
    return ok(entry_count=count)


@app.post("/api/kb/fewshot")
async def kb_fewshot(req: FewshotReq):
    return ok(shots=kb.fewshot(req.field, req.wrong))


# ═══════════════ GET /api/audit ═══════════════

@app.get("/api/audit")
async def audit_read(limit: int = 50):
    return ok(entries=audit.read(limit))


# ═══════════════ GET /api/glossary ═══════════════

@app.get("/api/glossary")
async def glossary_get():
    return {"ok": True, **glossary.glossary_payload()}


# ═══════════════ جذر الخدمة ═══════════════

@app.get("/")
async def root():
    return ok(service=SERVICE, version=VERSION,
              hint="كل النقاط تحت /api — انظر docs/api-contract.md")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
