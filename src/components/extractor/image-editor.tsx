"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Scissors,
  WandSparkles,
  Loader2,
  Check,
  Square,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { useExtractorStore, type ImageItem } from "@/lib/extractor/store";
import { loadImage, renderOpsToCanvas, makeThumb } from "@/lib/extractor/imaging";
import type { EditorOp } from "@/lib/extractor/types";

interface ImageEditorProps {
  image: ImageItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface DragState {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  active: boolean;
}

// حدود التكبير: 1× = ملاءمة العمود، 5× = أقصى دقة للقص الدقيق
const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.5;

// حجم الـcanvas المعروض بعد التكبير + إزاحته داخل الحاوية (قياس فعلي لا حسابات أثناء الرندر)
interface DisplayBox {
  w: number;
  h: number;
  ox: number;
  oy: number;
}

const OP_LABEL: Record<string, string> = {
  rot90: "تدوير 90°",
  rot180: "تدوير 180°",
  flip_h: "قلب أفقي",
  flip_v: "قلب رأسي",
  autocrop: "قص تلقائي",
};

export function ImageEditor({ image, open, onOpenChange }: ImageEditorProps) {
  const updateImage = useExtractorStore((s) => s.updateImage);

  const [ops, setOps] = useState<EditorOp[]>([]);
  const [bright, setBright] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [sel, setSel] = useState<DragState | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [disp, setDisp] = useState<DisplayBox | null>(null);
  // عدّاد يزداد بعد كل إعادة رسم للـcanvas — يضمن قياس التكبير بعد اكتمال الرسم دائماً
  const [paintTick, setPaintTick] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const origImgRef = useRef<HTMLImageElement | null>(null);

  // تهيئة الحالة عند فتح المحرر لصورة معينة
  useEffect(() => {
    if (open && image) {
      setOps([...image.ops]);
      const b = [...image.ops].reverse().find((o) => o.op === "bright");
      const c = [...image.ops].reverse().find((o) => o.op === "contrast");
      setBright(b && "params" in b ? (b.params as { value: number }).value : 0);
      setContrast(c && "params" in c ? (c.params as { value: number }).value : 0);
      setSel(null);
      setZoom(1);
      loadImage(image.dataUrl)
        .then((img) => {
          origImgRef.current = img;
          void paintWith(img, image.ops);
        })
        .catch(() => toast.error("فشل تحميل الصورة للمحرر"));
    }
    }, [open, image?.id]);

  const paintWith = useCallback(
    async (img: HTMLImageElement, opList: EditorOp[]) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      try {
        const out = await renderOpsToCanvas(img, opList);
        canvas.width = out.width;
        canvas.height = out.height;
        canvas.getContext("2d")!.drawImage(out, 0, 0);
        setPaintTick((t) => t + 1);
      } catch {
        // تجاهل أخطاء الرسم المؤقتة
      }
    },
    []
  );

  useEffect(() => {
    if (open && origImgRef.current) void paintWith(origImgRef.current, ops);
  }, [open, ops, paintWith]);

  // تطبيق التكبير بعد كل إعادة رسم (paintTick يضمن الترتيب) ثم قياس الحجم المعروض فعلياً
  // القياس يجري دائماً بكلاسات الملاءمة المفعّلة، وعند التكبير نتجاوز القيود بأنماط مضمنة فقط
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!open || !canvas) return;
    canvas.style.width = "";
    canvas.style.height = "";
    canvas.style.maxWidth = "";
    canvas.style.maxHeight = "";
    if (zoom !== 1) {
      const fitW = canvas.clientWidth;
      const fitH = canvas.clientHeight;
      if (fitW > 0 && fitH > 0) {
        canvas.style.maxWidth = "none";
        canvas.style.maxHeight = "none";
        canvas.style.width = `${Math.round(fitW * zoom)}px`;
        canvas.style.height = `${Math.round(fitH * zoom)}px`;
      }
    }
    setDisp({ w: canvas.clientWidth, h: canvas.clientHeight, ox: canvas.offsetLeft, oy: canvas.offsetTop });
  }, [zoom, ops, open, paintTick]);

  const zoomIn = () => setZoom((z) => Math.min(MAX_ZOOM, +(z + ZOOM_STEP).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(MIN_ZOOM, +(z - ZOOM_STEP).toFixed(2)));

  // ---------- القص بالسحب ----------
  const canvasPoint = (e: React.MouseEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  };

  const onMouseDown = (e: React.MouseEvent) => {
    const p = canvasPoint(e);
    if (!p) return;
    setSel({ startX: p.x, startY: p.y, curX: p.x, curY: p.y, active: true });
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!sel?.active) return;
    const p = canvasPoint(e);
    if (!p) return;
    setSel((s) => (s ? { ...s, curX: p.x, curY: p.y } : s));
  };
  const onMouseUp = () => {
    setSel((s) => (s ? { ...s, active: false } : s));
  };

  const selRect = sel
    ? {
        x: Math.min(sel.startX, sel.curX),
        y: Math.min(sel.startY, sel.curY),
        w: Math.abs(sel.curX - sel.startX),
        h: Math.abs(sel.curY - sel.startY),
      }
    : null;

  const selStyle: React.CSSProperties | undefined = (() => {
    const canvas = canvasRef.current;
    if (!canvas || !disp || !selRect || selRect.w < 3 || selRect.h < 3) return undefined;
    const scaleX = disp.w / canvas.width;
    const scaleY = disp.h / canvas.height;
    // الإزاحة داخل حاوية الـcanvas الملفوفة (inline-block) — صفر عادةً
    // لكنها دفاع مستقبلي إن أُضيفت هوامش/عناصر مجاورة حول الـcanvas
    return {
      position: "absolute",
      left: `${selRect.x * scaleX + disp.ox}px`,
      top: `${selRect.y * scaleY + disp.oy}px`,
      width: `${selRect.w * scaleX}px`,
      height: `${selRect.h * scaleY}px`,
      border: "2px dashed rgb(16,185,129)",
      borderRadius: "2px",
      background: "rgba(16,185,129,0.12)",
      pointerEvents: "none",
    };
  })();

  const pushOp = (op: EditorOp) => setOps((prev) => [...prev, op]);

  const rotateRight = () => {
    // يمين = 3 مرات يسار (المكدس يحفظ rot90 فقط كما في العقد)
    setOps((prev) => [...prev, { op: "rot90" }, { op: "rot90" }, { op: "rot90" }]);
  };

  // تحديد كامل أبعاد الـcanvas الحالية — مفيد بعد التدوير
  const selectAll = () => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.width || !canvas.height) return;
    setSel({ startX: 0, startY: 0, curX: canvas.width, curY: canvas.height, active: false });
  };

  const applyCrop = () => {
    if (!selRect || selRect.w < 5 || selRect.h < 5) {
      toast.warning("اسحب على المعاينة لتحديد منطقة القص أولاً");
      return;
    }
    pushOp({
      op: "crop",
      params: {
        x: Math.round(selRect.x),
        y: Math.round(selRect.y),
        w: Math.round(selRect.w),
        h: Math.round(selRect.h),
      },
    });
    setSel(null);
    toast.success("أُضيفت عملية القص إلى المكدس");
  };

  const autoCrop = () => {
    pushOp({ op: "autocrop" });
    toast.success("أُضيف القص التلقائي للهوامش (حدود غير بيضاء)");
  };

  const setTone = (kind: "bright" | "contrast", value: number) => {
    setOps((prev) => {
      const without = prev.filter((o) => o.op !== kind);
      if (value !== 0) without.push({ op: kind, params: { value } });
      return without;
    });
  };

  const resetAll = () => {
    setOps([]);
    setBright(0);
    setContrast(0);
    setSel(null);
    toast.info("أُعيد تعيين مكدس العمليات");
  };

  const applyOps = async () => {
    if (!image) return;
    setBusy(true);
    try {
      let previewUrl: string | undefined;
      if (ops.length > 0) {
        const img = origImgRef.current ?? (await loadImage(image.dataUrl));
        const out = await renderOpsToCanvas(img, ops);
        previewUrl = await makeThumb(out.toDataURL("image/png"));
      }
      updateImage(image.id, { ops: [...ops], previewUrl });
      toast.success(
        ops.length > 0 ? `تطبيق ${ops.length} عملية — الأصل لم يُلمس` : "لا عمليات — سيستخدم الأصل"
      );
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل تطبيق العمليات");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto custom-scroll" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            ✏️ تحرير غير إتلافي —{" "}
            <span className="text-muted-foreground text-sm font-normal">{image?.name}</span>
          </DialogTitle>
          <DialogDescription>
            العمليات تُطبَّق لحظة «تطبيق/استخراج» فقط — الصورة الأصلية تبقى سليمة دائماً.
          </DialogDescription>
        </DialogHeader>

        {image && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* الأصل */}
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground">الأصل (سليم دائماً)</p>
                <div className="rounded-lg border bg-muted/30 p-2 flex items-center justify-center min-h-40">
                              <img src={image.dataUrl} alt="الأصل" className="max-h-72 max-w-full w-auto object-contain" />
                </div>
              </div>

              {/* المعاينة الحية */}
              <div className="space-y-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    المعاينة الحية (بعد المكدس: {ops.length} عملية)
                  </p>
                  {/* أدوات التكبير */}
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-11 p-0"
                      onClick={zoomOut}
                      disabled={zoom <= MIN_ZOOM}
                      title="تصغير المعاينة"
                      aria-label="تصغير المعاينة"
                    >
                      <ZoomOut className="h-4 w-4" />
                    </Button>
                    <Badge
                      variant="secondary"
                      className="tabular-nums min-w-12 text-center"
                      title="نسبة التكبير نسبةً إلى ملاءمة العمود (100% = ملاءمة)"
                    >
                      {Math.round(zoom * 100)}%
                    </Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11 w-11 p-0"
                      onClick={zoomIn}
                      disabled={zoom >= MAX_ZOOM}
                      title="تكبير المعاينة — لدقة قص أعلى"
                      aria-label="تكبير المعاينة"
                    >
                      <ZoomIn className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      onClick={() => setZoom(1)}
                      disabled={zoom === 1}
                      title="إعادة المعاينة إلى ملاءمة العمود"
                    >
                      <Maximize2 className="h-4 w-4 me-1" /> ملاءمة
                    </Button>
                  </div>
                </div>
                <div className="relative rounded-lg border bg-muted/30 p-2">
                  {/* إطار تمرير: يتيح التنقل داخل الصورة عند التكبير، وm-auto يوسّط
                      العنصر الأصغر بأمان دون قصّه عند تجاوزه حجم الإطار */}
                  <div className="max-h-80 min-h-40 overflow-auto custom-scroll flex">
                    {/* حاوية بحجم الـcanvas المعروض تماماً (inline-block + leading-none)
                        حتى تُحسب إحداثيات مستطيل التحديد نسبةً إلى الـcanvas لا إلى صندوق الحاوية (padding/توسيط) */}
                    <div className="relative inline-block leading-none m-auto">
                      <canvas
                        ref={canvasRef}
                        onMouseDown={onMouseDown}
                        onMouseMove={onMouseMove}
                        onMouseUp={onMouseUp}
                        onMouseLeave={onMouseUp}
                        className="max-h-72 max-w-full w-auto object-contain cursor-crosshair touch-none"
                        aria-label="معاينة الصورة بعد العمليات"
                      />
                      {selStyle && <div style={selStyle} />}
                    </div>
                  </div>
                </div>
                {zoom > 1 && (
                  <p className="text-xs text-muted-foreground">
                    مُكبّر {Math.round(zoom * 100)}% — مرّر داخل الإطار (أشرطة التمرير) للتنقل، ثم اسحب للتحديد بدقة أعلى
                  </p>
                )}
              </div>
            </div>

            <Separator />

            {/* أدوات التحويل */}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => pushOp({ op: "rot90" })}>
                <RotateCcw className="h-4 w-4 me-1" /> تدوير 90° يسار
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={rotateRight}>
                <RotateCw className="h-4 w-4 me-1" /> تدوير 90° يمين
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => pushOp({ op: "flip_h" })}>
                <FlipHorizontal className="h-4 w-4 me-1" /> قلب أفقي
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={() => pushOp({ op: "flip_v" })}>
                <FlipVertical className="h-4 w-4 me-1" /> قلب رأسي
              </Button>
              <Button variant="outline" size="sm" className="min-h-11" onClick={autoCrop}>
                <WandSparkles className="h-4 w-4 me-1" /> قص هوامش تلقائي
              </Button>
            </div>

            {/* القص اليدوي */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={selectAll}
                title="يحدّد كامل أبعاد الصورة الحالية (مفيد بعد التدوير)"
              >
                <Square className="h-4 w-4 me-1" /> تحديد كامل الصورة
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="min-h-11"
                onClick={applyCrop}
                disabled={!selRect || selRect.w < 5 || selRect.h < 5}
              >
                <Scissors className="h-4 w-4 me-1" /> تطبيق القص المحدد
              </Button>
              {selRect && selRect.w >= 5 && selRect.h >= 5 && (
                <Badge
                  variant="outline"
                  className="border-primary/40 text-primary"
                >
                  تحديد: {Math.round(selRect.w)}×{Math.round(selRect.h)} px
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                اسحب بالفأرة على المعاينة لرسم مستطيل القص
              </span>
            </div>

            {/* المنزلقات */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">السطوع</span>
                  <span className="text-muted-foreground tabular-nums">{bright}</span>
                </div>
                <Slider
                  value={[bright]}
                  min={-50}
                  max={50}
                  step={1}
                  onValueChange={(v) => {
                    setBright(v[0]);
                    setTone("bright", v[0]);
                  }}
                  aria-label="سطوع الصورة"
                />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-semibold">التباين</span>
                  <span className="text-muted-foreground tabular-nums">{contrast}</span>
                </div>
                <Slider
                  value={[contrast]}
                  min={-50}
                  max={50}
                  step={1}
                  onValueChange={(v) => {
                    setContrast(v[0]);
                    setTone("contrast", v[0]);
                  }}
                  aria-label="تباين الصورة"
                />
              </div>
            </div>

            {/* المكدس */}
            <div className="max-h-28 overflow-y-auto custom-scroll rounded-lg border bg-muted/30 p-2">
              {ops.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  المكدس فارغ — ستُستخدم الصورة الأصلية
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {ops.map((o, i) => (
                    <Badge key={i} variant="secondary" className="text-xs">
                      {o.op === "crop"
                        ? `قص (${Math.round(o.params.x)},${Math.round(o.params.y)} ${Math.round(o.params.w)}×${Math.round(o.params.h)})`
                        : o.op === "bright"
                          ? `سطوع ${o.params.value}`
                          : o.op === "contrast"
                            ? `تباين ${o.params.value}`
                            : (OP_LABEL[o.op] ?? o.op)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* أزرار الحفظ */}
            <div className="flex flex-wrap gap-2 justify-start">
              <Button
                onClick={applyOps}
                disabled={busy}
                className="min-h-11 bg-primary hover:bg-primary/90 text-white"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 me-1 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 me-1" />
                )}
                تطبيق وحفظ المكدس
              </Button>
              <Button variant="outline" className="min-h-11" onClick={resetAll} disabled={busy}>
                Reset — مسح كل العمليات
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
