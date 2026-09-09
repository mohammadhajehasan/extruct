"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  EditorOp,
  ModelInfo,
  EnhancedImage,
  AuditEntry,
  BenchmarkResult,
  Confidence,
  ProviderStatus,
} from "./types";

// ---------- الإعدادات (تُحفظ في localStorage فقط — المفاتيح تبقى في المتصفح) ----------
export interface ExtractorSettings {
  provider: string;
  model: string;
  baseUrl: string;
  // تخصيص المفاتيح: كل مزود له مفتاحه الخاص فقط — ما يُحفظ لمزود لا يُعرض ولا
  // يُرسل لأي مزود آخر (persist v2). Record<mzodId, key> في متصفح المستخدم حصراً.
  providerKeys: Record<string, string>;
  freeFirst: boolean;
  visionOnly: boolean;
  profile: string;
  dpi: number;
  // 13: سرعة المعالجة — عدد المسارات المتوازية لطلبات النموذج (1-6)
  concurrency: number;
  consensusEnabled: boolean;
  // 15.10.5 سلسلة التراجع التلقائي
  failoverEnabled: boolean;
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
};

/** مفتاح مزود محدد — مُقَصّص دائماً ("" إن لم يُحفظ شيء) */
export function getProviderKey(settings: ExtractorSettings, providerId: string): string {
  return (settings.providerKeys?.[providerId] ?? "").trim();
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
      migrate: (persisted, fromVersion) => {
        const p = (persisted ?? {}) as Partial<ExtractorStore> & {
          settings?: Partial<ExtractorSettings> & { apiKey?: string };
        };
        const settings: ExtractorSettings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
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
          return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(",")
    )
    .join("\n");
}
