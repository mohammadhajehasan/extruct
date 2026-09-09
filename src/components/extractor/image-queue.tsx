"use client";

/**
 * image-queue.tsx — طابور الإدخال الموحّد (الخطة 15.8.1 → 15.8.5)
 * - 15.8.1: يقبل صوراً متعددة + PDF بنفس الوقت (المعالجة عند الأب، الطابور هنا)
 * - 15.8.2: نقرة المصغّرة → محرر الجزء 5 بمعاينة كاملة (قبل/بعد)
 * - 15.8.2: تبديل ثنائي سريع — تحديد صورتين ⇄ + زر Swap
 * - 15.8.2: سحب وإفلات لإعادة الترتيب يدوياً + أزرار نقل للوصولية
 * - 15.8.2: تحرير كل صورة دون التأثير على البقية (مكدس غير إتلافي لكل عنصر)
 * - 15.8.3: طابور موحّد بغض النظر عن المصدر (صورة/PDF صفحة/مزيج) + شارة الملف الأصلي
 * - 15.8.4/15.8.5: نفس المكوّن للجداول والميكانيك
 */
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
} from "./ui-bundle";
import {
  ArrowLeftRight,
  ArrowRight,
  FileText,
  GripVertical,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import { ImageDropZone } from "./image-drop-zone";
import { ImageEditor } from "./image-editor";
import { useExtractorStore, type ImageItem } from "@/lib/extractor/store";

interface ImageQueueProps {
  onFiles: (files: File[]) => void | Promise<void>;
  busy?: boolean;
  busyText?: string;
  dropHint?: string;
  /** شارة إضافية لكل عنصر (مثل تصنيف الميكانيك) */
  badge?: (img: ImageItem) => ReactNode;
  /** عناصر إضافية في رأس الطابور (مثل زر استخراج الكل) */
  headerRight?: ReactNode;
  /** تحديد الصورة الحالية (لأدوات الأب: تحسين/استخراج) */
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  title?: string;
}

export function ImageQueue({
  onFiles,
  busy,
  busyText,
  dropHint,
  badge,
  headerRight,
  selectedId,
  onSelect,
  title = "طابور الإدخال الموحّد",
}: ImageQueueProps) {
  const images = useExtractorStore((s) => s.images);
  const removeImage = useExtractorStore((s) => s.removeImage);
  const moveImage = useExtractorStore((s) => s.moveImage);
  const swapImages = useExtractorStore((s) => s.swapImages);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [swapIds, setSwapIds] = useState<string[]>([]);
  const [editorId, setEditorId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // اشتقاق أثناء التصيير بدل effect — يتجاهل تلقائياً المحددات المحذوفة من الطابور
  const validSwapIds = swapIds.filter((id) => images.some((i) => i.id === id));
  const editorImage = images.find((i) => i.id === editorId) ?? null;

  const toggleSwapSelect = (id: string) => {
    if (validSwapIds.includes(id)) {
      setSwapIds(validSwapIds.filter((x) => x !== id));
      return;
    }
    if (validSwapIds.length >= 2) {
      setSwapIds([validSwapIds[1], id]);
      return;
    }
    setSwapIds([...validSwapIds, id]);
  };

  const doSwap = () => {
    if (validSwapIds.length !== 2) return;
    swapImages(validSwapIds[0], validSwapIds[1]);
    toast.success("تم تبديل موضعي الصورتين");
    setSwapIds([]);
  };

  const moveNeighbor = (id: string, dir: -1 | 1) => {
    const idx = images.findIndex((i) => i.id === id);
    const target = images[idx + dir];
    if (target) moveImage(id, target.id);
  };

  const openEditor = (id: string) => {
    setEditorId(id);
    setEditorOpen(true);
    onSelect?.(id);
  };

  const sourceBadge = (img: ImageItem) =>
    img.sourceType === "pdf_page" ? (
      <Badge
        variant="outline"
        className="text-[9px] px-1 py-0 border-info/40 text-info"
        title={`من ملف: ${img.sourceFile ?? ""}`}
      >
        <FileText className="h-2.5 w-2.5 me-0.5" />
        PDF ص{img.sourcePage ?? "؟"}
      </Badge>
    ) : (
      <Badge variant="outline" className="text-[9px] px-1 py-0" title={img.sourceFile ?? img.name}>
        صورة
      </Badge>
    );

  return (
    <div className="space-y-3">
      {/* 15.8.1 — رفع متعدد (صور + PDF معاً في دفعة واحدة) */}
      <ImageDropZone onFiles={onFiles} disabled={busy} hint={dropHint} />
      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {busyText ?? "جارٍ المعالجة…"}
        </div>
      )}

      {images.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-bold text-sm flex items-center gap-1">
                <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden />
                {title} ({images.length})
                <span className="text-[10px] font-normal text-muted-foreground">
                  — اسحب المصغّرات لإعادة الترتيب
                </span>
              </h3>
              {headerRight}
            </div>

            {/* شريط التبديل الثنائي 15.8.2 */}
            {validSwapIds.length === 2 ? (
              <div className="flex items-center gap-2 flex-wrap rounded-lg border border-tertiary/40 bg-tertiary/10 p-2">
                <ArrowLeftRight className="h-4 w-4 text-tertiary" aria-hidden />
                <span className="text-xs font-semibold text-tertiary">
                  تبديل ثنائي: {images.find((i) => i.id === validSwapIds[0])?.name} ⇄{" "}
                  {images.find((i) => i.id === validSwapIds[1])?.name}
                </span>
                <Button size="sm" className="min-h-9 bg-tertiary hover:bg-tertiary/90 text-white" onClick={doSwap}>
                  ⇄ Swap
                </Button>
                <Button size="sm" variant="ghost" className="min-h-9" onClick={() => setSwapIds([])}>
                  إلغاء
                </Button>
              </div>
            ) : (
              validSwapIds.length === 1 && (
                <p className="text-xs text-tertiary">
                  حدّد صورة ثانية (⇄) لتفعيل التبديل الثنائي السريع
                </p>
              )
            )}

            <div className="flex gap-3 overflow-x-auto custom-scroll pb-2">
              {images.map((img, idx) => {
                const isSelected = selectedId === img.id;
                const isSwapSel = validSwapIds.includes(img.id);
                return (
                  <div
                    key={img.id}
                    draggable
                    onDragStart={(e) => {
                      setDragId(img.id);
                      e.dataTransfer.effectAllowed = "move";
                      try {
                        e.dataTransfer.setData("text/plain", img.id);
                      } catch {
                        /* Safari قديم */
                      }
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragId && dragId !== img.id) setOverId(img.id);
                    }}
                    onDragLeave={() => setOverId((o) => (o === img.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const src = dragId ?? e.dataTransfer.getData("text/plain");
                      if (src && src !== img.id) {
                        moveImage(src, img.id);
                        toast.success("أُعيد ترتيب الطابور");
                      }
                      setDragId(null);
                      setOverId(null);
                    }}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverId(null);
                    }}
                    className={`relative shrink-0 w-36 rounded-lg border-2 p-2 transition-colors ${
                      dragId === img.id
                        ? "opacity-40 border-dashed"
                        : isSwapSel
                          ? "border-tertiary/60 bg-tertiary/10"
                          : isSelected
                            ? "border-primary bg-primary/10"
                            : overId === img.id
                              ? "border-info/70 bg-info/10"
                              : "border-border hover:border-primary/40"
                    }`}
                  >
                    {/* مؤشر السحب + الترتيب */}
                    <span
                      className="absolute top-0 start-0 h-5 px-1 text-[9px] text-muted-foreground cursor-grab active:cursor-grabbing select-none"
                      title="اسحب لإعادة الترتيب — أو استخدم أزرار النقل"
                    >
                      ≡ #{idx + 1}
                    </span>
                    {/* 15.8.2 نقرة المصغّرة → محرر بمعاينة كاملة */}
                    <button
                      type="button"
                      onClick={() => openEditor(img.id)}
                      className="block w-full cursor-zoom-in"
                      aria-label={`معاينة وتحرير ${img.name}`}
                    >
                      <img
                        src={img.previewUrl ?? img.dataUrl}
                        alt={img.name}
                        className="h-16 w-full object-contain rounded mt-3"
                      />
                    </button>
                    <p className="text-[10px] mt-1 truncate text-muted-foreground" title={img.name}>
                      {img.name}
                    </p>
                    <div className="flex gap-1 mt-1 flex-wrap items-center">
                      {sourceBadge(img)}
                      {img.ops.length > 0 && (
                        <Badge variant="secondary" className="text-[9px] px-1 py-0">
                          محرر ✓
                        </Badge>
                      )}
                      {img.enhanced && (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 py-0 border-primary/40 text-primary"
                        >
                          محسّن ✓
                        </Badge>
                      )}
                      {badge?.(img)}
                    </div>

                    {/* أدوات العنصر: تحرير/تبديل/نقل/حذف */}
                    <div className="flex gap-0.5 mt-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`تحرير ${img.name}`}
                        title="تحرير (تدوير/قص/سطوع/حدة) — لا يؤثر على البقية"
                        onClick={() => openEditor(img.id)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 ${isSwapSel ? "text-tertiary" : ""}`}
                        aria-label={`تحديد للتبديل: ${img.name}`}
                        title="تحديد للتبديل الثنائي (اختر صورتين ثم Swap)"
                        onClick={() => toggleSwapSelect(img.id)}
                      >
                        <ArrowLeftRight className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`نقل ${img.name} لليسار`}
                        title="نقل لليسار"
                        onClick={() => moveNeighbor(img.id, -1)}
                      >
                        <ArrowRight className="h-3 w-3 rotate-180" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        aria-label={`نقل ${img.name} لليمين`}
                        title="نقل لليمين"
                        onClick={() => moveNeighbor(img.id, 1)}
                      >
                        <ArrowRight className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        aria-label={`حذف ${img.name}`}
                        title="حذف من الطابور"
                        onClick={() => {
                          removeImage(img.id);
                          if (selectedId === img.id) onSelect?.("");
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 15.8.2 — محرر الجزء 5 بمعاينة كاملة لكل صورة دون التأثير على البقية */}
      <ImageEditor
        image={editorImage}
        open={editorOpen && !!editorImage}
        onOpenChange={setEditorOpen}
      />
    </div>
  );
}
