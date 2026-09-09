"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  Badge,
  Input,
  Label,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ScrollArea,
  RadioGroup,
  RadioGroupItem,
  Separator,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui-bundle";
import {
  RefreshCw,
  KeyRound,
  ShieldCheck,
  Loader2,
  ScrollText,
  Sparkles,
  Cog,
  Database,
  Eye,
  EyeOff,
  Globe,
  Save,
  CheckCircle2,
} from "lucide-react";
import { useExtractorStore, getProviderKey } from "@/lib/extractor/store";
import {
  fetchModels,
  getProfiles,
  kbStats,
  getAudit,
  healthBatch,
  healthCheck,
} from "@/lib/extractor/api";
import { OLLAMA_BASE_URL } from "@/lib/extractor/failover";
import type { EnhanceProfile, AuditEntry, ProviderStatus } from "@/lib/extractor/types";

const PROVIDERS: { id: string; name_ar: string; baseUrl: string; needsKey: boolean }[] = [
  { id: "zai", name_ar: "Z.ai", baseUrl: "https://api.z.ai/api/paas/v4", needsKey: true },
  { id: "openrouter", name_ar: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true },
  { id: "groq", name_ar: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true },
  { id: "unorouter", name_ar: "UnoRouter", baseUrl: "https://api.unorouter.com/v1", needsKey: true },
  { id: "ollama", name_ar: "Ollama (محلي)", baseUrl: "http://localhost:11434/v1", needsKey: false },
  { id: "openai", name_ar: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true },
  { id: "gemini", name_ar: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", needsKey: true },
  { id: "qwen", name_ar: "Qwen DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", needsKey: true },
  { id: "custom", name_ar: "مخصص", baseUrl: "", needsKey: true },
];

// ---------- 15.10 ثوابت حالات الفحص الإقليمي (النقطة + التسمية لكل حالة) ----------
function statusGlyph(status?: ProviderStatus): { dot: string; label: string; title?: string } {
  if (!status) return { dot: "⚪", label: "غير مفعّل", title: "فعّله كمزود نشط ثم أعد الفحص" };
  if (status.available) return { dot: "🟢", label: "متاح" };
  switch (status.error_type) {
    case "geo_blocked":
      return { dot: "🔴", label: "محظور بمنطقتك", title: status.error_ar ?? undefined };
    case "auth_invalid":
      return { dot: "🟡", label: "مفتاح غير صحيح", title: status.error_ar ?? undefined };
    case "rate_limited":
      return { dot: "🟠", label: "حد معدل الطلبات", title: status.error_ar ?? undefined };
    case "network_down":
      return { dot: "⚫", label: "تعذر الوصول للشبكة", title: status.error_ar ?? undefined };
    default:
      return { dot: "❔", label: "غير معروف", title: status.error_ar ?? undefined };
  }
}

/** وقت الفحص النسبي (اختياري في صف الحالة) */
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 45) return "قبل ثوانٍ";
  const m = Math.floor(s / 60);
  if (m < 60) return `قبل ${m} د`;
  const h = Math.floor(m / 60);
  if (h < 24) return `قبل ${h} س`;
  return `قبل ${Math.floor(h / 24)} يوم`;
}

export function SettingsTab() {
  const settings = useExtractorStore((s) => s.settings);
  const setSettings = useExtractorStore((s) => s.setSettings);
  const models = useExtractorStore((s) => s.models);
  const modelsSource = useExtractorStore((s) => s.modelsSource);
  const modelsFetching = useExtractorStore((s) => s.modelsFetching);
  const setModels = useExtractorStore((s) => s.setModels);
  const setModelsFetching = useExtractorStore((s) => s.setModelsFetching);
  const kbEntries = useExtractorStore((s) => s.kbEntries);
  const kbCorrections = useExtractorStore((s) => s.kbCorrections);
  const setKb = useExtractorStore((s) => s.setKb);
  // 15.10 حالة الفحص الإقليمي
  const providerStatuses = useExtractorStore((s) => s.providerStatuses);
  const setProviderStatus = useExtractorStore((s) => s.setProviderStatus);

  const [profiles, setProfiles] = useState<EnhanceProfile[]>([]);
  const [kbByField, setKbByField] = useState<Record<string, number>>({});
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [providersChecking, setProvidersChecking] = useState(false);
  // إظهار/إخفاء مفتاح API (زر العين داخل الحقل — بنمط حقول كلمة السر في Material)
  const [showApiKey, setShowApiKey] = useState(false);
  // تخصيص المفاتيح: مسودة مفتاح المزود النشط (لا تُكتب للمخزن إلا بزر «حفظ المفتاح»)
  const [keyDraft, setKeyDraft] = useState("");
  const [keyTesting, setKeyTesting] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentProvider = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const needsKey = currentProvider.needsKey;

  // مفتاح المزود النشط المحفوظ (خاص به وحده) — والمسودة المنفصلة عنه
  const savedKey = useExtractorStore((s) => getProviderKey(s.settings, s.settings.provider));
  const keyDirty = keyDraft.trim() !== savedKey;

  // مزامنة المسودة مع مفتاح المزود النشط — تُعاد عند تبديل المزود أو بعد الحفظ أو
  // ترطيب localStorage المتأخر. لا تُمس أثناء الكتابة: الحفظ وحده هو ما يغيّر savedKey.
  useEffect(() => {
    const st = useExtractorStore.getState().settings;
    setKeyDraft(getProviderKey(st, st.provider));
  }, [savedKey]);

  // البروفايلات
  useEffect(() => {
    getProfiles()
      .then((r) => setProfiles(r.profiles ?? []))
      .catch(() => setProfiles([]));
  }, []);

  // ---------- 15.10 الفحص الإقليمي للمزودين (بمفاتيح مخصصة لكل مزود) ----------
  // يُفحص: المزود النشط دائماً (بمفتاحه الخاص إن وُجد) + أي مزود آخر يملك مفتاحاً
  // محفوظاً له + Ollama المحلي دائماً (بلا مفتاح). «مخصص» لا يُفحص إلا برابط مُدخل.
  // أي مزود بلا مفتاح لدينا يبقى ⚪ غير مفعّل بلا فحص. النتائج في متصفح المستخدم.
  const runProviderCheck = useCallback(async (): Promise<ProviderStatus[] | null> => {
    setProvidersChecking(true);
    try {
      const st = useExtractorStore.getState().settings;
      const items: { id: string; base_url: string; api_key?: string }[] = [];
      for (const p of PROVIDERS) {
        const key = getProviderKey(st, p.id);
        if (p.id === "custom") {
          if (p.id === st.provider && st.baseUrl.trim()) {
            items.push({ id: p.id, base_url: st.baseUrl.trim(), api_key: key || undefined });
          }
          continue;
        }
        if (p.id === st.provider) {
          // النشط يُفحص دائماً — حتى بلا مفتاح (لكشف الحظر الجغرافي مبكراً)
          items.push({
            id: p.id,
            base_url: st.baseUrl.trim() || p.baseUrl,
            api_key: key || undefined,
          });
        } else if (key) {
          // مزود آخر: يُفحص فقط إن امتلك مفتاحه الخاص
          items.push({ id: p.id, base_url: p.baseUrl, api_key: key });
        } else if (p.id === "ollama") {
          items.push({ id: p.id, base_url: p.baseUrl });
        }
      }
      if (items.length === 0) return null;
      const res = await healthBatch(items);
      const results = res.results ?? {};
      for (const [id, r] of Object.entries(results)) {
        // مفتاح API لا يُخزّن هنا إطلاقاً — available/error_type/host فقط (بند 15.6)
        setProviderStatus(id, {
          available: !!r.available,
          status: r.status ?? null,
          error_type: r.error_type ?? null,
          error_ar: r.error_ar ?? null,
          host: r.host ?? "",
          suggested_model: r.suggested_model ?? null,
        });
      }
      return Object.values(results);
    } catch {
      // الخدمة قد لا تكون منشورة بعد (404) — تعامل لطيف: بلا انهيار
      return null;
    } finally {
      setProvidersChecking(false);
    }
  }, [setProviderStatus]);

  // فحص تلقائي عند تحميل التبويب — مرة واحدة (مؤجّل قليلاً حتى يكتمل ترطيب الإعدادات المحفوظة)
  useEffect(() => {
    const t = setTimeout(() => {
      void runProviderCheck();
    }, 400);
    return () => clearTimeout(t);
  }, [runProviderCheck]);

  // زر إعادة الفحص — نفس المنطق + toast ملخص
  const onRecheck = useCallback(async () => {
    const results = await runProviderCheck();
    if (results === null) {
      toast.error("تعذر فحص المزودين — خدمة الفحص غير متاحة حالياً");
      return;
    }
    const okCount = results.filter((r) => r.available).length;
    const geoCount = results.filter((r) => !r.available && r.error_type === "geo_blocked").length;
    toast.success(`🟢 متاح: ${okCount} — 🔴 محظور: ${geoCount}`);
  }, [runProviderCheck]);

  // KB إحصاءات
  const refreshKb = useCallback(async () => {
    try {
      const stats = await kbStats();
      setKbByField(stats.by_field ?? {});
      const total = Object.values(stats.by_field ?? {}).reduce(
        (a: number, b) => a + (Number(b) || 0),
        0
      );
      setKb(stats.entries || 0, total);
    } catch {
      // الخدمة غير متصلة
    }
  }, [setKb]);

  useEffect(() => {
    void refreshKb();
  }, [refreshKb]);

  // ---------- جلب النماذج ----------
  const doFetchModels = useCallback(async () => {
    const requestedBaseUrl = settings.baseUrl.trim();
    if (!requestedBaseUrl) {
      toast.warning("أدخل base_url أولاً");
      return;
    }
    setModelsFetching(true);
    try {
      // مفتاح المزود النشط يُقرأ من المخزن لحظة الطلب (مخصص له وحده — persist v2)
      const st = useExtractorStore.getState().settings;
      const key = getProviderKey(st, st.provider);
      const res = await fetchModels(requestedBaseUrl, key);
      // حارس سباق الطلبات: إن غيّر المستخدم المزود/base_url أثناء الجلب
      // تُتجاهل النتيجة القديمة (جلب بطيء لا يكتب فوق قائمة مزود أحدث)
      if (useExtractorStore.getState().settings.baseUrl.trim() !== requestedBaseUrl) return;
      setModels(res.models ?? [], res.source);
      if (res.source === "fallback") {
        // رسالة الخلفية مُصنَّفة عربياً (لا مفتاح / مفتاح مرفوض / حظر جغرافي / شبكة)
        // — تُعرض كما هي لأنها تجيب «لماذا هذا الخطأ؟» وتشرح ماذا يُنبغي فعله
        toast.warning(res.error ?? "تعذر الجلب المباشر — عُرضت قائمة احتياطية مدمجة");
      } else {
        toast.success(`جُلبت ${res.models?.length ?? 0} نموذجاً`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل جلب النماذج");
    } finally {
      // حارس ثانٍ: لا تُطفئ مؤشر الجلب إن انطلق جلب أحدث بعده
      if (useExtractorStore.getState().settings.baseUrl.trim() === requestedBaseUrl) {
        setModelsFetching(false);
      }
    }
  }, [settings.baseUrl, setModels, setModelsFetching]);

  // جلب تلقائي مؤجل 700ms عند تغيير المزود/base_url — مفتاح المزود الجديد المحفوظ
  // يُستعمل تلقائياً؛ تعديل المسودة بلا حفظ لا يطلق الجلب (المفتاح غير الموثوق لا يُرسل)
  useEffect(() => {
    if (!settings.baseUrl.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void doFetchModels();
    }, 700);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [settings.baseUrl, settings.provider, doFetchModels]);

  // ---------- الفرز والفلترة المحلية ----------
  const visibleModels = (() => {
    let list = [...models];
    if (settings.visionOnly) list = list.filter((m) => m.vision);
    if (settings.freeFirst) {
      list.sort((a, b) => {
        if (a.free !== b.free) return a.free ? -1 : 1;
        if (a.vision !== b.vision) return a.vision ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    }
    return list;
  })();

  const onProviderChange = (id: string) => {
    const p = PROVIDERS.find((x) => x.id === id);
    setSettings({
      provider: id,
      baseUrl: p && id !== "custom" ? p.baseUrl : "",
    });
  };

  // ---------- حفظ / فحص مفتاح المزود النشط (تخصيص المفاتيح) ----------
  const onSaveKey = () => {
    const v = keyDraft.trim();
    setSettings({
      providerKeys: { ...(settings.providerKeys ?? {}), [settings.provider]: v },
    });
    if (v) {
      toast.success(`حُفظ مفتاح ${currentProvider.name_ar} — مخصص لهذا المزود فقط`);
      // بعد الحفظ اجلب نماذج هذا المزود مباشرة بالمفتاح الجديد الموثوق
      if (settings.baseUrl.trim()) void doFetchModels();
    } else {
      toast.info(`أُزيل مفتاح ${currentProvider.name_ar}`);
    }
  };

  const onTestKey = async () => {
    const url =
      settings.baseUrl.trim() ||
      (currentProvider.id !== "custom" ? currentProvider.baseUrl : "");
    if (!url) {
      toast.warning("أدخل base_url أولاً ثم افحص المفتاح");
      return;
    }
    // الفحص يجري على قيمة الحقل الحالية (قبل أو بعد الحفظ) وإلا المفتاح المحفوظ
    const keyToTest = keyDraft.trim() || savedKey;
    if (!keyToTest) {
      toast.warning("أدخل المفتاح أولاً ثم افحصه");
      return;
    }
    setKeyTesting(true);
    try {
      const r = await healthCheck(url, keyToTest);
      setProviderStatus(currentProvider.id, {
        available: !!r.available,
        status: r.status ?? null,
        error_type: r.error_type ?? null,
        error_ar: r.error_ar ?? null,
        host: r.host ?? "",
        suggested_model: r.suggested_model ?? null,
      });
      if (r.available) {
        toast.success(
          `✅ المفتاح صحيح — ${currentProvider.name_ar} متاح (${r.host || url})`
        );
      } else if (r.error_type === "auth_invalid") {
        toast.error(`❌ ${r.error_ar ?? "مفتاح API غير صحيح أو منتهٍ"}`);
      } else if (r.error_type === "rate_limited") {
        toast.warning(
          `🟠 ${r.error_ar ?? "حد معدل الطلبات"} — غالباً المفتاح صحيح، انتظر قليلاً`
        );
      } else {
        toast.warning(`⚠️ ${r.error_ar ?? "تعذر التأكد من صحة المفتاح"}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل فحص المفتاح");
    } finally {
      setKeyTesting(false);
    }
  };

  // حارس اتساق النموذج مع المزود: عند التبديل قد يبقى نموذج المزود السابق مختاراً —
  // إن لم يعد ضمن قائمة المزود الحالي يُختار تلقائياً أول نموذج (مجاني رؤيوي أولاً)
  // — يمنع أخطاء «فشل غير متوقع» عند إرسال اسم نموذج لا يعرفه المزود الجديد
  useEffect(() => {
    if (models.length === 0) return;
    if (models.some((m) => m.name === settings.model)) return;
    const pool = settings.visionOnly ? models.filter((m) => m.vision) : models;
    const base = pool.length > 0 ? pool : models;
    const sorted = settings.freeFirst
      ? [...base].sort((a, b) => {
          if (a.free !== b.free) return a.free ? -1 : 1;
          if (a.vision !== b.vision) return a.vision ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
      : base;
    const first = sorted[0];
    if (first) setSettings({ model: first.name });
  }, [models, settings.model, settings.visionOnly, settings.freeFirst, setSettings]);

  // 15.10.4 الترتيب الإقليمي: المتاح فعلياً (available=true) أولاً، ثم غير المفحوص، ثم غير المتاح أخيراً.
  // لا يختفي أي مزود — المحظور يُدفع للأسفل بشارة 🔴 (قد يعمل لاحقاً أو بشبكة مختلفة).
  const sortedProviders = (() => {
    const rank = (id: string): number => {
      const st = providerStatuses[id];
      if (!st) return 1; // غير مفحوص
      return st.available ? 0 : 2;
    };
    return [...PROVIDERS].sort((a, b) => rank(a.id) - rank(b.id));
  })();

  const activeStatus = providerStatuses[settings.provider];
  const activeGeoBlocked =
    !!activeStatus && !activeStatus.available && activeStatus.error_type === "geo_blocked";
  const ollamaStatus = providerStatuses["ollama"];

  const openAudit = async () => {
    setAuditOpen(true);
    setAuditLoading(true);
    try {
      const res = await getAudit(50);
      setAuditEntries(res.entries ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل جلب السجل التدقيقي");
    } finally {
      setAuditLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* بطاقة المزود */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-1">
            <KeyRound className="h-4 w-4 text-primary" /> المزود والنموذج
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>المزود</Label>
              <Select value={settings.provider} onValueChange={onProviderChange}>
                <SelectTrigger className="min-h-11" aria-label="اختيار المزود">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortedProviders.map((p) => {
                    const g = statusGlyph(providerStatuses[p.id]);
                    // 🔑 = له مفتاحه الخاص المحفوظ (تخصيص المفاتيح) — طمأنة بصرية للحفظ
                    const hasOwnKey = !!getProviderKey(settings, p.id);
                    return (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <span aria-hidden>{g.dot}</span>
                          {p.name_ar}
                          {hasOwnKey && (
                            <KeyRound
                              className="h-3 w-3 text-primary shrink-0"
                              aria-label="له مفتاح محفوظ"
                            />
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {needsKey && (
              <div className="space-y-1.5">
                <Label>base_url</Label>
                <Input
                  value={settings.baseUrl}
                  onChange={(e) => setSettings({ baseUrl: e.target.value })}
                  placeholder="https://…/v1"
                  dir="ltr"
                  className="min-h-11"
                />
                <p className="text-xs text-muted-foreground">
                  أدخل <b>جذر الـ API</b> وليس نقطة نهاية كاملة — مثال:
                  <code dir="ltr" className="mx-1 px-1 rounded bg-muted">https://api.unorouter.com/v1</code>
                  (إن لصقت رابط نهاية مثل /images/generations فسيُسوَّى تلقائياً).
                </p>
                {/* 15.10.7 تلميح «مخصص» — خادم وسيط لمناطق الحظر الجغرافي */}
                {settings.provider === "custom" && (
                  <p className="text-[11px] text-tertiary border border-tertiary/30 rounded-lg p-2 bg-tertiary/10">
                    لمناطق الحظر الجغرافي: أدخل رابط خادم وسيط (Relay) يعيد توجيه الطلبات بدل النقطة الرسمية المحظورة — لا تعديل كود مطلوب.
                  </p>
                )}
              </div>
            )}
            {needsKey && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="api-key-input">api_key</Label>
                  {keyDirty && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-tertiary/50 text-tertiary bg-tertiary/10"
                    >
                      تغييرات غير محفوظة
                    </Badge>
                  )}
                </div>
                <div className="relative" dir="ltr">
                  <Input
                    id="api-key-input"
                    type={showApiKey ? "text" : "password"}
                    value={keyDraft}
                    onChange={(e) => setKeyDraft(e.target.value)}
                    placeholder="sk-…"
                    className="min-h-11 pe-11"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowApiKey((v) => !v)}
                    aria-label={showApiKey ? "إخفاء مفتاح API" : "إظهار مفتاح API"}
                    aria-pressed={showApiKey}
                    title={showApiKey ? "إخفاء مفتاح API" : "إظهار مفتاح API"}
                    className="absolute end-1 top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-9"
                    onClick={() => void onSaveKey()}
                    disabled={!keyDirty}
                    title={
                      !keyDirty
                        ? keyDraft.trim()
                          ? "المفتاح محفوظ مسبقاً لهذا المزود — لا تغييرات لحفظها"
                          : "الصق مفتاح هذا المزود أولاً ثم احفظه"
                        : `حفظ مفتاح ${currentProvider.name_ar} — مخصص له وحده`
                    }
                  >
                    <Save className="h-4 w-4 me-1" aria-hidden /> حفظ المفتاح
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => void onTestKey()}
                    disabled={keyTesting || (!keyDraft.trim() && !savedKey)}
                    title="يتحقق من المفتاح لدى المزود نفسه بطلب خفيف على /models"
                  >
                    {keyTesting ? (
                      <Loader2 className="h-4 w-4 me-1 animate-spin" aria-hidden />
                    ) : (
                      <ShieldCheck className="h-4 w-4 me-1" aria-hidden />
                    )}
                    فحص المفتاح
                  </Button>
                  {!keyDirty && savedKey && (
                    <span className="text-[11px] text-primary flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> محفوظ لهذا المزود
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  كل مزود له <b>مفتاحه الخاص</b> — ما تحفظه هنا يخص «{currentProvider.name_ar}»
                  فقط ولا يُعرض ولا يُرسل عند التبديل إلى مزود آخر. المفاتيح في متصفحك فقط.
                </p>
              </div>
            )}
          </div>

          {/* 15.10 لافتة الحظر الجغرافي للمزود النشط */}
          {activeGeoBlocked && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <span aria-hidden className="mt-0.5 shrink-0">🔴</span>
              <p className="text-xs text-destructive">
                {activeStatus?.error_ar ??
                  "هذا المزود غير متاح بمنطقتك حالياً — جرّب مزوداً آخر أو نموذجاً محلياً"}
                <br />
                اختر مزوداً 🟢 من القائمة أو فعّل Ollama المحلي.
              </p>
            </div>
          )}

          <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3">
            <ShieldCheck className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-xs text-primary">
              المفاتيح مخصصة لكل مزود على حدة وتبقى في متصفحك (localStorage) ولا تُخزَّن في
              الخادم أو أي ملف إعدادات — تُرسل مع كل طلب للمزود المقصود فقط كما يتطلب العقد.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void doFetchModels()}
              disabled={modelsFetching}
            >
              {modelsFetching ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 me-1" />
              )}
              🔄 جلب النماذج
            </Button>
            {modelsSource && (
              <Badge variant="secondary" className="text-xs">
                {models.length} نموذج — {modelsSource === "live" ? "مباشر" : "احتياطي مدمج"}
              </Badge>
            )}
          </div>

          {/* قائمة النماذج */}
          {models.length > 0 && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="free-first"
                    checked={settings.freeFirst}
                    onCheckedChange={(v) => setSettings({ freeFirst: v })}
                  />
                  <Label htmlFor="free-first" className="text-sm cursor-pointer">
                    ⭐ مجاني أولاً
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="vision-only"
                    checked={settings.visionOnly}
                    onCheckedChange={(v) => setSettings({ visionOnly: v })}
                  />
                  <Label htmlFor="vision-only" className="text-sm cursor-pointer">
                    👁 الرؤيوية فقط
                  </Label>
                </div>
              </div>
              <ScrollArea className="h-64 custom-scroll rounded-lg border">
                <RadioGroup
                  value={settings.model}
                  onValueChange={(v) => setSettings({ model: v })}
                  className="p-2 gap-1"
                >
                  {visibleModels.map((m) => (
                    <Label
                      key={m.name}
                      htmlFor={`model-${m.name}`}
                      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer min-h-11 transition-colors ${
                        settings.model === m.name
                          ? "border-primary bg-primary/10"
                          : "hover:bg-accent/50"
                      }`}
                    >
                      <RadioGroupItem value={m.name} id={`model-${m.name}`} />
                      <span className="font-mono text-xs truncate flex-1" dir="ltr">
                        {m.name}
                      </span>
                      <div className="flex gap-1 shrink-0">
                        {m.free ? (
                          <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                            ⭐ مجاني
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            💳 مدفوع
                          </Badge>
                        )}
                        {m.vision ? (
                          <Badge variant="outline" className="text-[10px] border-tertiary/40 text-tertiary">
                            👁 رؤيوي
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">
                            📄 نصي
                          </Badge>
                        )}
                      </div>
                    </Label>
                  ))}
                </RadioGroup>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                النموذج المختار: <span className="font-mono" dir="ltr">{settings.model}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 15.10 بطاقة حالة المزودين (فحص إقليمي) */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold flex items-center gap-1">
              <Globe className="h-4 w-4 text-primary" /> حالة المزودين (فحص إقليمي)
            </h3>
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => void onRecheck()}
              disabled={providersChecking}
            >
              {providersChecking ? (
                <Loader2 className="h-4 w-4 me-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 me-1" />
              )}
              إعادة الفحص
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {sortedProviders.map((p) => {
              const st = providerStatuses[p.id];
              const g = statusGlyph(st);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border p-2"
                  title={g.title ?? (st?.available ? "الفحص الأخير: متاح" : undefined)}
                >
                  <span aria-hidden className="shrink-0">{g.dot}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold truncate">{p.name_ar}</p>
                    <p className="text-[11px] text-muted-foreground truncate" dir="ltr">
                      {st?.host || "—"}
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <p className="text-[11px] whitespace-nowrap">{g.label}</p>
                    {st?.checkedAt && (
                      <p className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {relTime(st.checkedAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* 15.10.6 توصية Ollama — خط الدفاع الأخير المضمون */}
          <p className="text-xs text-tertiary border border-tertiary/30 rounded-lg p-2 bg-tertiary/10">
            لضمان عمل النظام بأي ظرف شبكي، يُنصح بتفعيل نموذج محلي احتياطي عبر Ollama.
            {ollamaStatus && !ollamaStatus.available && (
              <> يبدو Ollama غير مشغّل محلياً — ثبّته وشغّله ثم أعد الفحص.</>
            )}
          </p>
        </CardContent>
      </Card>

      {/* بطاقة التحسين */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-bold flex items-center gap-1">
            <Sparkles className="h-4 w-4 text-primary" /> التحسين الآمن
          </h3>
          <div className="space-y-1.5">
            <Label>البروفايل</Label>
            <Select
              value={settings.profile}
              onValueChange={(v) => setSettings({ profile: v })}
            >
              <SelectTrigger className="min-h-11" aria-label="اختيار بروفايل التحسين">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {profiles.length > 0
                  ? profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name_ar}
                      </SelectItem>
                    ))
                  : ["none", "darken_clarity", "manual_safe", "strong_shadow", "high_noise_safe", "low_res", "stamped", "official_document"].map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>
          {profiles.find((p) => p.id === settings.profile) && (
            <div className="rounded-lg bg-muted/50 p-3 space-y-1">
              <p className="text-xs font-semibold">
                {profiles.find((p) => p.id === settings.profile)!.name_ar}
              </p>
              <p className="text-xs text-muted-foreground">
                {profiles.find((p) => p.id === settings.profile)!.desc_ar}
              </p>
              <div className="flex flex-wrap gap-1 pt-1">
                {profiles
                  .find((p) => p.id === settings.profile)!
                  .steps.map((s, i) => (
                    <Badge key={i} variant="secondary" className="text-[10px] font-mono" dir="ltr">
                      {s}
                    </Badge>
                  ))}
              </div>
            </div>
          )}
          <p className="text-xs text-tertiary border border-tertiary/30 rounded-lg p-2 bg-tertiary/10">
            ⚠️ بروفايل «وثيقة رسمية» يحمي الأختام: بلا sharpen — استخدمه للوثائق المختومة الرسمية.
          </p>
        </CardContent>
      </Card>

      {/* بطاقة المعالجة */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="font-bold flex items-center gap-1">
            <Cog className="h-4 w-4 text-primary" /> المعالجة
          </h3>
          <div className="space-y-1.5">
            <Label htmlFor="dpi">دقة PDF (DPI) — 200 إلى 400</Label>
            <Input
              id="dpi"
              type="number"
              min={200}
              max={400}
              value={settings.dpi}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isNaN(v)) setSettings({ dpi: Math.min(400, Math.max(200, v)) });
              }}
              className="min-h-11"
            />
            <p className="text-[11px] text-muted-foreground">
              حارس DPI: القيم الأقل من 200 تُنذر — 300 هي الافتراضية الموصى بها.
            </p>
          </div>
          <Separator />
          <div className="flex items-center justify-between gap-2">
            <div>
              <Label htmlFor="consensus" className="text-sm">
                إجماع نموذجين
              </Label>
              <p className="text-[11px] text-muted-foreground">
                تصويت نموذجين لكل خلية — الخلاف يُعلَّم REVIEW
              </p>
            </div>
            <Switch
              id="consensus"
              checked={settings.consensusEnabled}
              onCheckedChange={(v) => setSettings({ consensusEnabled: v })}
            />
          </div>
          <Separator />
          {/* 15.10.5 مفتاح سلسلة التراجع التلقائي */}
          <div className="flex items-center justify-between gap-2">
            <div>
              <Label htmlFor="failover" className="text-sm">
                سلسلة تراجع تلقائي عند فشل المزود
              </Label>
              <p className="text-[11px] text-muted-foreground">
                عند حظر جغرافي/حد معدل ينتقل فوراً للمزود التالي (Ollama المحلي آخر حلقة) — مفتاح
                غير صحيح يوقف السلسلة وينبّهك فوراً
              </p>
            </div>
            <Switch
              id="failover"
              checked={settings.failoverEnabled}
              onCheckedChange={(v) => setSettings({ failoverEnabled: v })}
            />
          </div>
        </CardContent>
      </Card>

      {/* بطاقة KB والسجل التدقيقي */}
      <Card className="lg:col-span-2">
        <CardContent className="p-4 space-y-3">
          <h3 className="font-bold flex items-center gap-1">
            <Database className="h-4 w-4 text-primary" /> قاعدة المعرفة (KB) — النظام يتعلم من تصحيحاتك
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-[11px] text-muted-foreground">إدخالات KB</p>
              <p className="text-lg font-bold tabular-nums">{kbEntries}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-center">
              <p className="text-[11px] text-muted-foreground">تصحيحات مكتسبة</p>
              <p className="text-lg font-bold tabular-nums">{kbCorrections}</p>
            </div>
            <div className="col-span-2 rounded-lg bg-muted/50 p-3">
              <p className="text-[11px] text-muted-foreground mb-1">أكثر الحقول تعلّماً</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(kbByField)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5)
                  .map(([f, c]) => (
                    <Badge key={f} variant="secondary" className="text-[10px]">
                      {f}: {c}
                    </Badge>
                  ))}
                {Object.keys(kbByField).length === 0 && (
                  <span className="text-xs text-muted-foreground">لا إدخالات بعد</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="min-h-11" onClick={openAudit}>
                  {auditLoading ? (
                    <Loader2 className="h-4 w-4 me-1 animate-spin" />
                  ) : (
                    <ScrollText className="h-4 w-4 me-1" />
                  )}
                  عرض السجل التدقيقي
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto custom-scroll" dir="rtl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-1 text-lg">
                    <Eye className="h-4 w-4 text-primary" /> آخر 50 حدثاً — من/متى/أي نموذج
                  </DialogTitle>
                  <DialogDescription>
                    يُكتب تلقائياً من extract/export/enhance/benchmark/learn.
                  </DialogDescription>
                </DialogHeader>
                {auditEntries.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">لا أحداث مسجلة بعد</p>
                ) : (
                  <div className="rounded-lg border max-h-[55vh] overflow-y-auto custom-scroll">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="border-b bg-muted/60">الوقت</TableHead>
                          <TableHead className="border-b bg-muted/60">الحدث</TableHead>
                          <TableHead className="border-b bg-muted/60">الهدف</TableHead>
                          <TableHead className="border-b bg-muted/60">النموذج</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {auditEntries.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs border-b whitespace-nowrap" dir="ltr">
                              {e.ts}
                            </TableCell>
                            <TableCell className="text-xs border-b">{e.action}</TableCell>
                            <TableCell className="text-xs border-b max-w-48 truncate" title={e.target}>
                              {e.target}
                            </TableCell>
                            <TableCell className="text-xs border-b font-mono" dir="ltr">
                              {e.model ?? "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
