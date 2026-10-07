"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import { PY, b64ToDataUrl } from "./api";
import type {
  EditorOp,
  ModelInfo,
  EnhancedImage,
  AuditEntry,
  BenchmarkResult,
  Confidence,
  ProviderStatus,
  MechanicParsed,
} from "./types";
import { getExtractB64 } from "./imaging";
import { smartExtract } from "./failover";

// ---------- الإعدادات (تُحفظ في localStorage فقط — المفاتيح تبقى في المتصفح) ----------
export interface ExtractorSettings {
  provider: string;
  model: string;
  baseUrl: string;
  providerKeys: Record<string, string>;
  freeFirst: boolean;
  visionOnly: boolean;
  profile: string;
  dpi: number;
  concurrency: number;
  consensusEnabled: boolean;
  failoverEnabled: boolean;
  // 15.10.8 مزودات مخصصة متعددة — كل واحدة لها baseUrl/اسم مستقل
  customProviders: Array<{ id: string; name_ar: string; baseUrl: string; needsKey: boolean }>;
}

export const DEFAULT_SETTINGS: ExtractorSettings = {
  provider: "zai",
  model: "glm-4.5v",
  baseUrl: "",
  providerKeys: {},
  freeFirst: true,
  visionOnly: false,
  profile: "darken_clarity",
  dpi: 300,
  concurrency: 3,
  consensusEnabled: true,
  failoverEnabled: false,
  customProviders: [],
};

/** مفتاح مزود محدد — مُقَصّص دائماً ("" إن لم يُحفظ شيء) */
export function getProviderKey(settings: ExtractorSettings, providerId: string): string {
  return (settings.providerKeys?.[providerId] ?? "").trim();
}

/** التحقق من صحة المفتاح للمزود — تُستدعى عند الحفظ */
export async function validateProviderKey(providerId: string, apiKey: string, baseUrl: string): Promise<{ valid: boolean; errorAr?: string }> {
  // OAuth-2026: التحقق من المفتاح بإرساله إلى ping_provider الخاص بالمزود
  // يستقبل {available, error_type, error_ar} فقط ولا يُخزّن المفتاح
  try {
    const res = await fetch(`${PY}/api/py/providers/health`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, timeout: 10 })
    });
    const data = await res.json();
    if (data.ok && data.error_type !== "auth_invalid") {
      return { valid: true };
    }
    return { valid: false, errorAr: data.error_ar || "مفتاح غير صالح لهذا المزود" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return { valid: false, errorAr: `تعذر الاتصال بالمزود للتحقق (${detail})` };
  }
}

/**
 * توحيد الإعدادات القادمة من التخزين المحلي: يملأ الحقول الجديدة من الافتراضي
 * ويقصّ القيم التالفة — يُستخدم في merge (كل تهيئة) و migrate (تغيّر الإصدار).
 * يمنع انكسار «controlled input» عند إضافة حقول مستقبلاً (مثل concurrency)
 * لأن الدمج الافتراضي في zustand يستبدل كائن settings كاملاً بلا دمج عميق.
 */
function withSettingsDefaults(s?: Partial<ExtractorSettings> | null): ExtractorSettings {
  const m = { ...DEFAULT_SETTINGS, ...(s ?? {}) } as ExtractorSettings;
  const cc = Number(m.concurrency);
  m.concurrency = Number.isFinite(cc)
    ? Math.min(6, Math.max(1, Math.round(cc)))
    : DEFAULT_SETTINGS.concurrency;
  const dpi = Number(m.dpi);
  m.dpi = Number.isFinite(dpi)
    ? Math.min(400, Math.max(50, Math.round(dpi)))
    : DEFAULT_SETTINGS.dpi;
  if (!m.providerKeys || typeof m.providerKeys !== "object" || Array.isArray(m.providerKeys)) {
    m.providerKeys = {};
  } else {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.providerKeys)) {
      if (typeof v === "string" && v.trim()) clean[k] = v.trim();
    }
    m.providerKeys = clean;
  }
  if (m.provider === "zai" && !m.baseUrl.trim()) {
    m.baseUrl = "https://api.z.ai/api/paas/v4";
  }
  return m;
}

// ---------- عناصر الصور (الأصل لا يُلمس أبداً) ----------
// 15.8.3: تتبّع مصدر كل عنصر — صورة منفصلة أم صفحة PDF من أي ملف (طابور موحّد)
export interface ImageItem {
  id: string;
  name: string;
  dataUrl: string; // الأصل دائماً
  ops: EditorOp[]; // مكدس غير إتلافي
  enhanced?: EnhancedImage;
  previewUrl?: string; // مصغرة بعد تطبيق ops (للعرض فقط)
  label?: string; // تصنيف الميكانيك
  labelConfidence?: number;
  sourceType?: "image" | "pdf_page"; // 15.8.3 مصدر العنصر
  sourceFile?: string; // 15.8.3 اسم الملف الأصلي
  sourcePage?: number; // 15.8.3 رقم صفحة الـPDF (1-مبني)
}

export interface TableResult {
  id: string;
  imageId: string;
  imageName: string;
  imageDataUrl?: string; // الصورة الأصلية كنموذج للربط (dataUrl)
  csv: string;
  rows: number;
  model: string;
  elapsed_ms: number;
  native?: boolean; // PDF نصي — دقة 100% بلا نموذج
}

export interface MechanicRecord {
  id: string;
  category_key: string;
  category_ar: string;
  faces: string[]; // dataUrls للعرض
  faceB64s: string[]; // base64 خام لإعادة الاستخراج
  method?: "barcode" | "adjacency";
  fields: Record<string, string>;
  vin_valid?: boolean;
  flags: Record<string, { confidence: Confidence; reasons: string[] }>;
  sourceFiles?: string[]; // 15.8.3 الملفات الأصلية لوجوه السجل
}

export interface ReviewItem {
  id: string;
  scope: "tables" | "mechanic";
  field: string;
  label: string;
  value: string;
  confidence: Confidence;
  reasons: string[];
  imageId?: string;
  recordId?: string;
  resultId?: string;
  rowIdx?: number;
  colIdx?: number;
}

export interface BenchmarkState {
  running: boolean;
  results: BenchmarkResult[];
  agreement_matrix: Record<string, number>;
  winner: string;
  csv_report: string;
}

export interface HealthState {
  connected: boolean;
  version?: string;
  capabilities?: { barcode: boolean; ocr: boolean };
  lastCheck?: number;
}

interface ExtractorStore {
  // الإعدادات
  settings: ExtractorSettings;
  setSettings: (p: Partial<ExtractorSettings>) => void;
  resetSettings: () => void;
  addCustomProvider: (p: { id: string; name_ar: string; baseUrl: string; needsKey: boolean }) => void;
  removeCustomProvider: (id: string) => void;
  updateCustomProvider: (id: string, p: Partial<{ name_ar: string; baseUrl: string; needsKey: boolean }>) => void;

  // النماذج
  models: ModelInfo[];
  modelsSource: "live" | "fallback" | null;
  modelsFetching: boolean;
  setModels: (m: ModelInfo[], source: "live" | "fallback") => void;
  setModelsFetching: (b: boolean) => void;

  // الصور
  images: ImageItem[];
  addImages: (
    items: {
      name: string;
      dataUrl: string;
      sourceType?: "image" | "pdf_page";
      sourceFile?: string;
      sourcePage?: number;
    }[]
  ) => void;
  removeImage: (id: string) => void;
  clearImages: () => void;
  updateImage: (id: string, p: Partial<ImageItem>) => void;
  moveImage: (fromId: string, toId: string) => void; // 15.8.2 سحب وإفلات
  swapImages: (idA: string, idB: string) => void; // 15.8.2 تبديل ثنائي

  // نتائج الجداول
  tableResults: TableResult[];
  addTableResult: (r: TableResult) => void;
  removeTableResult: (id: string) => void;
  clearTableResults: () => void;
  setTableValue: (resultId: string, rowIdx: number, colIdx: number, value: string) => void;

  // سجلات الميكانيك
  mechanicRecords: MechanicRecord[];
  addMechanicRecord: (r: MechanicRecord) => void;
  updateMechanicRecord: (id: string, p: Partial<MechanicRecord>) => void;
  setMechanicFieldValue: (recordId: string, field: string, value: string) => void;
  removeMechanicRecord: (id: string) => void;
  clearMechanicRecords: () => void;

  // الأفلاس (فشل الاستخراج)
  failures: Array<{ imageId: string; mode: "tables" | "mechanic"; error: string; error_ar?: string; timestamp: number; imageDataUrl?: string; imageName?: string; faceB64s?: string[] }>;
  addFailure: (f: { imageId: string; mode: "tables" | "mechanic"; error: string; error_ar?: string; timestamp: number; imageDataUrl?: string; imageName?: string; faceB64s?: string[] }) => void;
  clearFailures: () => void;
  removeFailure: (id: string) => void;
  retryExtraction: (imageId: string, mode: "tables" | "mechanic") => Promise<void>;

  // طابور التدقيق
  reviewQueue: ReviewItem[];
  addReviewItems: (items: Omit<ReviewItem, "id">[]) => void;
  addReviewItem: (item: Omit<ReviewItem, "id">) => void;
  removeReviewItem: (id: string) => void;
  clearReviewQueue: () => void;

  // المقارنة
  benchmark: BenchmarkState;
  setBenchmark: (p: Partial<BenchmarkState>) => void;
  resetBenchmark: () => void;

  // الحالة الصحية + السجل التدقيقي + KB
  health: HealthState;
  setHealth: (p: Partial<HealthState>) => void;
  auditEntries: AuditEntry[];
  setAuditEntries: (e: AuditEntry[]) => void;
  kbEntries: number;
  kbCorrections: number;
  setKb: (entries: number, corrections: number) => void;

  // 15.10 المرونة الإقليمية — حالة فحص المزودات (تُحفظ محلياً بمتصفح المستخدم
  // تعويض provider_status.json المذكور بالخطة، حفاظاً على بند 15.6: لا حالة مزودات بملفات الخادم)
  providerStatuses: Record<string, ProviderStatus>;
  setProviderStatus: (id: string, s: ProviderStatus) => void;
}

let seq = 0;
const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const makeId = uid;

export const useExtractorStore = create<ExtractorStore>()(
  persist(
    (set) => ({
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS } }),
      addCustomProvider: (p) =>
        set((s) => ({
          settings: {
            ...s.settings,
            customProviders: [...s.settings.customProviders, p],
          },
        })),
      removeCustomProvider: (id) =>
        set((s) => ({
          settings: {
            ...s.settings,
            customProviders: s.settings.customProviders.filter((p) => p.id !== id),
            providerKeys: Object.fromEntries(
              Object.entries(s.settings.providerKeys ?? {}).filter(([k]) => k !== id)
            ),
          },
        })),
      updateCustomProvider: (id, p) =>
        set((s) => ({
          settings: {
            ...s.settings,
            customProviders: s.settings.customProviders.map((cp) =>
              cp.id === id ? { ...cp, ...p } : cp
            ),
          },
        })),

      models: [],
      modelsSource: null,
      modelsFetching: false,
      setModels: (models, source) => set({ models, modelsSource: source }),
      setModelsFetching: (b) => set({ modelsFetching: b }),

      images: [],
      addImages: (items) =>
        set((s) => ({
          images: [
            ...s.images,
            ...items.map((it) => ({
              id: uid("img"),
              name: it.name,
              dataUrl: it.dataUrl,
              ops: [] as EditorOp[],
              sourceType: it.sourceType,
              sourceFile: it.sourceFile,
              sourcePage: it.sourcePage,
            })),
          ],
        })),
      removeImage: (id) =>
        set((s) => ({
          images: s.images.filter((i) => i.id !== id),
          tableResults: s.tableResults.filter((t) => t.imageId !== id),
        })),
      clearImages: () => set({ images: [], tableResults: [] }),
      updateImage: (id, p) =>
        set((s) => ({
          images: s.images.map((i) => (i.id === id ? { ...i, ...p } : i)),
        })),
      moveImage: (fromId, toId) =>
        set((s) => {
          if (fromId === toId) return s;
          const from = s.images.findIndex((i) => i.id === fromId);
          const to = s.images.findIndex((i) => i.id === toId);
          if (from < 0 || to < 0) return s;
          const next = [...s.images];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { images: next };
        }),
      swapImages: (idA, idB) =>
        set((s) => {
          const a = s.images.findIndex((i) => i.id === idA);
          const b = s.images.findIndex((i) => i.id === idB);
          if (a < 0 || b < 0 || a === b) return s;
          const next = [...s.images];
          [next[a], next[b]] = [next[b], next[a]];
          return { images: next };
        }),

      tableResults: [],
      addTableResult: (r) => set((s) => ({ tableResults: [...s.tableResults, r] })),
      removeTableResult: (id) =>
        set((s) => ({ tableResults: s.tableResults.filter((t) => t.id !== id) })),
      clearTableResults: () => set({ tableResults: [] }),
      setTableValue: (resultId, rowIdx, colIdx, value) =>
        set((s) => ({
          tableResults: s.tableResults.map((t) => {
            if (t.id !== resultId) return t;
            const grid = parseCsvSimple(t.csv);
            if (grid[rowIdx]) {
              while (grid[rowIdx].length <= colIdx) grid[rowIdx].push("");
              grid[rowIdx][colIdx] = value;
            }
            return { ...t, csv: toCsvText(grid) };
          }),
        })),

      mechanicRecords: [],
      addMechanicRecord: (r) => set((s) => ({ mechanicRecords: [...s.mechanicRecords, r] })),
      updateMechanicRecord: (id, p) =>
        set((s) => ({
          mechanicRecords: s.mechanicRecords.map((r) => (r.id === id ? { ...r, ...p } : r)),
        })),
      setMechanicFieldValue: (recordId, field, value) =>
        set((s) => ({
          mechanicRecords: s.mechanicRecords.map((r) =>
            r.id === recordId ? { ...r, fields: { ...r.fields, [field]: value } } : r
          ),
        })),
      removeMechanicRecord: (id) =>
        set((s) => ({ mechanicRecords: s.mechanicRecords.filter((r) => r.id !== id) })),
      clearMechanicRecords: () => set({ mechanicRecords: [] }),

      // 16: الأفلاس (فشل الاستخراج)
      failures: [] as Array<{ imageId: string; mode: "tables" | "mechanic"; error: string; error_ar?: string; timestamp: number; imageDataUrl?: string; imageName?: string; faceB64s?: string[] }>,
      addFailure: (f) =>
        set((s) => ({ failures: [...s.failures, f] })),
      clearFailures: () => set({ failures: [] }),
      removeFailure: (id) =>
        set((s) => ({ failures: s.failures.filter((f) => f.imageId !== id) })),
retryExtraction: async (imageId, mode) => {
        const st = useExtractorStore.getState();
        const img = st.images.find((i) => i.id === imageId);
        const failure = st.failures.find((f) => f.imageId === imageId);
// Determine source: existing image in store vs group failure (no image in store)
        const hasStoredImage = !!img;
        const hasFailureData = !!failure?.faceB64s?.length;
        if (!hasStoredImage && !hasFailureData) {
          toast.error("الصورة غير موجودة في القائمة");
          return;
        }
        try {
          // For group failures, use stored faceB64s; for single image, compute from img
          const srcB64s: string[] = hasFailureData ? (failure.faceB64s ?? []) : [await getExtractB64(img!)];
          const b64 = srcB64s[0];
          if (!b64 || b64.length < 100) {
            toast.error("فشل تجهيز الصورة للاستخراج — جرّب إعادة تحميل الصورة");
            return;
          }
          const res = await smartExtract({ mode, imagesB64: srcB64s });
          if (mode === "tables") {
            const { cleanCsvText } = await import("./api");
            const csv = cleanCsvText(res.text);
            const grid = parseCsvSimple(csv);
            const resultId = `tbl_${imageId}_${Date.now().toString(36)}`;
            // Use img data for single image, failure data for group
            const recordImg = hasStoredImage ? img! : { name: failure?.imageName ?? imageId, dataUrl: failure?.imageDataUrl ?? "" };
            st.addTableResult({
              id: resultId,
              imageId,
              imageName: recordImg.name,
              imageDataUrl: recordImg.dataUrl,
              csv,
              rows: grid.length,
              model: res.model,
              elapsed_ms: res.elapsed_ms,
            });
            const unclear: Parameters<typeof st.addReviewItems>[0] = [];
            grid.forEach((row, ri) => {
              row.forEach((cell, ci) => {
                if (cell.trim().toUpperCase() === "UNCLEAR") {
                  unclear.push({
                    scope: "tables",
                    field: `خلية [${ri},${ci}]`,
                    label: `خلية [${ri},${ci}] — ${recordImg.name}`,
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
            if (unclear.length > 0) st.addReviewItems(unclear);
            const { failoverNotice } = await import("./failover");
            const notice = failoverNotice(res);
            if (notice) toast.warning(notice);
          } else {
            const { validateRecord } = await import("./api");
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
            } catch { /* غير حاسم */ }
            st.addMechanicRecord({
              id: `rec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
              category_key: "unknown",
              category_ar: "ميكانيك",
              faces: srcB64s.map((face) => b64ToDataUrl(face)),
              faceB64s: srcB64s,
              method: "adjacency",
              fields: parsed.fields,
              vin_valid: vinValid,
              flags,
            });
            const { failoverNotice } = await import("./failover");
            const notice = failoverNotice(res);
            if (notice) toast.warning(notice);
          }
          st.removeFailure(imageId);
          toast.success(`✅ أُعيد الاستخراج بنجاح — ${res.elapsed_ms}ms`);
        } catch (e) {
          const errorAr = e instanceof Error ? e.message : String(e);
          toast.error(errorAr);
        }
      },

      reviewQueue: [],
      addReviewItems: (items) =>
        set((s) => ({
          reviewQueue: [
            ...s.reviewQueue,
            ...items.map((it) => ({ ...it, id: uid("rev") })),
          ],
        })),
      addReviewItem: (item) =>
        set((s) => ({ reviewQueue: [...s.reviewQueue, { ...item, id: uid("rev") }] })),
      removeReviewItem: (id) =>
        set((s) => ({ reviewQueue: s.reviewQueue.filter((r) => r.id !== id) })),
      clearReviewQueue: () => set({ reviewQueue: [] }),

      benchmark: {
        running: false,
        results: [],
        agreement_matrix: {},
        winner: "",
        csv_report: "",
      },
      setBenchmark: (p) => set((s) => ({ benchmark: { ...s.benchmark, ...p } })),
      resetBenchmark: () =>
        set({
          benchmark: { running: false, results: [], agreement_matrix: {}, winner: "", csv_report: "" },
        }),

      health: { connected: false },
      setHealth: (p) => set((s) => ({ health: { ...s.health, ...p } })),
      auditEntries: [],
      setAuditEntries: (e) => set({ auditEntries: e }),
      kbEntries: 0,
      kbCorrections: 0,
      setKb: (entries, corrections) => set({ kbEntries: entries, kbCorrections: corrections }),

      // 15.10: نتائج الفحص الإقليمي — بلا مفاتيح إطلاقاً (available/error_type/host فقط)
      providerStatuses: {},
      setProviderStatus: (id, s) =>
        set((st) => ({
          providerStatuses: { ...st.providerStatuses, [id]: { ...s, checkedAt: Date.now() } },
        })),
    }),
    {
      name: "legendary-extractor-settings",
      storage: createJSONStorage(() => localStorage),
      // المفاتيح والإعدادات فقط في المتصفح — لا صور ولا نتائج (حجم + خصوصية)
      // 15.10: providerStatuses يُحفظ محلياً أيضاً (حالة الفحص الإقليمي بلا مفاتيح) — تعويض provider_status.json
      partialize: (s) =>
        ({ settings: s.settings, providerStatuses: s.providerStatuses }) as unknown as ExtractorStore,
      version: 2,
      // دمج عميق للإعدادات عند كل تهيئة (لا فقط عند تغيّر الإصدار): الحقول
      // الجديدة تأخذ قيمتها الافتراضية بدل undefined — يمنع خطأ
      // controlled→uncontrolled في المدخلات وانكسار mapPool(undefined)
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ExtractorStore>;
        return {
          ...current,
          ...p,
          settings: withSettingsDefaults(p.settings),
          providerStatuses: { ...current.providerStatuses, ...(p.providerStatuses ?? {}) },
        } as ExtractorStore;
      },
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Partial<ExtractorStore> & {
          settings?: Partial<ExtractorSettings> & { apiKey?: string };
        };
        const settings: ExtractorSettings = withSettingsDefaults(p.settings);
        if (settings.provider === "zai" && !settings.baseUrl.trim()) {
          settings.baseUrl = "https://api.z.ai/api/paas/v4";
        }
        // v0/v1 → v2 (تخصيص المفاتيح): المفتاح الواحد القديم apiKey يصبح ملكاً
        // للمزود الذي كان نشطاً وقتها فقط — لا يُنسخ لبقية المزودات.
        if ((fromVersion ?? 0) < 2) {
          const legacy = p.settings?.apiKey?.trim();
          if (legacy) {
            settings.providerKeys = {
              [settings.provider]: legacy,
              ...(settings.providerKeys ?? {}),
            };
          }
        }
        // حقل apiKey القديم يُمحى نهائياً من الحالة المهجّرة
        const migrated = settings as ExtractorSettings & { apiKey?: string };
        delete migrated.apiKey;
        // درع شكل providerKeys: إن جاءت من حالة قديمة تالفة (نص/مصفوفة/null)
        // تُستبدل بكائن سليم — يمنع انكسار «حفظ المفتاح» مهما كان المخزن القديم
        if (!settings.providerKeys || typeof settings.providerKeys !== "object" ||
            Array.isArray(settings.providerKeys)) {
          settings.providerKeys = {};
        } else {
          const clean: Record<string, string> = {};
          for (const [k, v] of Object.entries(settings.providerKeys)) {
            if (typeof v === "string" && v.trim()) clean[k] = v.trim();
          }
          settings.providerKeys = clean;
        }
        // سرعة المعالجة: قصّ دفاعي 1-6 وحماية من القيم التالفة/الناقصة
        const ccRaw = (settings as { concurrency?: unknown }).concurrency;
        const cc = Number(ccRaw);
        settings.concurrency = Number.isFinite(cc)
          ? Math.min(6, Math.max(1, Math.round(cc)))
          : DEFAULT_SETTINGS.concurrency;
        return { ...p, settings } as unknown as ExtractorStore;
      },
      skipHydration: true,
    }
  )
);

// ---------- مساعدات CSV (parser يحترم الاقتباسات) ----------

export function parseCsvSimple(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += c;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export function toCsvText(grid: string[][]): string {
  return grid
    .map((row) =>
      row
        .map((c) => {
          const v = c ?? "";
          return /[,\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(",")
    )
    .join("\n");
}

export async function kbFewshot(field: string, wrong?: string): Promise<{
  shots: { wrong: string; right: string; count: number }[];
}> {
  try {
    const res = await fetch(`${PY}/api/py/kb/fewshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, wrong })
    });
    const data = await res.json();
    if (!res.ok || !data) {
      throw new Error(`فشل جلب Few-shot (${res.status})`);
    }
    return { shots: data.shots ?? [] };
  } catch (e) {
    console.error("kbFewshot error:", e);
    return { shots: [] };
  }
}

export async function getProviderQuota(providerId: string, baseUrl: string, apiKey: string): Promise<{ remaining: number | null; limit: number | null; used: number | null; exhausted: boolean; status: string; errorAr?: string }> {
  try {
    const res = await fetch(`${PY}/api/py/providers/quota`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: baseUrl, api_key: apiKey, timeout: 8 })
    });
    const data = await res.json();
    if (data.ok) {
      return {
        remaining: data.remaining ?? null,
        limit: data.limit ?? null,
        used: data.used ?? null,
        exhausted: !!data.exhausted,
        status: data.status ?? "unknown",
        errorAr: data.error_ar,
      };
    }
    return {
      remaining: null,
      limit: null,
      used: null,
      exhausted: false,
      status: "error",
      errorAr: data.error_ar || "فشل فحص الرصيد",
    };
  } catch {
    return {
      remaining: null,
      limit: null,
      used: null,
      exhausted: false,
      status: "error",
      errorAr: "تعذر الاتصال بفحص الرصيد",
    };
  }
}
