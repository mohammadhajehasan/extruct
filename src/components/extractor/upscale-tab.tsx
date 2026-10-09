"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Progress,
  Label,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/extractor/ui-bundle";
import {
  ArrowUpFromLine,
  Download,
  Loader2,
  Send,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { ImageDropZone, readFileAsDataUrl } from "./image-drop-zone";
import { useExtractorStore } from "@/lib/extractor/store";
import { getEnhanceB64 } from "@/lib/extractor/imaging";
import { mapPool } from "@/lib/extractor/pool";
import {
  parsePdf,
  enhance,
  getProfiles,
  b64ToDataUrl,
  dataUrlToB64,
} from "@/lib/extractor/api";
import type { EnhanceProfile } from "@/lib/extractor/types";

const DPI_LEVELS = [
  { v: 150, t: "⚡ سريعة 150", d: "أسرع — مسودات وملفات كبيرة" },
  { v: 200, t: "⚖️ متوازنة 200", d: "الموصى بها لمعظم الملفات" },
  { v: 300, t: "🔍 عالية 300", d: "أدق للنص الصغير — أبطأ" },
  { v: 400, t: "💎 فائقة 400", d: "للوثائق الدقيقة — الأثقل" },
];

interface UpscaleItem {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  estDpi: number;
  resultB64?: string;
  upscaleInfo?: { from_dpi: number; to_dpi: number; factor: number } | null;
  elapsedMs?: number;
}

function estimateDpi(w: number): number {
  return Math.round(w / 8.27);
}

export function UpscaleTab() {
  const addImages = useExtractorStore((s) => s.addImages);
  const [items, setItems] = useState<UpscaleItem[]>([]);
  const [targetDpi, setTargetDpi] = useState<number>(300);
  const [profile, setProfile] = useState<string>("darken_clarity");
  const [profiles, setProfiles] = useState<EnhanceProfile[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [slider, setSlider] = useState(50);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const settings = useExtractorStore((s) => s.settings);

  const ensureProfiles = async () => {
    if (profilesLoaded) return;
    try {
      const res = await getProfiles();
      setProfiles(res.profiles ?? []);
    } catch {
      // الخدمة غير متصلة — البروفايل الافتراضي يكفي
    } finally {
      setProfilesLoaded(true);
    }
  };

  const loadImageSize = (dataUrl: string): Promise<{ w: number; h: number }> =>
    new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => rej(new Error("فشل قراءة الصورة"));
      img.src = dataUrl;
    });

  const onFiles = async (files: File[]) => {
    void ensureProfiles();
    const pdfs = files.filter((f) => f.type === "application/pdf");
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    const next: UpscaleItem[] = [];
    for (const f of imgs) {
      try {
        const dataUrl = await readFileAsDataUrl(f);
        const { w, h } = await loadImageSize(dataUrl);
        next.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: f.name, dataUrl, width: w, height: h, estDpi: estimateDpi(w),
        });
      } catch {
        toast.error(`فشل قراءة الملف: ${f.name}`);
      }
    }
    for (const pdf of pdfs) {
      try {
        const res = await parsePdf(pdf, settings.dpi);
        if (res.warning) toast.warning(res.warning);
        for (const page of res.pages) {
          if (page.kind !== "image") continue;
          const dataUrl = b64ToDataUrl(page.image_b64);
          try {
            const { w, h } = await loadImageSize(dataUrl);
            next.push({
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              name: `${pdf.name} — صفحة ${page.index + 1}`,
              dataUrl, width: w, height: h, estDpi: estimateDpi(w),
            });
          } catch {
            // صفحة تالفة — تُتجاوز
          }
        }
        toast.success(`أُضيفت صفحات ${pdf.name} الممسوحة للتحسين`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `فشل تحليل ${pdf.name}`);
      }
    }
    if (next.length > 0) {
      setItems((prev) => [...prev, ...next]);
      if (!selectedId) setSelectedId(next[0].id);
    }
  };

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const doneCount = useMemo(() => items.filter((i) => i.resultB64).length, [items]);

  const runUpscale = async () => {
    if (items.length === 0 || running) return;
    setRunning(true);
    setDone(0);
    try {
      await mapPool(items, 2, async (item) => {
        const b64 = await getEnhanceB64({ dataUrl: item.dataUrl, ops: [] });
        const res = await enhance(b64, profile, targetDpi);
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, resultB64: res.image_b64, upscaleInfo: res.upscale ?? null, elapsedMs: res.elapsed_ms }
              : p
          )
        );
        setDone((d) => d + 1);
      });
      toast.success(`اكتمل رفع الدقة إلى ${targetDpi} — ${items.length} صورة`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل رفع الدقة");
    } finally {
      setRunning(false);
    }
  };

  const downloadResult = (item: UpscaleItem) => {
    if (!item.resultB64) return;
    const a = document.createElement("a");
    a.href = b64ToDataUrl(item.resultB64);
    a.download = `upscaled_${targetDpi}dpi_${item.name.replace(/[^\w\-.]+/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadAll = () => {
    const ready = items.filter((i) => i.resultB64);
    if (ready.length === 0) {
      toast.warning("لا نتائج بعد — نفّذ رفع الدقة أولاً");
      return;
    }
    ready.forEach((item, idx) => setTimeout(() => downloadResult(item), idx * 400));
  };

  const sendToExtraction = () => {
    const ready = items.filter((i) => i.resultB64);
    if (ready.length === 0) {
      toast.warning("لا نتائج بعد — نفّذ رفع الدقة أولاً");
      return;
    }
    addImages(
      ready.map((i) => ({
        name: `محسّنة ${targetDpi}dpi — ${i.name}`,
        dataUrl: b64ToDataUrl(i.resultB64!),
        sourceType: "upscaled" as const,
        sourceFile: i.name,
      }))
    );
    toast.success(`أُرسلت ${ready.length} صورة محسّنة لطابور الاستخراج — انتقل لتبويب الجداول`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-bold text-base flex items-center gap-2">
            <ArrowUpFromLine className="h-5 w-5 text-primary" /> 🚀 رفع الدقة
          </h2>
          <p className="text-xs text-muted-foreground">
            ارفع صوراً أو PDF — تُعرض بدقتها الأصلية المقدَّرة، تختار الدقة المستهدفة والبروفايل،
            ثم يُكبَّر كل ملف للوصول إليها مع سلسلة التنقية (تباين + حدة آمنة).
          </p>
          <ImageDropZone onFiles={onFiles} disabled={running} />
        </CardContent>
      </Card>

      {items.length > 0 && (
        <>
          <Card>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <Label>الدقة المستهدفة</Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DPI_LEVELS.map((o) => (
                    <label
                      key={o.v}
                      className={`cursor-pointer rounded-lg border p-2 text-center text-xs transition-colors ${
                        targetDpi === o.v
                          ? "border-primary bg-primary/10 font-bold"
                          : "border-muted hover:border-primary/50"
                      }`}
                      title={o.d}
                    >
                      <input
                        type="radio" name="upscale-dpi" value={o.v}
                        checked={targetDpi === o.v}
                        onChange={() => setTargetDpi(o.v)}
                        className="sr-only"
                      />
                      <span className="block font-semibold">{o.t}</span>
                      <span className="block text-[10px] text-muted-foreground mt-0.5">{o.d}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5 max-w-sm">
                <Label>بروفايل التنقية</Label>
                <Select value={profile} onValueChange={setProfile} dir="rtl">
                  <SelectTrigger className="min-h-11">
                    <SelectValue placeholder="اختر البروفايل" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="darken_clarity">تغميق ووضوح ⭐ (افتراضي)</SelectItem>
                    <SelectItem value="official_document">وثيقة رسمية (يحمي الأختام)</SelectItem>
                    <SelectItem value="manual_safe">يدوي آمن (خفيف)</SelectItem>
                    <SelectItem value="none">بدون تنقية (تكبير فقط)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                  onClick={runUpscale}
                  disabled={running}
                >
                  {running ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <ArrowUpFromLine className="h-4 w-4 me-1" />}
                  {running ? `جارٍ الرفع… ${done}/${items.length}` : `🚀 رفع الدقة إلى ${targetDpi}`}
                </Button>
                <Button variant="outline" className="min-h-11" onClick={() => setItems([])} disabled={running}>
                  <Trash2 className="h-4 w-4 me-1" /> مسح الكل
                </Button>
                {running && <Progress value={(done / Math.max(1, items.length)) * 100} className="w-full" />}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    className={`relative rounded-lg border-2 overflow-hidden w-24 h-24 shrink-0 transition-colors ${
                      selectedId === item.id ? "border-primary" : "border-transparent hover:border-primary/50"
                    }`}
                    title={`${item.name} — ${item.width}×${item.height} (~${item.estDpi}dpi)`}
                  >
                    <img src={item.resultB64 ? b64ToDataUrl(item.resultB64) : item.dataUrl} alt={item.name} className="w-full h-full object-cover" />
                    {item.resultB64 && (
                      <Badge className="absolute bottom-1 right-1 bg-primary text-white text-[10px] px-1">✓ {targetDpi}</Badge>
                    )}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {items.length} ملف — اكتمل {doneCount} — انقر مصغّرة للمعاينة والمقارنة
              </p>
            </CardContent>
          </Card>

          {selected && (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold truncate" title={selected.name}>
                    {selected.name}
                  </p>
                  <Badge variant="secondary" className="text-xs">
                    الأصل {selected.width}×{selected.height} (~{selected.estDpi}dpi)
                  </Badge>
                  {selected.upscaleInfo && (
                    <Badge className="bg-primary/15 text-primary border border-primary/40 text-xs">
                      ×{selected.upscaleInfo.factor} → {selected.upscaleInfo.to_dpi}dpi
                      {selected.elapsedMs != null && ` — ${(selected.elapsedMs / 1000).toFixed(1)}ث`}
                    </Badge>
                  )}
                </div>
                {selected.resultB64 ? (
                  <>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <ZoomIn className="h-4 w-4 text-muted-foreground" />
                        <Label className="text-xs">مقارنة قبل/بعد — حرّك المؤشر</Label>
                      </div>
                      <input
                        type="range" min={0} max={100} value={slider}
                        onChange={(e) => setSlider(Number(e.target.value))}
                        className="w-full accent-primary" aria-label="مقارنة قبل وبعد"
                      />
                      <div className="relative rounded-lg border overflow-hidden bg-white dark:bg-zinc-900" dir="ltr">
                        <img src={b64ToDataUrl(selected.resultB64)} alt="بعد التحسين" className="w-full object-contain max-h-96" />
                        <div className="absolute inset-y-0 left-0 overflow-hidden border-e-2 border-tertiary" style={{ width: `${slider}%` }}>
                          <img src={selected.dataUrl} alt="قبل التحسين" className="h-full object-cover max-h-96" style={{ width: "100vw", maxWidth: "none" }} />
                        </div>
                        <Badge className="absolute top-2 right-2 bg-primary text-white text-[10px]">بعد {targetDpi}dpi</Badge>
                        <Badge className="absolute top-2 left-2 bg-zinc-700 text-white text-[10px]">قبل ~{selected.estDpi}dpi</Badge>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" className="min-h-11" onClick={() => downloadResult(selected)}>
                        <Download className="h-4 w-4 me-1" /> تنزيل المحسّنة
                      </Button>
                      <Button variant="outline" className="min-h-11" onClick={downloadAll}>
                        <Download className="h-4 w-4 me-1" /> تنزيل الكل ({doneCount})
                      </Button>
                      <div className="grow" />
                      <Button className="min-h-11 bg-primary hover:bg-primary/90 text-white" onClick={sendToExtraction}>
                        <Send className="h-4 w-4 me-1" /> إرسال للاستخراج ({doneCount})
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    بلا نتيجة بعد — اضغط «🚀 رفع الدقة إلى {targetDpi}» أعلاه. المعامل المتوقع: ×
                    {(targetDpi / Math.max(1, selected.estDpi)).toFixed(1)}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

