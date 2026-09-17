"use client";

import { useMemo, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Progress,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/extractor/ui-bundle";
import {
  Sparkles,
  Brain,
  Trash2,
  Copy,
  Download,
  Loader2,
  Merge,
  ChevronDown,
  FileSpreadsheet,
  Info,
  Zap,
  Clock,
} from "lucide-react";
import { readFileAsDataUrl } from "./image-drop-zone";
import { CsvGrid } from "./csv-grid";
import { ImageQueue } from "./image-queue";
import { useExtractorStore, parseCsvSimple } from "@/lib/extractor/store";
import { getExtractB64, getEnhanceB64 } from "@/lib/extractor/imaging";
import { smartExtract, failoverNotice, showExtractError } from "@/lib/extractor/failover";
import {
  parsePdf,
  enhance,
  mergeRows,
  exportFile,
  b64ToDataUrl,
  cleanCsvText,
  dataUrlToB64,
} from "@/lib/extractor/api";

export function TablesTab() {
  const images = useExtractorStore((s) => s.images);
  const addImages = useExtractorStore((s) => s.addImages);
  const updateImage = useExtractorStore((s) => s.updateImage);
  const tableResults = useExtractorStore((s) => s.tableResults);
  const addTableResult = useExtractorStore((s) => s.addTableResult);
  const removeTableResult = useExtractorStore((s) => s.removeTableResult);
   const addReviewItems = useExtractorStore((s) => s.addReviewItems);
   const addFailure = useExtractorStore((s) => s.addFailure);
   const settings = useExtractorStore((s) => s.settings);

      const [selectedId, setSelectedId] = useState<string | null>(null);
  const [enhancingId, setEnhancingId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [extractStartedAt, setExtractStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [pdfParsing, setPdfParsing] = useState(false);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchDone, setBatchDone] = useState(0);
  const [merging, setMerging] = useState(false);
  const [merged, setMerged] = useState<{ headers: string[]; rows: string[][]; removed: number } | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const [mergeMultipleImages, setMergeMultipleImages] = useState(false);

  // عداد المدة: يحدّث كل ثانية طالما أن الاستخراج قيد التشغيل
  useEffect(() => {
    if (extractingId === null && batchTotal === 0) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [extractingId, batchTotal]);

  const elapsedLabel = (() => {
    if (!extractStartedAt) return "";
    const secs = Math.floor((Date.now() - extractStartedAt) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m ? m + "د " : ""}${s}ث`;
  })();

  const selected = images.find((i) => i.id === selectedId) ?? null;

  // ---------- الرفع (طابور موحّد — صور متعددة + PDF بنفس الدفعة) ----------
  const onFiles = async (files: File[]) => {
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const imgs = files.filter((f) => f.type.startsWith("image/"));

    if (imgs.length > 0) {
      try {
        const items = await Promise.all(
          imgs.map(async (f) => ({
            name: f.name,
            dataUrl: await readFileAsDataUrl(f),
            sourceType: "image" as const,
            sourceFile: f.name,
          }))
        );
        addImages(items);
        toast.success(`أُضيفت ${imgs.length} صورة`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "فشل قراءة الصور");
      }
    }

    for (const pdf of pdfs) {
      await handlePdf(pdf);
    }
  };

  const handlePdf = async (pdf: File) => {
    setPdfParsing(true);
    try {
      const res = await parsePdf(pdf, settings.dpi);
      if (res.warning) toast.warning(res.warning);
      const imgItems: {
        name: string;
        dataUrl: string;
        sourceType: "pdf_page";
        sourceFile: string;
        sourcePage: number;
      }[] = [];
      let nativeCount = 0;
      for (const page of res.pages) {
        if (page.kind === "image") {
          imgItems.push({
            name: `${pdf.name} — صفحة ${page.index + 1}`,
            dataUrl: b64ToDataUrl(page.image_b64),
            sourceType: "pdf_page",
            sourceFile: pdf.name,
            sourcePage: page.index + 1,
          });
        } else {
          nativeCount++;
          // صفحات PDF النصية: جداول مباشرة بدقة 100% بلا نموذج
          for (const table of page.tables) {
            if (!table || table.length === 0) continue;
            const grid = table.map((row) => row.map((c) => (c == null ? "" : String(c))));
            addTableResult({
              id: `pdf_${page.index}_${Math.random().toString(36).slice(2, 8)}`,
              imageId: `pdf_${pdf.name}_${page.index}`,
              imageName: `${pdf.name} — صفحة ${page.index + 1} (نصية)`,
              csv: grid
                .map((row) =>
                  row
                    .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
                    .join(",")
                )
                .join("\n"),
              rows: grid.length,
              model: "PDF نصي — بلا نموذج",
              elapsed_ms: 0,
              native: true,
            });
          }
        }
      }
      if (imgItems.length > 0) addImages(imgItems);
      if (nativeCount > 0)
        toast.success(`PDF نصي: ${nativeCount} صفحة جداول أصلية بدقة 100% — الصور الممسوحة أُضيفت للقائمة`);
      else toast.success(`PDF ممسوح: أُضيفت ${imgItems.length} صفحة كصور للاستخراج`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تحليل الـPDF");
    } finally {
      setPdfParsing(false);
    }
  };

  // ---------- التحسين ----------
  const doEnhance = async (imageId: string) => {
    const item = images.find((i) => i.id === imageId);
    if (!item) return;
    setEnhancingId(imageId);
    try {
      const b64 = await getEnhanceB64(item);
      const res = await enhance(b64, settings.profile);
      updateImage(imageId, {
        enhanced: {
          b64: res.image_b64,
          plan: res.plan,
          analysis: res.analysis,
          profile: res.profile_used,
          ms: res.elapsed_ms,
        },
      });
      toast.success(`تحسين مكتمل بـ${res.elapsed_ms}ms — بروفايل: ${res.profile_used}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التحسين");
    } finally {
      setEnhancingId(null);
    }
  };

// ---------- الاستخراج ----------
  // silent: داخل الدفعة المتوازية — لا يلمس extractingId (=path indicator)
  const doExtract = async (imageId: string, opts?: { silent?: boolean }) => {
    // عند تفعيل "جميع الصور = جدول واحد": نستخرج كل الصور المعلقة كجدول واحد
    if (mergeMultipleImages) {
      const pending = images.filter((i) => !tableResults.some((t) => t.imageId === i.id));
      if (pending.length === 0) {
        toast.info("كل الصور مستخرجة مسبقاً");
        return;
      }
      if (!opts?.silent) setExtractingId(imageId);
      setExtractStartedAt(Date.now());
      try {
        const b64s = await Promise.all(pending.map((item) => getExtractB64(item)));
        const res = await smartExtract({ mode: "tables", imagesB64: b64s, merge: true });
        const csv = cleanCsvText(res.text);
        if (!csv || csv.trim() === "-" || csv.trim() === "") {
          throw new Error("النتيجة المستخرجة غير valide (نص غير CSV)");
        }
        const grid = parseCsvSimple(csv);
        const resultId = `tbl_merged_${Date.now().toString(36)}`;
        addTableResult({
          id: resultId,
          imageId: "merged_all",
          imageName: `دمج ${pending.length} صورة (جدول واحد)`,
          imageDataUrl: pending[0]?.dataUrl,
          csv,
          rows: grid.length,
          model: res.model,
          elapsed_ms: res.elapsed_ms,
        });
        toast.success(`استخراج مدمج مكتمل: ${grid.length} صف بـ${res.elapsed_ms}ms من ${pending.length} صورة كجدول واحد`);
        const notice = failoverNotice(res);
        if (notice) toast.warning(notice);
      } catch (e) {
        showExtractError(e, { fallback: "فشل الاستخراج المدمج" });
      } finally {
        if (!opts?.silent) setExtractingId(null);
        setExtractStartedAt(null);
      }
      return;
    }

    const item = images.find((i) => i.id === imageId);
    if (!item) return;
    if (!opts?.silent) setExtractingId(imageId);
    setExtractStartedAt(Date.now());
    try {
      const b64 = await getExtractB64(item);
      // 15.10: مسار موحّد واعٍ للسلسلة — مباشر أو عبر failover حسب الإعدادات
      const res = await smartExtract({
        mode: "tables",
        imagesB64: [b64],
        merge: false,
      });
      const csv = cleanCsvText(res.text);
      // تحقق من أن النتيجة ليست فارغة أو مجرد "-"
      if (!csv || csv.trim() === "-" || csv.trim() === "") {
        throw new Error("النتيجة المستخرجة غير صالحة (نص غير CSV)");
      }
      const grid = parseCsvSimple(csv);
      const resultId = `tbl_${imageId}_${Date.now().toString(36)}`;
      addTableResult({
        id: resultId,
        imageId,
        imageName: item.name,
        imageDataUrl: item.dataUrl,
        csv,
        rows: grid.length,
        model: res.model,
        elapsed_ms: res.elapsed_ms,
      });
      // الغموض يُعلَّم: خلايا UNCLEAR → طابور التدقيق
      const unclear: Parameters<typeof addReviewItems>[0] = [];
      grid.forEach((row, ri) => {
        row.forEach((cell, ci) => {
          if (cell.trim().toUpperCase() === "UNCLEAR") {
            unclear.push({
              scope: "tables",
              field: `خلية [${ri},${ci}]`,
              label: `خلية [${ri},${ci}] — ${item.name}`,
              value: cell,
              confidence: "LOW",
              reasons: ["خلية غير مقروءة — علّمها من التدقيق ليتعلم النظام"],
              imageId,
              resultId,
              rowIdx: ri,
              colIdx: ci,
            });
          }
        });
      });
      if (unclear.length > 0) {
        addReviewItems(unclear);
        toast.warning(`${unclear.length} خلية UNCLEAR أُضيفت لطابور التدقيق`);
      } else {
        toast.success(`استخراج مكتمل: ${grid.length} صف بـ${res.elapsed_ms}ms`);
      }
      // 15.10.5: نجاح بعد حلقات فاشلة — تنبيه التراجع التلقائي
      const notice = failoverNotice(res);
      if (notice) toast.warning(notice);
} catch (e) {
       // 15.10.2: رسالة مفصلة حسب نوع الخطأ (لا رسالة عامة)
       showExtractError(e, { fallback: "فشل الاستخراج" });
       
       // حفظ الفشل في قائمة الأفلاس
       if (item) {
         const errorAr = e instanceof Error ? e.message : String(e);
         // استخراج رسالة عربية أكثر تفصيلاً إذا كان خطأ مصنف
         let errorDetailAr: string | undefined;
         if (e instanceof Error && e.name === "PyApiError") {
           // This is a PyApiError, try to get error_ar from it
           // We'll use the generic message for now, could be enhanced
           errorDetailAr = errorAr;
         }
addFailure({
            imageId: imageId,
            mode: "tables",
            error: errorAr,
            error_ar: errorDetailAr,
            timestamp: Date.now()
          });
        }
      } finally {
        if (!opts?.silent) setExtractingId(null);
        setExtractStartedAt(null);
      }
  };

  // دفعة متوازية — مجموعات حسب sourceFile (نفس الملف = جدول واحد)
  // When mergeMultipleImages is enabled, ALL images are extracted as one table.
  // Otherwise, images are grouped by sourceFile — each file produces one table.
  const extractAll = async () => {
    const pending = images.filter((i) => !tableResults.some((t) => t.imageId === i.id));
    if (pending.length === 0) {
      toast.info("كل الصور مستخرجة مسبقاً");
      return;
    }

    if (mergeMultipleImages) {
      // جميع الصور المرفقة = جدول واحد (TABLES_MERGE_PROMPT)
      setBatchTotal(1);
      setBatchDone(0);
      setExtractStartedAt(Date.now());
      try {
        const b64s = await Promise.all(pending.map((item) => getExtractB64(item)));
        const res = await smartExtract({ mode: "tables", imagesB64: b64s, merge: true });
        const csv = cleanCsvText(res.text);
        if (!csv || csv.trim() === "-" || csv.trim() === "") {
          throw new Error("النتيجة المستخرجة غير صالح (نص غير CSV)");
        }
        const grid = parseCsvSimple(csv);
        const resultId = `tbl_merged_${Date.now().toString(36)}`;
        addTableResult({
          id: resultId,
          imageId: "merged_all",
          imageName: `دمج ${pending.length} صورة (جدول واحد)`,
          imageDataUrl: pending[0]?.dataUrl,
          csv,
          rows: grid.length,
          model: res.model,
          elapsed_ms: res.elapsed_ms,
        });
        toast.success(`استخراج مدمج مكتمل: ${grid.length} صف بـ${res.elapsed_ms}ms من ${pending.length} صورة كجدول واحد`);
        const notice = failoverNotice(res);
        if (notice) toast.warning(notice);
      } catch (e) {
        showExtractError(e, { fallback: "فشل الاستخراج المدمج" });
      } finally {
        setBatchTotal(0);
        setBatchDone(0);
        setExtractStartedAt(null);
      }
      return;
    }

    // Group by sourceFile — each group extracted as one table
    const groups = new Map<string, typeof pending>();
    for (const item of pending) {
      const key = item.sourceFile || item.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(item);
    }

    const groupArray = Array.from(groups.values());
    setBatchTotal(groupArray.length);
    setBatchDone(0);
    setExtractStartedAt(Date.now());

    for (const group of groupArray) {
      try {
        const b64s = await Promise.all(group.map((item) => getExtractB64(item)));
        const res = await smartExtract({ mode: "tables", imagesB64: b64s });
        const csv = cleanCsvText(res.text);
        if (!csv || csv.trim() === "-" || csv.trim() === "") continue;
        const grid = parseCsvSimple(csv);
        const resultId = `tbl_group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const groupName = group[0]?.sourceFile || group[0]?.name || "مجموعة";
        addTableResult({
          id: resultId,
          imageId: group[0]?.id || "",
          imageName: group.length > 1 ? `${groupName} (${group.length} صفحات)` : groupName,
          imageDataUrl: group[0]?.dataUrl,
          csv,
          rows: grid.length,
          model: res.model,
          elapsed_ms: res.elapsed_ms,
        });
      } catch (e) {
        showExtractError(e, { fallback: "فشل الاستخراج" });
      }
      setBatchDone((d) => d + 1);
    }
    setBatchTotal(0);
    setBatchDone(0);
  };

  // ---------- الدمج والتصدير ----------
  const allRowsData = useMemo(() => {
    const headers: string[] = [];
    const rows: string[][] = [];
    for (const t of tableResults) {
      const grid = parseCsvSimple(t.csv);
      if (grid.length === 0) continue;
      const head = grid[0];
      head.forEach((h) => {
        if (!headers.includes(h)) headers.push(h);
      });
      for (let ri = 1; ri < grid.length; ri++) {
        const row = head.map((_, ci) => grid[ri][ci] ?? "");
        rows.push(row);
      }
    }
    return { headers, rows };
  }, [tableResults]);

  const doMerge = async () => {
    if (allRowsData.rows.length === 0) {
      toast.warning("لا صفوف للدمج بعد");
      return;
    }
    setMerging(true);
    try {
      const res = await mergeRows(allRowsData.rows, allRowsData.headers, "boundary");
      setMerged({ headers: allRowsData.headers, rows: res.rows, removed: res.removed });
      toast.success(`تم الدمج — أُزيل ${res.removed} صف مكرر`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الدمج");
    } finally {
      setMerging(false);
    }
  };

  const doExport = async (format: "csv" | "xlsx") => {
    const headers = merged?.headers ?? allRowsData.headers;
    const rows = merged?.rows ?? allRowsData.rows;
    if (rows.length === 0) {
      toast.warning("لا بيانات للتصدير — استخرج جداول أولاً");
      return;
    }
    setExporting(format);
    try {
      await exportFile("tables", format, headers, rows);
      toast.success(`بدأ تنزيل ملف ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setExporting(null);
    }
  };

  const copyCsv = async (csv: string) => {
    try {
      await navigator.clipboard.writeText(csv);
      toast.success("نُسخ نص CSV");
    } catch {
      toast.error("فشل النسخ للحافظة");
    }
  };

  const rowsCount = (csv: string) => Math.max(0, parseCsvSimple(csv).length - 1);

  return (
    <div className="space-y-4">
      {/* 1+2) طابور الإدخال الموحّد (15.8.1→15.8.5) — نفس المكوّن مع الميكانيك */}
      <ImageQueue
        onFiles={onFiles}
        busy={pdfParsing}
        busyText="جارٍ تحليل الـPDF (فصل الصفحات النصية عن الممسوحة)…"
        dropHint="عدة صور + PDF بنفس الدفعة — صفحات PDF النصية تُستخرج مباشرة بدقة 100% والممسوحة تُضاف للطابور"
        title="طابور صور الجداول"
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id || null)}
        headerRight={
          <div className="flex items-center gap-2 flex-wrap">
            {batchTotal > 0 && (
              <div className="flex items-center gap-2 w-44">
                <Progress value={(batchDone / batchTotal) * 100} />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {batchDone}/{batchTotal}
                </span>
              </div>
            )}
<div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-muted/30">
              <input
                type="checkbox"
                id="mergeMultipleImages"
                checked={mergeMultipleImages}
                onChange={(e) => setMergeMultipleImages(e.target.checked)}
                className="h-4 w-4"
              />
              <label
                htmlFor="mergeMultipleImages"
                className="text-xs text-muted-foreground cursor-pointer select-none"
                title="عند التفعيل: جميع الصور المرفقة تُعتبر جدولًا واحدًا (ليست جدولًا منفصلًا لكل صورة)"
              >
                جميع الصور = جدول واحد
              </label>
            </div>
            {extractStartedAt && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-primary/10 text-primary">
                <Clock className="h-4 w-4 animate-pulse" />
                <span className="text-xs font-mono whitespace-nowrap">
                  {elapsedLabel}
                </span>
              </div>
            )}
            <Button
              size="sm"
              className="min-h-11 bg-primary hover:bg-primary/90 text-white"
              onClick={extractAll}
              disabled={batchTotal > 0 || extractingId !== null || images.length === 0}
            >
              {batchTotal > 0 ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <Zap className="h-4 w-4 me-1" />
              )}
              استخراج الكل ({images.filter((i) => !tableResults.some((t) => t.imageId === i.id)).length} متبقية)
            </Button>
          </div>
        }
      />

      {/* 3) أدوات الصورة المحددة */}
      {selected && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-semibold truncate" title={selected.name}>
              الأدوات: {selected.name}
              <span className="text-xs font-normal text-muted-foreground"> — انقر المصغّرة للمعاينة/التحرير</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => doEnhance(selected.id)}
                disabled={enhancingId === selected.id}
              >
                {enhancingId === selected.id ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 me-1 text-primary" />
                )}
                ✨ تحسين {enhancingId === selected.id ? "…" : `(${settings.profile})`}
              </Button>
              <Button
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                onClick={() => doExtract(selected.id)}
                disabled={extractingId === selected.id}
              >
                {extractingId === selected.id ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4 me-1" />
)}
                🧠 استخراج {extractingId === selected.id ? "…" : "الجTables"}
              </Button>
              {extractingId === selected.id && extractStartedAt && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-md border bg-primary/10 text-primary">
                  <Clock className="h-4 w-4 animate-pulse" />
                  <span className="text-xs font-mono whitespace-nowrap">{elapsedLabel}</span>
                </div>
              )}

              {/* خطة التحسين */}
              {selected.enhanced && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" className="min-h-11">
                      <Info className="h-4 w-4 me-1 text-tertiary" /> خطة التحسين
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 custom-scroll max-h-80 overflow-y-auto" dir="rtl">
                    <div className="space-y-2">
                      <p className="text-xs font-bold">
                        بروفايل: {selected.enhanced.profile} ({selected.enhanced.ms}ms)
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(selected.enhanced.analysis).map(([k, v]) => (
                          <Badge key={k} variant="secondary" className="text-[10px]">
                            {k}: {typeof v === "number" ? v.toFixed(2) : String(v)}
                          </Badge>
                        ))}
                      </div>
                      <Separator />
                      <Collapsible>
                        <CollapsibleTrigger className="flex items-center gap-1 text-xs font-semibold">
                          <ChevronDown className="h-3.5 w-3.5" /> خطوات السلسلة بأسبابها
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className="mt-2 space-y-2">
                            {selected.enhanced.plan.map((p, i) => (
                              <li key={i} className="text-xs border rounded p-2 bg-muted/40">
                                <span className="font-bold text-primary">
                                  {p.step}
                                </span>
                                <br />
                                <span className="text-muted-foreground">{p.reason_ar}</span>
                              </li>
                            ))}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4) النتائج */}
      {tableResults.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {tableResults.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {t.imageDataUrl && (
                        <img
                          src={t.imageDataUrl}
                          alt={t.imageName}
                          className="h-10 w-10 object-cover rounded border"
                        />
                      )}
                      <p className="font-bold text-sm truncate" title={t.imageName}>
                        {t.imageName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      {t.native && (
                        <Badge className="bg-primary/15 text-primary border border-primary/40">
                          PDF نصي ✓ 100%
                        </Badge>
                      )}
                      <Badge variant="secondary" className="text-xs">
                        {t.model}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {rowsCount(t.csv)} صف • {(t.elapsed_ms / 1000).toFixed(1)} ث
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label="نسخ CSV"
                      onClick={() => copyCsv(t.csv)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 text-destructive"
                      aria-label="إزالة النتيجة"
                      onClick={() => removeTableResult(t.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <CsvGrid csv={t.csv} maxHeight="max-h-80" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* 5) شريط التصدير */}
      {tableResults.length > 0 && (
        <Card className="sticky bottom-4 z-10 shadow-lg">
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <Button variant="outline" className="min-h-11" onClick={doMerge} disabled={merging}>
              {merging ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Merge className="h-4 w-4 me-1" />}
              دمج وإزالة التكرار
              {merged && merged.removed > 0 && (
                <Badge className="ms-2 bg-tertiary/20 text-tertiary border border-tertiary/40">
                  أُزيل {merged.removed}
                </Badge>
              )}
            </Button>
            <div className="grow" />
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => doExport("csv")}
              disabled={exporting !== null}
            >
              {exporting === "csv" ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 me-1" />
              )}
              تصدير CSV
            </Button>
            <Button
              className="min-h-11 bg-primary hover:bg-primary/90 text-white"
              onClick={() => doExport("xlsx")}
              disabled={exporting !== null}
            >
              {exporting === "xlsx" ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <Download className="h-4 w-4 me-1" />
              )}
              تصدير Excel
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
