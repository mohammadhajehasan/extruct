// أنواع مشتركة لنظام المستخرج الأسطوري v7.1 — وفق عقد API (docs/api-contract.md)

export type Confidence = "HIGH" | "MED" | "LOW" | "REVIEW";

export interface HealthInfo {
  service: string;
  version: string;
  modules: string[];
  capabilities: { barcode: boolean; ocr: boolean };
}

export interface ModelInfo {
  name: string;
  free: boolean;
  vision: boolean;
}

export interface ModelsResponse {
  models: ModelInfo[];
  source: "live" | "fallback";
}

export interface EnhanceProfile {
  id: string;
  name_ar: string;
  desc_ar: string;
  steps: string[];
}

export interface PlanStep {
  step: string;
  reason_ar: string;
}

export interface AnalysisInfo {
  blur?: number;
  contrast_std?: number;
  skew_angle?: number;
  noise?: number;
  dpi_est?: number;
  stamp_ratio?: number;
  [key: string]: unknown;
}

export interface EnhancedImage {
  b64: string;
  plan: PlanStep[];
  analysis: AnalysisInfo;
  profile: string;
  ms: number;
}

export interface PdfPageNative {
  kind: "native";
  index: number;
  tables: string[][][];
}

export interface PdfPageImage {
  kind: "image";
  index: number;
  image_b64: string;
}

export type PdfPage = PdfPageNative | PdfPageImage;

export interface PdfParseResponse {
  is_pdf: boolean;
  pages: PdfPage[];
  warning?: string;
}

export interface ExtractResponse {
  text: string;
  parsed?: unknown;
  attempts: number;
  model: string;
  elapsed_ms: number;
}

export interface MechanicParsed {
  fields: Record<string, string>;
  conflicts: string[];
  face_values: Record<string, string>[];
}

export interface ClassifyParsed {
  label: string;
  confidence: number;
}

export interface FieldValidation {
  value: string;
  confidence: Confidence;
  reasons: string[];
}

export interface ValidateResponse {
  fields: Record<string, FieldValidation>;
  chassis_no_vin_valid?: boolean;
}

export interface GroupItem {
  label: string;
  image_b64: string;
}

export interface FaceGroup {
  category_ar: string;
  category_key: string;
  faces: string[];
  method: "barcode" | "adjacency";
}

export interface BenchmarkResult {
  model: string;
  csv: string;
  cells: number;
  score: number;
  elapsed_ms: number;
}

export interface BenchmarkResponse {
  results: BenchmarkResult[];
  agreement_matrix: Record<string, number>;
  winner: string;
  csv_report: string;
}

export interface AuditEntry {
  ts: string;
  action: string;
  target: string;
  model?: string;
  details?: unknown;
}

export interface KbStats {
  entries: number;
  by_field: Record<string, number>;
  chains: unknown[];
}

export interface GlossaryInfo {
  fuel: string[];
  governorates: string[];
  categories: { key: string; name_ar: string; faces: number; rule_ar: string }[];
  fields: { key: string; label_ar: string }[];
}

// الحقول الثلاثة عشر لوحدة الميكانيك (ترتيب العقد §2 extract mechanic)
export const MECHANIC_FIELDS: { key: string; label_ar: string }[] = [
  { key: "vehicle_symbol", label_ar: "رمز المركبة" },
  { key: "chassis_no", label_ar: "رقم الهيكل" },
  { key: "engine_no", label_ar: "رقم المحرك" },
  { key: "engine_capacity", label_ar: "سعة المحرك" },
  { key: "manufacture_date", label_ar: "تاريخ الصنع" },
  { key: "category", label_ar: "الفئة/فئة المركبة" },
  { key: "plate_no", label_ar: "رقم اللوحة" },
  { key: "maker", label_ar: "الصانع" },
  { key: "model", label_ar: "الطراز" },
  { key: "fuel", label_ar: "نوع الوقود" },
  { key: "governorate", label_ar: "المحافظة" },
  { key: "passengers", label_ar: "عدد الركاب" },
  { key: "type", label_ar: "النوع" },
];

export const CLASS_LABELS_AR: Record<string, string> = {
  mechanic_card_front: "كرت ميكانيك — وجه أمامي",
  mechanic_card_back: "كرت ميكانيك — وجه خلفي",
  registration_statement: "بيان قيد المركبة",
  temp_driving_license: "رخصة سير مؤقتة",
  transfer_deed: "سند تمليك",
  table_document: "وثيقة جداول",
  unknown: "غير معروف",
};

// عمليات المحرر غير الإتلافي
export type EditorOp =
  | { op: "rot90" | "rot180" | "flip_h" | "flip_v" | "autocrop"; params?: never }
  | { op: "crop"; params: { x: number; y: number; w: number; h: number } }
  | { op: "bright" | "contrast"; params: { value: number } };

// ---------- 15.10 المرونة الإقليمية ----------
// تصنيف أخطاء المزودات (لا رسالة عامة "فشل الاتصال") — وفق عقد /api/py/providers/health
// ملاحظة: مفتاح API لا يُخزَّن هنا إطلاقاً (بند 15.6) — الحالة فقط (available/error_type/host)
export type ProviderErrorType =
  | "geo_blocked"
  | "auth_invalid"
  | "rate_limited"
  | "network_down"
  | "unknown"
  | "all_failed";

export interface ProviderStatus {
  available: boolean;
  status: number | null;
  error_type: ProviderErrorType | null;
  error_ar: string | null;
  host: string;
  suggested_model?: string | null;
  checkedAt?: number;
}

/** حلقة فاشلة في سلسلة التراجع (15.10.5) — من عقد /api/py/extract/failover */
export interface FailoverLogEntry {
  provider: string;
  error_type: ProviderErrorType | null;
  error_ar: string | null;
  elapsed_ms: number;
}

/** تفصيل فشل كل مزود عند error_type === "all_failed" */
export interface FailoverAttemptDetail {
  provider: string;
  error_type: ProviderErrorType | null;
  error_ar: string | null;
  detail?: string | null;
}
