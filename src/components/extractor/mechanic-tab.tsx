"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Alert,
  AlertDescription,
  AlertTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Separator,
} from "./ui-bundle";
import {
  Upload,
  ScanEye,
  Layers,
  Brain,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Trash2,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  Fingerprint,
} from "lucide-react";
import { readFileAsDataUrl } from "./image-drop-zone";
import { ImageQueue } from "./image-queue";
import { useExtractorStore } from "@/lib/extractor/store";
import { getEnhanceB64 } from "@/lib/extractor/imaging";
import { mapPool } from "@/lib/extractor/pool";
import { smartExtract, failoverNotice, showExtractError } from "@/lib/extractor/failover";
import {
  parsePdf,
  groupFaces,
  validateRecord,
  exportFile,
  b64ToDataUrl,
} from "@/lib/extractor/api";
import {
  MECHANIC_FIELDS,
  CLASS_LABELS_AR,
  type FaceGroup,
  type MechanicParsed,
  type ClassifyParsed,
  type Confidence,
  type PdfPageImage,
} from "@/lib/extractor/types";

const CLASS_KEYS = Object.keys(CLASS_LABELS_AR);

function sourceLabel(faces: number, method?: string): string {
  if (method === "barcode") return "باركود";
  return faces >= 2 ? "أمامي + خلفي" : "وجه واحد";
}

export function MechanicTab() {
  const images = useExtractorStore((s) => s.images);
  const addImages = useExtractorStore((s) => s.addImages);
  const clearImages = useExtractorStore((s) => s.clearImages);
  const updateImage = useExtractorStore((s) => s.updateImage);
  const removeImage = useExtractorStore((s) => s.removeImage);
  const mechanicRecords = useExtractorStore((s) => s.mechanicRecords);
  const addMechanicRecord = useExtractorStore((s) => s.addMechanicRecord);
  const removeMechanicRecord = useExtractorStore((s) => s.removeMechanicRecord);
  const clearMechanicRecords = useExtractorStore((s) => s.clearMechanicRecords);
  const addReviewItem = useExtractorStore((s) => s.addReviewItem);
  const settings = useExtractorStore((s) => s.settings);

  const [step, setStep] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [classifyDone, setClassifyDone] = useState(0);
  const [classifyTotal, setClassifyTotal] = useState(0);
  const [groups, setGroups] = useState<FaceGroup[]>([]);
  const [groupSources, setGroupSources] = useState<string[][]>([]); // 15.8.3 ملفات أصليّة لكل سجل
  const [grouping, setGrouping] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [extractDone, setExtractDone] = useState(0);
  const [extractTotal, setExtractTotal] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);

  const allClassified = images.length > 0 && images.every((i) => !!i.label);

  // ---------- الخطوة 1: الرفع (طابور موحّد — صور متعددة + PDF بنفس الدفعة) ----------
  const onFiles = async (files: File[]) => {
    setUploading(true);
    try {
      const pdfs = files.filter((f) => f.type === "application/pdf");
      const imgs = files.filter((f) => f.type.startsWith("image/"));
      if (imgs.length > 0) {
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
      }
      for (const pdf of pdfs) {
        const res = await parsePdf(pdf, settings.dpi);
        if (res.warning) toast.warning(res.warning);
        const imgItems = res.pages
          .filter((p): p is PdfPageImage => p.kind === "image")
          .map((p) => ({
            name: `${pdf.name} — صفحة ${p.index + 1}`,
            dataUrl: b64ToDataUrl(p.image_b64),
            sourceType: "pdf_page" as const,
            sourceFile: pdf.name,
            sourcePage: p.index + 1,
          }));
        const nativeCount = res.pages.filter((p) => p.kind === "native").length;
        if (imgItems.length > 0) addImages(imgItems);
        if (nativeCount > 0)
          toast.info(
            `${nativeCount} صفحة PDF نصية (جداول) — تُعالج في تبويب «الجداول» لا في الميكانيك`
          );
        toast.success(`أُضيفت ${imgItems.length} صفحة من ${pdf.name}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally {
      setUploading(false);
    }
  };

  // ---------- الخطوة 2: التصنيف البصري ----------
  const autoClassify = async () => {
    const pending = images.filter((i) => !i.label);
    if (pending.length === 0) {
      toast.info("كل الصور مصنفة مسبقاً");
      return;
    }
    setClassifying(true);
    setClassifyTotal(pending.length);
    setClassifyDone(0);
    let failures = 0;
    // دفعة متوازية بعدد المسارات من الإعدادات — عدّاد الفشل داخل العامل (لا تعارض على المتغير)
    await mapPool(pending, settings.concurrency, async (item) => {
      try {
        const b64 = await getEnhanceB64(item);
        // 15.10: مسار موحّد واعٍ للسلسلة — مباشر أو عبر failover حسب الإعدادات
        const res = await smartExtract({
          mode: "classify",
          imagesB64: [b64],
        });
        const parsed = res.parsed as ClassifyParsed | undefined;
        const label =
          parsed?.label && CLASS_KEYS.includes(parsed.label) ? parsed.label : "unknown";
        updateImage(item.id, { label, labelConfidence: parsed?.confidence });
        const notice = failoverNotice(res);
        if (notice) toast.warning(notice);
      } catch (e) {
        // 15.10.2: رسالة مفصلة حسب نوع الخطأ — بلا تعطيل عدّاد الفشل
        showExtractError(e, { fallback: null });
        failures++;
      }
      setClassifyDone((d) => d + 1);
    });
    setClassifying(false);
    setClassifyTotal(0);
    if (failures > 0) toast.error(`فشل تصنيف ${failures} صورة — صنّفها يدوياً`);
    else toast.success("اكتمل التصنيف التلقائي — راجعه قبل المتابعة");
  };

  // ---------- الخطوة 3: تجميع الوجوه ----------
  const doGroup = async () => {
    setGrouping(true);
    try {
      // 15.8.3: خريطة b64 المرسل → الملف الأصلي (تُعاد الوجوه بنفس النصوص)
      const b64ToFile = new Map<string, string>();
      const items = await Promise.all(
        images.map(async (i) => {
          const b64 = await getEnhanceB64(i);
          b64ToFile.set(b64, i.sourceFile ?? i.name);
          return {
            label: i.label ?? "unknown",
            image_b64: b64,
          };
        })
      );
      const res = await groupFaces(items);
      setGroups(res.groups);
      setGroupSources(
        res.groups.map((g) => {
          const files = g.faces
            .map((f) => b64ToFile.get(f))
            .filter((x): x is string => !!x);
          return [...new Set(files)];
        })
      );
      toast.success(`تُجمّعت ${res.groups.length} سجلات`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التجميع");
    } finally {
      setGrouping(false);
    }
  };

  // ---------- الخطوة 4: الاستخراج ----------
  // دفعة متوازية بعدد المسارات من الإعدادات — كل سجل مستقل والعزل بالخطأ داخل العامل
  const extractAllGroups = async () => {
    if (groups.length === 0) return;
    setExtracting(true);
    setExtractTotal(groups.length);
    setExtractDone(0);
    let failures = 0;
    await mapPool(groups, settings.concurrency, async (g, gi) => {
      try {
        // 15.10: مسار موحّد واعٍ للسلسلة — مباشر أو عبر failover حسب الإعدادات
        const res = await smartExtract({
          mode: "mechanic",
          imagesB64: g.faces,
        });
        const parsed = (res.parsed as MechanicParsed | undefined) ?? {
          fields: {},
          conflicts: [],
          face_values: [],
        };
        const flags: Record<string, { confidence: Confidence; reasons: string[] }> = {};
        let vinValid: boolean | undefined;
        try {
          const v = await validateRecord(parsed.fields);
          for (const [k, fv] of Object.entries(v.fields)) {
            flags[k] = {
              confidence: fv.confidence as Confidence,
              reasons: fv.reasons ?? [],
            };
          }
          vinValid = v.chassis_no_vin_valid;
        } catch {
          // التحقق غير حاسم — لا يعطل السجل
        }
        // تعارض الوجهين = REVIEW فوري
        for (const key of parsed.conflicts ?? []) {
          flags[key] = {
            confidence: "REVIEW",
            reasons: [...(flags[key]?.reasons ?? []), "تعارض بين وجهي الكرت"],
          };
        }
        addMechanicRecord({
          id: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          category_key: g.category_key,
          category_ar: g.category_ar,
          faces: g.faces.map((f) => b64ToDataUrl(f)),
          faceB64s: g.faces,
          method: g.method,
          fields: parsed.fields,
          vin_valid: vinValid,
          flags,
          sourceFiles: groupSources[gi] ?? [], // 15.8.3 تتبّع الملف الأصلي
        });
        // 15.10.5: نجاح بعد حلقات فاشلة — تنبيه التراجع التلقائي
        const notice = failoverNotice(res);
        if (notice) toast.warning(notice);
      } catch (e) {
        // 15.10.2: رسالة مفصلة حسب نوع الخطأ (لا رسالة عامة) + تفاصيل all_failed
        showExtractError(e, {
          fallback: "خطأ",
          context: `فشل استخراج سجل (${g.category_ar})`,
        });
        failures++;
      }
      setExtractDone((d) => d + 1);
    });
    setExtracting(false);
    setExtractTotal(0);
    // 16: بلا رسالة نجاح كاذبة — الفشل الجزئي/الكامل يُعرض بصدق
    if (failures > 0)
      toast.error(
        `فشل استخراج ${failures} من ${groups.length} سجلات — راجع رسالة الخطأ أعلاه`,
        { duration: 9000 },
      );
    else toast.success("اكتمل استخراج السجلات — راجع الخلايا المعلَّمة");
  };

  const cellClick = (recordId: string, categoryAr: string, fieldKey: string, flag: { confidence: Confidence; reasons: string[] }, value: string) => {
    if (flag.confidence !== "REVIEW" && flag.confidence !== "MED") return;
    addReviewItem({
      scope: "mechanic",
      field: fieldKey,
      label: `${MECHANIC_FIELDS.find((f) => f.key === fieldKey)?.label_ar ?? fieldKey} — ${categoryAr}`,
      value,
      confidence: flag.confidence,
      reasons: flag.reasons,
      recordId,
    });
    toast.success("أُضيف العنصر لطابور التدقيق");
  };

  // ---------- تصدير الميكانيك ----------
  const doExport = async (format: "csv" | "xlsx") => {
    if (mechanicRecords.length === 0) {
      toast.warning("لا سجلات للتصدير");
      return;
    }
    setExporting(format);
    try {
      const headers = [
        "الفئة",
        ...MECHANIC_FIELDS.map((f) => f.label_ar),
        "VIN صالح",
        "المصدر",
        "الملفات الأصلية",
      ];
      const rows = mechanicRecords.map((r) => [
        r.category_ar,
        ...MECHANIC_FIELDS.map((f) => r.fields[f.key] ?? ""),
        r.vin_valid === undefined ? "" : r.vin_valid ? "نعم" : "لا",
        sourceLabel(r.faces.length, r.method),
        (r.sourceFiles ?? []).join(" + "), // 15.8.3
      ]);
      await exportFile("mechanic", format, headers, rows);
      toast.success(`بدأ تنزيل ملف ${format.toUpperCase()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التصدير");
    } finally {
      setExporting(null);
    }
  };

  const steps = [
    { n: 1, title: "الرفع", icon: Upload },
    { n: 2, title: "التصنيف", icon: ScanEye },
    { n: 3, title: "التجميع", icon: Layers },
    { n: 4, title: "الاستخراج", icon: Brain },
  ];

  return (
    <div className="space-y-4">
      {/* شريط الخطوات */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          {steps.map((s, idx) => {
            const Icon = s.icon;
            const active = step === s.n;
            return (
              <div key={s.n} className="flex items-center gap-2">
                <Button
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className={`min-h-11 ${active ? "bg-primary hover:bg-primary/90 text-white" : ""}`}
                  onClick={() => setStep(s.n)}
                  disabled={
                    (s.n === 2 && images.length === 0) ||
                    (s.n === 3 && !allClassified) ||
                    (s.n === 4 && groups.length === 0)
                  }
                >
                  <Icon className="h-4 w-4 me-1" />
                  {s.n}. {s.title}
                </Button>
                {idx < steps.length - 1 && (
                  <ArrowLeft className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </div>
            );
          })}
          <div className="grow" />
          {(images.length > 0 || groups.length > 0 || mechanicRecords.length > 0) && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 text-destructive hover:text-destructive"
              onClick={() => {
                clearImages();
                clearMechanicRecords();
                setGroups([]);
                setGroupSources([]);
                setStep(1);
              }}
            >
              <Trash2 className="h-4 w-4 me-1" /> جلسة جديدة
            </Button>
          )}
        </CardContent>
      </Card>

      {/* الخطوة 1 — طابور الإدخال الموحّد (15.8.x) */}
      {step === 1 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <ImageQueue
              onFiles={onFiles}
              busy={uploading}
              busyText="جارٍ المعالجة…"
              dropHint="ارفع وجوه كروت الميكانيك وبيانات القيد ورخص السير وسندات التمليك أو PDF — عدة صور وملفات معاً بنفس الدفعة، مع سحب وإفلات للترتيب وتبديل ثنائي ومعاينة/تحرير لكل صورة"
              title="طابور وجوه الوثائق"
              badge={(img) =>
                img.label ? (
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 border-primary/40 text-primary"
                  >
                    {CLASS_LABELS_AR[img.label] ?? img.label}
                  </Badge>
                ) : null
              }
            />
            {images.length > 0 && (
              <div className="flex justify-end">
                <Button
                  className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                  onClick={() => setStep(2)}
                  disabled={images.length === 0}
                >
                  التالي: التصنيف <ArrowRight className="h-4 w-4 ms-1 rotate-180" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* الخطوة 2 */}
      {step === 2 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <Alert className="border-tertiary/40 bg-tertiary/10">
              <AlertTitle className="text-tertiary text-sm">تأكيد بصري إلزامي</AlertTitle>
              <AlertDescription className="text-tertiary/85 text-xs">
                تأكد من صحة التصنيف قبل الاستخراج — التصنيف الخاطئ يفسد التجميع والسجلات.
              </AlertDescription>
            </Alert>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                onClick={autoClassify}
                disabled={classifying}
              >
                {classifying ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <ScanEye className="h-4 w-4 me-1" />
                )}
                تصنيف تلقائي
              </Button>
              <Button className="min-h-11" onClick={() => setStep(3)} disabled={!allClassified || classifying}>
                التالي: التجميع <ArrowRight className="h-4 w-4 ms-1 rotate-180" />
              </Button>
            </div>
            {classifying && classifyTotal > 0 && (
              <div className="space-y-1">
                <Progress value={(classifyDone / classifyTotal) * 100} />
                <p className="text-xs text-muted-foreground text-center">
                  {classifyDone} / {classifyTotal}
                </p>
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {images.map((img) => (
                <div key={img.id} className="rounded-lg border p-3 space-y-2">
                              <img
                    src={img.previewUrl ?? img.dataUrl}
                    alt={img.name}
                    className="h-32 w-full object-contain rounded bg-muted/30"
                  />
                  <p className="text-xs truncate text-muted-foreground" title={img.name}>
                    {img.name}
                  </p>
                  <Select
                    value={img.label ?? ""}
                    onValueChange={(v) => updateImage(img.id, { label: v })}
                  >
                    <SelectTrigger className="min-h-11 w-full" aria-label="تصنيف الصورة">
                      <SelectValue placeholder="اختر التصنيف" />
                    </SelectTrigger>
                    <SelectContent>
                      {CLASS_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {CLASS_LABELS_AR[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {img.labelConfidence !== undefined && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${
                        img.labelConfidence >= 0.8
                          ? "border-primary/40 text-primary"
                          : "border-tertiary/40 text-tertiary"
                      }`}
                    >
                      ثقة النموذج: {(img.labelConfidence * 100).toFixed(0)}%
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* الخطوة 3 */}
      {step === 3 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                onClick={doGroup}
                disabled={grouping}
              >
                {grouping ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <Layers className="h-4 w-4 me-1" />
                )}
                تجميع الوجوه
              </Button>
              <Button className="min-h-11" onClick={() => setStep(4)} disabled={groups.length === 0 || grouping}>
                التالي: الاستخراج <ArrowRight className="h-4 w-4 ms-1 rotate-180" />
              </Button>
              {groups.length > 0 && (
                <Badge variant="secondary">{groups.length} سجل مُجمّع</Badge>
              )}
            </div>
            {grouping && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> مطابقة بالباركود عند توفره، وإلا التجاور بالترتيب…
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groups.map((g, gi) => (
                <Card key={gi} className="border">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-sm">{g.category_ar}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          g.method === "barcode"
                            ? "border-primary/40 text-primary"
                            : "border-tertiary/40 text-tertiary"
                        }`}
                      >
                        <Fingerprint className="h-3 w-3 me-1" />
                        {g.method === "barcode" ? "باركود" : "تجاور"}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {g.faces.map((f, fi) => (
                        <img
                          key={fi}
                          src={b64ToDataUrl(f)}
                          alt={`${g.category_ar} — وجه ${fi + 1}`}
                          className="h-20 flex-1 object-contain rounded border bg-muted/30"
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {sourceLabel(g.faces.length, g.method)}
                      {groupSources[gi]?.length ? (
                        <span className="block" title={groupSources[gi].join(" + ")}>
                          📄 {groupSources[gi].join(" + ")}
                        </span>
                      ) : null}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* الخطوة 4 */}
      {step === 4 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                onClick={extractAllGroups}
                disabled={extracting || groups.length === 0}
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4 me-1" />
                )}
                استخراج كل السجلات ({groups.length})
              </Button>
              <div className="grow" />
              <Button variant="outline" className="min-h-11" onClick={() => doExport("csv")} disabled={exporting !== null || mechanicRecords.length === 0}>
                {exporting === "csv" ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 me-1" />}
                CSV
              </Button>
              <Button
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                onClick={() => doExport("xlsx")}
                disabled={exporting !== null || mechanicRecords.length === 0}
              >
                {exporting === "xlsx" ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Download className="h-4 w-4 me-1" />}
                Excel
              </Button>
            </div>
            {extracting && extractTotal > 0 && (
              <div className="space-y-1">
                <Progress value={(extractDone / extractTotal) * 100} />
                <p className="text-xs text-muted-foreground text-center">
                  {extractDone} / {extractTotal}
                </p>
              </div>
            )}

            {mechanicRecords.length > 0 && (
              <div className="rounded-lg border">
                <div className="max-h-[60vh] overflow-y-auto custom-scroll">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="border-b bg-muted/60">#</TableHead>
                        <TableHead className="border-b bg-muted/60">الفئة</TableHead>
                        {MECHANIC_FIELDS.map((f) => (
                          <TableHead key={f.key} className="border-b bg-muted/60 whitespace-nowrap">
                            {f.label_ar}
                          </TableHead>
                        ))}
                        <TableHead className="border-b bg-muted/60">المصدر</TableHead>
                        <TableHead className="border-b bg-muted/60">VIN</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mechanicRecords.map((r, ri) => (
                        <TableRow key={r.id}>
                          <TableCell className="text-xs border-b">{ri + 1}</TableCell>
                          <TableCell className="text-xs border-b whitespace-nowrap font-semibold">
                            {r.category_ar}
                          </TableCell>
                          {MECHANIC_FIELDS.map((f) => {
                            const value = r.fields[f.key] ?? "";
                            const flag = r.flags[f.key];
                            const isUnclear = value.trim().toUpperCase() === "UNCLEAR" || value === "";
                            const isReview = flag?.confidence === "REVIEW";
                            const isMed = flag?.confidence === "MED";
                            return (
                              <TableCell
                                key={f.key}
                                onClick={() =>
                                  flag && cellClick(r.id, r.category_ar, f.key, flag, value)
                                }
                                title={flag?.reasons.join(" • ")}
                                className={`text-xs border-b whitespace-nowrap ${
                                  isReview
                                    ? "border-2 border-destructive/70 bg-destructive/10 cursor-pointer"
                                    : isMed
                                      ? "border-2 border-tertiary/60 bg-tertiary/10 cursor-pointer"
                                      : isUnclear
                                        ? "text-tertiary"
                                        : ""
                                }`}
                              >
                                {value || "—"}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-xs border-b whitespace-nowrap">
                            {sourceLabel(r.faces.length, r.method)}
                            {r.sourceFiles && r.sourceFiles.length > 0 && (
                              <span
                                className="block text-[10px] text-muted-foreground max-w-40 truncate"
                                title={r.sourceFiles.join(" + ")}
                              >
                                📄 {r.sourceFiles.join(" + ")}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-xs border-b">
                            {r.vin_valid === undefined ? (
                              <span className="text-muted-foreground">—</span>
                            ) : r.vin_valid ? (
                              <CheckCircle2 className="h-4 w-4 text-primary" aria-label="VIN صالح" />
                            ) : (
                              <XCircle
                                className="h-4 w-4 text-destructive"
                                aria-label="VIN لا يطابق خانة التحقق — راجع رقم الهيكل"
                              />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            {mechanicRecords.length > 0 && (
              <>
                <Separator />
                <p className="text-xs text-muted-foreground">
                  اضغط على أي خلية بحد أحمر (REVIEW) أو كهرماني (MED) لإضافتها لطابور التدقيق —
                  القيم منقولة حرفياً كما استخرجت، وتحقق VIN عمود جانبي لا يعدّل رقم الهيكل أبداً.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
