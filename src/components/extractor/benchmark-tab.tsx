"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Progress,
  Input,
  ScrollArea,
  Separator,
} from "./ui-bundle";
import {
  Flag,
  Loader2,
  Trophy,
  Download,
  Sparkles,
  Crown,
  RefreshCw,
} from "lucide-react";
import { ImageDropZone, readFileAsDataUrl } from "./image-drop-zone";
import { CsvGrid } from "./csv-grid";
import { useExtractorStore, getProviderKey } from "@/lib/extractor/store";
import { runBenchmark, enhance, dataUrlToB64 } from "@/lib/extractor/api";
import { getEnhanceB64 } from "@/lib/extractor/imaging";

export function BenchmarkTab() {
  const images = useExtractorStore((s) => s.images);
  const addImages = useExtractorStore((s) => s.addImages);
  const updateImage = useExtractorStore((s) => s.updateImage);
  const models = useExtractorStore((s) => s.models);
  const modelsSource = useExtractorStore((s) => s.modelsSource);
  const settings = useExtractorStore((s) => s.settings);
  const setSettings = useExtractorStore((s) => s.setSettings);
  const benchmark = useExtractorStore((s) => s.benchmark);
  const setBenchmark = useExtractorStore((s) => s.setBenchmark);
  const resetBenchmark = useExtractorStore((s) => s.resetBenchmark);

  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [enhancing, setEnhancing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const selectedImage = images.find((i) => i.id === selectedImageId) ?? null;

  // الافتراضي: أول نموذجين مجانيين رؤيويين من القائمة المجلوبة من المزود
  useEffect(() => {
    if (selectedModels.length === 0 && models.length > 0) {
      const freeVision = models.filter((m) => m.free && m.vision).map((m) => m.name);
      const def = freeVision.slice(0, 2);
      if (def.length > 0) {
        setTimeout(() => setSelectedModels(def), 0);
      }
    }
  }, [models, selectedModels.length]);

  const readyImages = useMemo(
    () => images.filter((i) => i.enhanced || i.ops.length === 0),
    [images]
  );

  const toggleModel = (name: string) => {
    setSelectedModels((prev) => {
      if (prev.includes(name)) return prev.filter((m) => m !== name);
      if (prev.length >= 3) {
        toast.warning("الحد الأقصى 3 نماذج للسباق (توفيراً للكلفة)");
        return prev;
      }
      return [...prev, name];
    });
  };

  const onFiles = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) {
      toast.warning("اختر صورة واحدة للسباق");
      return;
    }
    setUploading(true);
    try {
      const f = imgs[0];
      const dataUrl = await readFileAsDataUrl(f);
      addImages([{ name: f.name, dataUrl }]);
      // تحسين سريع تلقائي بالبروفايل الحالي
      const added = useExtractorStore
        .getState()
        .images.find((i) => i.name === f.name);
      if (added) {
        setEnhancing(true);
        try {
          const res = await enhance(dataUrlToB64(dataUrl), settings.profile);
          updateImage(added.id, {
            enhanced: {
              b64: res.image_b64,
              plan: res.plan,
              analysis: res.analysis,
              profile: res.profile_used,
              ms: res.elapsed_ms,
            },
          });
        } catch {
          toast.info("التحسين السريع فشل — سيستخدم السباق الصورة الأصلية");
        } finally {
          setEnhancing(false);
        }
        setSelectedImageId(added.id);
        toast.success("أُضيفت الصورة للسباق");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الرفع");
    } finally {
      setUploading(false);
    }
  };

  const quickEnhance = async () => {
    if (!selectedImage) return;
    setEnhancing(true);
    try {
      const b64 = await getEnhanceB64(selectedImage);
      const res = await enhance(b64, settings.profile);
      updateImage(selectedImage.id, {
        enhanced: {
          b64: res.image_b64,
          plan: res.plan,
          analysis: res.analysis,
          profile: res.profile_used,
          ms: res.elapsed_ms,
        },
      });
      toast.success("تحسين سريع مكتمل");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التحسين");
    } finally {
      setEnhancing(false);
    }
  };

  const startRace = async () => {
    if (!selectedImage) {
      toast.warning("اختر صورة أولاً");
      return;
    }
    if (selectedModels.length < 1) {
      toast.warning("أضف نموذجاً واحداً على الأقل للسباق (يُفضّل 2–3 للمقارنة)");
      return;
    }
    resetBenchmark();
    setBenchmark({ running: true });
    try {
      const b64 = selectedImage.enhanced?.b64 ?? (await getEnhanceB64(selectedImage));
      const res = await runBenchmark({
        imageB64: b64,
        models: selectedModels,
        provider: settings.provider,
        baseUrl: settings.baseUrl || undefined,
        apiKey: getProviderKey(settings, settings.provider) || undefined,
      });
      setBenchmark({
        running: false,
        results: res.results,
        agreement_matrix: res.agreement_matrix,
        winner: res.winner,
        csv_report: res.csv_report,
      });
      toast.success(`🏁 انتهى السباق — الفائز: ${res.winner}`);
    } catch (e) {
      setBenchmark({ running: false });
      toast.error(e instanceof Error ? e.message : "فشل السباق");
    }
  };

  const adoptWinner = () => {
    if (!benchmark.winner) return;
    setSettings({ model: benchmark.winner });
    toast.success(`تم اعتماد ${benchmark.winner} كنموذج الجلسة`);
  };

  const downloadReport = async () => {
    if (!benchmark.csv_report) return;
    setDownloading(true);
    try {
      // محاولة عبر الخدمة أولاً (متسقة مع التنسيق) — وإلا Blob محلي
      const blob = new Blob(["\uFEFF" + benchmark.csv_report], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `benchmark_report_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("بدأ تنزيل تقرير السباق");
    } finally {
      setDownloading(false);
    }
  };

  const matrixPairs = useMemo(
    () => Object.entries(benchmark.agreement_matrix),
    [benchmark.agreement_matrix]
  );

  return (
    <div className="space-y-4">
      {/* 1) اختيار الصورة */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-bold text-sm">1. اختر صورة للسباق (يُفضل محسّنة)</h3>
          {images.length === 0 ? (
            <ImageDropZone onFiles={onFiles} multiple={false} disabled={uploading || enhancing}
              hint="ارفع صورة جدول واحدة — ستُحسَّن سريعاً بالبروفايل الحالي" />
          ) : (
            <>
              <div className="flex gap-3 overflow-x-auto custom-scroll pb-2">
                {images.map((img) => (
                  <div
                    key={img.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedImageId(img.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedImageId(img.id)}
                    className={`relative shrink-0 w-32 rounded-lg border-2 p-2 cursor-pointer transition-colors ${
                      selectedImageId === img.id
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                                  <img
                      src={img.previewUrl ?? img.dataUrl}
                      alt={img.name}
                      className="h-16 w-full object-contain rounded"
                    />
                    <p className="text-[10px] mt-1 truncate text-muted-foreground">{img.name}</p>
                    {img.enhanced && (
                      <Badge
                        variant="outline"
                        className="mt-1 text-[9px] px-1 border-primary/40 text-primary"
                      >
                        محسّن ✓
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" className="min-h-11" onClick={quickEnhance} disabled={!selectedImage || enhancing}>
                  {enhancing ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Sparkles className="h-4 w-4 me-1 text-primary" />}
                  تحسين سريع
                </Button>
              </div>
            </>
          )}
          {(uploading || enhancing) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحضير…
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2) اختيار النماذج */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-sm">2. اختر 2–3 نماذج</h3>
            {modelsSource && (
              <Badge variant="secondary" className="text-xs">
                {models.length} نموذج ({modelsSource === "live" ? "مباشر" : "احتياطي"})
              </Badge>
            )}
          </div>
          {models.length === 0 ? (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                لا قائمة نماذج بعد — اذهب لتبويب ⚙️ الإعدادات وأدخل مفتاحك لجلب النماذج، أو أضف أسماء نماذج يدوياً:
              </p>
              <div className="flex gap-2">
                <Input
                  value={manualModel}
                  onChange={(e) => setManualModel(e.target.value)}
                  placeholder="اسم النموذج مثل: glm-4.5v"
                  className="min-h-11"
                />
                <Button
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    const n = manualModel.trim();
                    if (!n) return;
                    if (!selectedModels.includes(n) && selectedModels.length < 3) {
                      setSelectedModels([...selectedModels, n]);
                      setManualModel("");
                    }
                  }}
                >
                  إضافة
                </Button>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-40 custom-scroll">
              <div className="flex flex-wrap gap-2 p-1">
                {models.map((m) => {
                  const active = selectedModels.includes(m.name);
                  return (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => toggleModel(m.name)}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-2 text-xs transition-colors min-h-11 ${
                        active
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border hover:bg-accent"
                      }`}
                    >
                      {m.free ? "⭐" : "💳"} {m.vision ? "👁" : "📄"} {m.name}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
          <Separator />
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              className="min-h-11 bg-primary hover:bg-primary/90 text-white"
              onClick={startRace}
              disabled={benchmark.running || !selectedImage || selectedModels.length < 1}
            >
              {benchmark.running ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <Flag className="h-4 w-4 me-1" />
              )}
              🏁 ابدأ السباق
            </Button>
            {selectedModels.length > 0 && (
              <span className="text-xs text-muted-foreground">
                المختارة: {selectedModels.join(" • ")}
              </span>
            )}
          </div>
          {benchmark.running && (
            <div className="space-y-1">
              <Progress value={40} className="animate-pulse" />
              <p className="text-xs text-muted-foreground text-center">
                السباق جارٍ — استخراج ومقارنة ودرجات لكل نموذج…
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3) النتائج */}
      {benchmark.results.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {benchmark.results.map((r) => {
              const isWinner = r.model === benchmark.winner;
              return (
                <Card key={r.model} className={isWinner ? "border-primary border-2" : ""}>
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-bold text-sm truncate" title={r.model}>
                        {isWinner && "🏆 "}
                        {r.model}
                      </p>
                      {isWinner && (
                        <Badge className="bg-primary/15 text-primary border border-primary/40">
                          <Crown className="h-3 w-3 me-1" /> الفائز
                        </Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">الدرجة</p>
                        <p className="font-bold text-primary tabular-nums">
                          {(r.score * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">الخلايا</p>
                        <p className="font-bold tabular-nums">{r.cells}</p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-2">
                        <p className="text-[10px] text-muted-foreground">الزمن</p>
                        <p className="font-bold tabular-nums">{(r.elapsed_ms / 1000).toFixed(1)} ث</p>
                      </div>
                    </div>
                    <CsvGrid csv={r.csv} maxHeight="max-h-36" />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* مصفوفة التوافق */}
          <Card>
            <CardContent className="p-4 space-y-2">
              <h3 className="font-bold text-sm">مصفوفة التوافق بين النماذج</h3>
              <div className="overflow-x-auto custom-scroll">
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {matrixPairs.map(([pair, val]) => {
                      const [a, b] = pair.split("|");
                      return (
                        <tr key={pair}>
                          <td className="border p-2 whitespace-nowrap">{a}</td>
                          <td className="border p-2 text-center text-muted-foreground">↔</td>
                          <td className="border p-2 whitespace-nowrap">{b}</td>
                          <td
                            className={`border p-2 text-center font-bold tabular-nums ${
                              val >= 0.9
                                ? "text-primary"
                                : val >= 0.7
                                  ? "text-tertiary"
                                  : "text-destructive"
                            }`}
                          >
                            {(val * 100).toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-2 flex-wrap pt-2">
                <Button
                  className="min-h-11 bg-primary hover:bg-primary/90 text-white"
                  onClick={adoptWinner}
                >
                  <Trophy className="h-4 w-4 me-1" /> اعتماد الفائز كنموذج الجلسة
                </Button>
                <Button variant="outline" className="min-h-11" onClick={downloadReport} disabled={downloading}>
                  {downloading ? <Loader2 className="h-4 w-4 me-1 animate-spin" /> : <Download className="h-4 w-4 me-1" />}
                  تنزيل تقرير CSV
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {models.length === 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <RefreshCw className="h-3 w-3" /> نصيحة: النماذج المجانية الرؤيوية تُسبق تلقائياً — السباق بين مجانيين = كلفة صفر.
        </p>
      )}
    </div>
  );
}
