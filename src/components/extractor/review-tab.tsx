"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Input,
  Progress,
  Separator,
} from "./ui-bundle";
import {
  CheckCheck,
  GraduationCap,
  Loader2,
  SearchCheck,
  ZoomIn,
  Inbox,
} from "lucide-react";
import { useExtractorStore, parseCsvSimple } from "@/lib/extractor/store";
import { kbLearn, kbStats } from "@/lib/extractor/api";
import { MECHANIC_FIELDS } from "@/lib/extractor/types";

export function ReviewTab() {
  const reviewQueue = useExtractorStore((s) => s.reviewQueue);
  const removeReviewItem = useExtractorStore((s) => s.removeReviewItem);
  const images = useExtractorStore((s) => s.images);
  const tableResults = useExtractorStore((s) => s.tableResults);
  const mechanicRecords = useExtractorStore((s) => s.mechanicRecords);
  const setTableValue = useExtractorStore((s) => s.setTableValue);
  const setMechanicFieldValue = useExtractorStore((s) => s.setMechanicFieldValue);
  const clearReviewQueue = useExtractorStore((s) => s.clearReviewQueue);
  const kbEntries = useExtractorStore((s) => s.kbEntries);
  const kbCorrections = useExtractorStore((s) => s.kbCorrections);
  const setKb = useExtractorStore((s) => s.setKb);

  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [learningId, setLearningId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<Record<string, number>>({});

  // إحصاءات KB عند التحميل
  const refreshKb = useCallback(async () => {
    try {
      const stats = await kbStats();
      const total = Object.values(stats.by_field || {}).reduce(
        (a: number, b) => a + (Number(b) || 0),
        0
      );
      setKb(stats.entries || 0, total);
    } catch {
      // الخدمة غير متصلة — تجاهل
    }
  }, [setKb]);

  useEffect(() => {
    void refreshKb();
  }, [refreshKb]);

  // إجمالي الحقول لكل الجلسة (خلايا الجداول + حقول السجلات)
  const totalFields = useMemo(() => {
    let n = 0;
    for (const t of tableResults) n += parseCsvSimple(t.csv).reduce((a, row) => a + row.length, 0);
    n += mechanicRecords.length * MECHANIC_FIELDS.length;
    return n;
  }, [tableResults, mechanicRecords]);

  const pct = totalFields > 0 ? (reviewQueue.length / totalFields) * 100 : 0;

  const approve = (id: string) => {
    removeReviewItem(id);
    toast.success("اعتُمدت القيمة كما هي — أُزيلت من الطابور");
  };

  const correctAndLearn = async (
    id: string,
    scope: "tables" | "mechanic",
    field: string,
    wrong: string,
    recordId?: string,
    resultId?: string,
    rowIdx?: number,
    colIdx?: number
  ) => {
    const right = (corrections[id] ?? "").trim();
    if (!right) {
      toast.warning("أدخل القيمة الصحيحة أولاً");
      return;
    }
    setLearningId(id);
    try {
      // 1) تصحيح القيمة في المخزن أينما ظهرت
      if (scope === "tables" && resultId !== undefined && rowIdx !== undefined && colIdx !== undefined) {
        setTableValue(resultId, rowIdx, colIdx, right);
      } else if (scope === "mechanic" && recordId) {
        setMechanicFieldValue(recordId, field, right);
      }
      // 2) تعليم قاعدة المعرفة
      await kbLearn({ scope, field, wrong, right });
      await refreshKb();
      removeReviewItem(id);
      setCorrections((c) => {
        const next = { ...c };
        delete next[id];
        return next;
      });
      toast.success("صُحّحت القيمة وعُلّمت قاعدة المعرفة — النظام سيتعلم منها");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل التعليم — تأكد من اتصال الخدمة");
    } finally {
      setLearningId(null);
    }
  };

  const imageFor = (imageId?: string, recordId?: string) => {
    if (imageId) {
      const img = images.find((i) => i.id === imageId);
      if (img) return img.previewUrl ?? img.dataUrl;
    }
    if (recordId) {
      const rec = mechanicRecords.find((r) => r.id === recordId);
      if (rec && rec.faces.length > 0) return rec.faces[0];
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* الشريط العلوي: إحصاءات */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold text-sm flex items-center gap-1">
              <SearchCheck className="h-4 w-4 text-primary" /> طابور التدقيق — الغموض يُعلَّم ولا يُخمَّن
            </h3>
            {reviewQueue.length > 0 && (
              <Button variant="ghost" size="sm" className="min-h-11 text-destructive" onClick={clearReviewQueue}>
                إفراغ الطابور
              </Button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[11px] text-muted-foreground">عناصر للمراجعة</p>
              <p className="text-xl font-bold text-destructive tabular-nums">
                {reviewQueue.length}
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[11px] text-muted-foreground">من إجمالي الحقول</p>
              <p
                className={`text-xl font-bold tabular-nums ${
                  pct < 10 ? "text-primary" : "text-tertiary"
                }`}
              >
                {pct.toFixed(1)}%
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-[11px] text-muted-foreground">تصحيحات KB المكتسبة</p>
              <p className="text-xl font-bold tabular-nums">{kbCorrections}</p>
            </div>
          </div>
          <Progress value={Math.min(100, pct * 10)} aria-label="نسبة عناصر المراجعة" />
          <p className="text-[11px] text-muted-foreground text-center">
            الهدف: أقل من 10% من الحقول — المؤشر ممتلئ عند بلوغ الحد
          </p>
        </CardContent>
      </Card>

      {/* العناصر */}
      {reviewQueue.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center space-y-2">
            <Inbox className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-semibold">الطابور فارغ — لا عناصر مراجعة</p>
            <p className="text-xs text-muted-foreground">
              تُضاف الخلايا الغامضة (UNCLEAR) تلقائياً بعد استخراج الجداول، وخلايا REVIEW/MED في الميكانيك
              بالنقر عليها في جدول السجلات.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {reviewQueue.map((item) => {
            const imgSrc = imageFor(item.imageId, item.recordId);
            const z = zoom[item.id] ?? 1;
            return (
              <Card key={item.id} className="border-2 border-destructive/30">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">
                        {item.label || item.field}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {item.scope === "tables" ? "📊 جداول" : "🚗 ميكانيك"} • {item.field}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        item.confidence === "MED"
                          ? "border-tertiary/40 text-tertiary bg-tertiary/10"
                          : "border-destructive/40 text-destructive bg-destructive/10"
                      }
                    >
                      {item.confidence}
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-muted/50 p-2 text-center">
                    <p className="text-[10px] text-muted-foreground">القيمة الحالية</p>
                    <p className="font-bold text-sm break-all">{item.value || "—"}</p>
                  </div>

                  {item.reasons.length > 0 && (
                    <ul className="list-disc space-y-0.5 pe-5 text-xs text-muted-foreground">
                      {item.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}

                  {/* الصورة ذات الصلة مع تكبير */}
                  {imgSrc && (
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ZoomIn className="h-3.5 w-3.5" />
                        <span>تكبير القراءة</span>
                        <span className="tabular-nums">{z.toFixed(1)}x</span>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={4}
                        step={0.5}
                        value={z}
                        aria-label="مستوى التكبير"
                        onChange={(e) =>
                          setZoom((zz) => ({ ...zz, [item.id]: Number(e.target.value) }))
                        }
                        className="w-full accent-primary"
                      />
                      <div className="max-h-56 overflow-auto custom-scroll rounded-lg border bg-white dark:bg-zinc-900">
                                          <img
                          src={imgSrc}
                          alt={`صورة المراجعة — ${item.label}`}
                          style={{ transform: `scale(${z})`, transformOrigin: "top center" }}
                          className="w-full object-contain"
                        />
                      </div>
                    </div>
                  )}

                  <Separator />

                  {/* الإجراءات */}
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button
                      variant="outline"
                      className="min-h-11 flex-1"
                      onClick={() => approve(item.id)}
                    >
                      <CheckCheck className="h-4 w-4 me-1 text-primary" /> اعتماد كما هو
                    </Button>
                    <div className="flex flex-1 gap-2">
                      <Input
                        value={corrections[item.id] ?? ""}
                        onChange={(e) =>
                          setCorrections((c) => ({ ...c, [item.id]: e.target.value }))
                        }
                        placeholder="القيمة الصحيحة…"
                        className="min-h-11"
                      />
                      <Button
                        className="min-h-11 bg-primary hover:bg-primary/90 text-white shrink-0"
                        onClick={() =>
                          correctAndLearn(
                            item.id,
                            item.scope,
                            item.field,
                            item.value,
                            item.recordId,
                            item.resultId,
                            item.rowIdx,
                            item.colIdx
                          )
                        }
                        disabled={learningId === item.id}
                      >
                        {learningId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <GraduationCap className="h-4 w-4" />
                        )}
                        تصحيح وتعليم
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
