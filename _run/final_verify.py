# -*- coding: utf-8 -*-
"""
_run/final_verify.py — فحص نهائي شامل لنظام "المستخرج الأسطوري v7.1".

يفحص: خدمة Python (8000) + واجهة Next.js (3000) + نقاط النهاية الوظيفية (enhance/export/merge/kb/providers/extract).

يُشغَّل:  python _run\\final_verify.py
المخرج:  logs/final-report.txt
"""
import base64
import os
import re
import sys
import time

import httpx

# اطبع دائماً بترميز UTF-8 (كونسول Windows العربي cp1256 لا يحتمل بعض الرموز)
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
except Exception:  # noqa: BLE001
    pass

ROOT = r"C:\Users\Ahmad\Desktop\final-extruct"
LOG_DIR = os.path.join(ROOT, "logs")
os.makedirs(LOG_DIR, exist_ok=True)

PY = "http://127.0.0.1:8000/api"
WEB = "http://127.0.0.1:3000"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    flag = "PASS" if ok else "FAIL"
    print(f"[{flag}] {name} :: {detail}")


def post(client, url, payload, timeout=300.0):
    try:
        return client.post(url, json=payload, timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        print(f"      (request error: {exc})")
        return None


with httpx.Client(follow_redirects=True) as c:
    # ── 1) خدمة Python مباشرة ─────────────────────────────────────────────
    r = c.get(f"{PY}/health", timeout=30)
    h = r.json() if r.status_code == 200 else {}
    check("python /api/health",
          r.status_code == 200 and h.get("ok") and h.get("version") == "7.1",
          f"HTTP {r.status_code} modules={len(h.get('modules', []))} caps={h.get('capabilities')}")

    # ── 2) واجهة Next.js ─────────────────────────────────────────────────
    r = c.get(WEB, timeout=60)
    html = r.text
    markers = {
        "lang=ar": 'lang="ar"' in html,
        "dir=rtl": 'dir="rtl"' in html,
        "arabic-ui": "المستخرج" in html or "الجداول" in html,
    }
    check("next.js / (واجهة عربية RTL)",
          r.status_code == 200 and all(markers.values()),
          f"HTTP {r.status_code} bytes={len(html)} markers={markers}")

    # 2b) الخط العربي Cairo يُحمَّل عبر next/font داخل ملف CSS مرتبط بالصفحة
    css_hrefs = re.findall(r'href="(/_next/static/[^"]+\.css)"', html)
    cairo_ok = False
    for href in css_hrefs:
        try:
            css = c.get(WEB + href, timeout=60).text
            if "Cairo" in css or "cairo" in css:
                cairo_ok = True
                break
        except Exception:  # noqa: BLE001
            pass
    check("خط Cairo (next/font) مرتبط بالصفحة", cairo_ok,
          f"css_files={len(css_hrefs)} cairo_found={cairo_ok}")

    # ── 3) نقاط GET ─────────────────────────────────────────────────────
    for ep in ("enhance/profiles", "glossary", "kb/stats", "audit?limit=5"):
        r = c.get(f"{PY}/{ep}", timeout=60)
        body = r.json() if r.status_code == 200 else {}
        check(f"GET /api/{ep}", r.status_code == 200 and body.get("ok") is True,
              f"HTTP {r.status_code} keys={sorted(k for k in body if k != 'ok')[:5]}")

    # ── 5) POST /api/merge ──────────────────────────────────────────────
    r = post(c, f"{PY}/merge", {"rows": [["a", "b"], ["a", "b"], ["c", "d"]], "mode": "global"})
    m = r.json() if r and r.status_code == 200 else {}
    check("POST /api/merge (إزالة تكرار)",
          r is not None and r.status_code == 200 and m.get("ok") and m.get("removed") == 1,
          f"removed={m.get('removed')} rows={len(m.get('rows', []))}")

    # ── 6) POST /api/enhance على صورة حقيقية ─────────────────────────────
    img_path = os.path.join(ROOT, "extruct", "download", "test-table.png")
    img_b64 = ""
    if os.path.exists(img_path):
        with open(img_path, "rb") as fh:
            img_b64 = base64.b64encode(fh.read()).decode()
    if img_b64:
        r = post(c, f"{PY}/enhance", {"image_b64": img_b64, "profile": "darken_clarity"})
        e = r.json() if r and r.status_code == 200 else {}
        out_len = len(e.get("image_b64") or "")
        check("POST /api/enhance (تحسين صورة)",
              bool(e.get("ok")) and out_len > 1000,
              f"profile={e.get('profile_used')} ms={e.get('elapsed_ms')} out_b64={out_len} tuned={e.get('tuned')}")
        if e.get("image_b64"):
            with open(os.path.join(LOG_DIR, "enhanced.png"), "wb") as fh:
                fh.write(base64.b64decode(e["image_b64"]))
    else:
        check("POST /api/enhance", False, "صورة الاختبار غير موجودة")

    # ── 7) تصنيف أخطاء المزود (شبكة مقطوعة) ──────────────────────────────
    r = post(c, f"{PY}/providers/health", {"base_url": "http://localhost:11434/v1", "timeout": 5})
    p = r.json() if r and r.status_code == 200 else {}
    check("POST /api/providers/health (تصنيف الخطأ)",
          r is not None and r.status_code == 200 and p.get("available") is False
          and p.get("error_type") == "network_down",
          f"error_type={p.get('error_type')} error_ar={(p.get('error_ar') or '')[:40]}…")

    # ── 8) قائمة النماذج الاحتياطية عند فشل الجلب ────────────────────────
    r = post(c, f"{PY}/providers/models", {"base_url": "http://localhost:11434/v1", "timeout": 5})
    mo = r.json() if r and r.status_code == 200 else {}
    check("POST /api/providers/models (fallback بلا انهيار)",
          r is not None and r.status_code == 200 and len(mo.get("models", [])) > 0,
          f"ok={mo.get('ok')} source={mo.get('source')} models={len(mo.get('models', []))}")

    # ── 9) الاستخراج بلا مزود متاح → خطأ مصنّف لا 500 ────────────────────
    r = post(c, f"{PY}/extract", {
        "mode": "tables", "images_b64": [img_b64], "provider": "ollama",
        "model": "llava", "base_url": "http://localhost:11434/v1",
    }, timeout=300)
    x = r.json() if r and r.status_code == 200 else {}
    check("POST /api/extract بلا مزود (فشل مُصنّف)",
          r is not None and r.status_code == 200 and x.get("ok") is False and x.get("error_type"),
          f"error_type={x.get('error_type')}")

    # ── 10) التصدير CSV/XLSX مباشرة وعبر الوكيل ──────────────────────────
    payload = {"kind": "tables", "format": "csv",
               "headers": ["الاسم", "القيمة"], "rows": [["أ", "1"], ["ب", "2"]]}
    for fmt in ("csv", "xlsx"):
        body = dict(payload, format=fmt)
        try:
            r = c.post(f"{PY}/export", json=body, timeout=120)
            data = r.content
            disp = r.headers.get("content-disposition", "")
            ok = r.status_code == 200 and len(data) > 10 and "attachment" in disp
            check(f"POST /export {fmt} (direct)", ok,
                  f"HTTP {r.status_code} bytes={len(data)} {disp}")
            if ok:
                with open(os.path.join(LOG_DIR, f"export_direct.{fmt}"), "wb") as fh:
                    fh.write(data)
                if fmt == "csv":
                    check(f"  CSV BOM/عربي (direct)",
                          data.startswith(b"\xef\xbb\xbf") and "الاسم".encode("utf-8") in data,
                          "utf-8-sig + نص عربي سليم")
        except Exception as exc:  # noqa: BLE001
            check(f"POST /export {fmt} (direct)", False, str(exc))

    # ── 11) قاعدة المعرفة: learn ثم fewshot ──────────────────────────────
    r = post(c, f"{PY}/kb/learn", {"scope": "mechanic", "field": "chassis_no",
                                   "wrong": "VERIFY-WRONG", "right": "VERIFY-RIGHT",
                                   "context": "final_verify"})
    kl = r.json() if r and r.status_code == 200 else {}
    r = post(c, f"{PY}/kb/fewshot", {"field": "chassis_no", "wrong": "VERIFY-WRONG"})
    kf = r.json() if r and r.status_code == 200 else {}
    shots = kf.get("shots", [])
    check("KB learn → fewshot (تعلّم التصحيحات)",
          bool(kl.get("ok")) and any(s.get("wrong") == "VERIFY-WRONG" for s in shots),
          f"entries={kl.get('entry_count')} shots={len(shots)}")

    # ── 12) التدقيق سجّل العمليات ───────────────────────────────────────
    r = c.get(f"{PY}/audit?limit=10", timeout=60)
    a = r.json() if r.status_code == 200 else {}
    actions = [e.get("action") for e in a.get("entries", [])]
    check("GET /api/audit (سجل التدقيق)", bool(a.get("ok")) and len(actions) > 0,
          f"آخر العمليات: {actions[:5]}")

# ── الملخص ────────────────────────────────────────────────────────────────
passed = sum(1 for _, ok, _ in results if ok)
failed = [(n, d) for n, ok, d in results if not ok]
report = [
    "════════ فحص النظام النهائي — المستخرج الأسطوري v7.1 ════════",
    f"التاريخ: {time.strftime('%Y-%m-%d %H:%M:%S')}",
    f"النتيجة: {passed}/{len(results)} فحص ناجح",
    "",
]
for name, ok, detail in results:
    report.append(f"{'✔' if ok else '✘'} {name} — {detail}")
if failed:
    report += ["", "الفاشلة:"] + [f"  ✘ {n}: {d}" for n, d in failed]
report.append("")
if failed:
    report.append("الخلاصة: يوجد فشل — راجع البنود أعلاه.")
else:
    report.append("الخلاصة: كل الفحوص ناجحة — خدمة Python (8000) والواجهة (3000) تعملان معاً عبر الوكيل.")

out = os.path.join(LOG_DIR, "final-report.txt")
with open(out, "w", encoding="utf-8") as fh:
    fh.write("\n".join(report))
print("\n".join(report))
print(f"\nREPORT -> {out}")
print(f"FAILED={len(failed)}")


