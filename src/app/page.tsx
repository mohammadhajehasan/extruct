"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Moon,
  Sun,
  ScanText,
  CarFront,
  Scale,
  SearchCheck,
  Settings2,
  BarChart3,
  Wifi,
  WifiOff,
} from "lucide-react";
import { TablesTab } from "@/components/extractor/tables-tab";
import { MechanicTab } from "@/components/extractor/mechanic-tab";
import { BenchmarkTab } from "@/components/extractor/benchmark-tab";
import { ReviewTab } from "@/components/extractor/review-tab";
import { SettingsTab } from "@/components/extractor/settings-tab";
import { useExtractorStore } from "@/lib/extractor/store";
import { getHealth } from "@/lib/extractor/api";

const subscribeNoop = () => () => {};
/** useMounted: false في الخادم وأول رسم، true بعد التركيب على العميل — يمنع hydration mismatch */
function useMounted(): boolean {
  return useSyncExternalStore(subscribeNoop, () => true, () => false);
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="تبديل الوضع الليلي" disabled>
        <Sun className="h-5 w-5" />
      </Button>
    );
  }
  const isDark = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-11 w-11"
      aria-label={isDark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun className="h-5 w-5 text-tertiary" /> : <Moon className="h-5 w-5" />}
    </Button>
  );
}

export default function Home() {
  const mounted = useMounted();
  const health = useExtractorStore((s) => s.health);
  const setHealth = useExtractorStore((s) => s.setHealth);
  const reviewCount = useExtractorStore((s) => s.reviewQueue.length);

  // تمهيد التخزين المحلي (settings فقط) بعد التركيب — يمنع hydration mismatch
  useEffect(() => {
    void useExtractorStore.persist.rehydrate();
  }, []);

  // نبض الخدمة كل 15 ثانية
  useEffect(() => {
    let alive = true;
    const ping = async () => {
      try {
        const h = await getHealth();
        if (!alive) return;
        setHealth({
          connected: true,
          version: h.version,
          capabilities: h.capabilities,
          lastCheck: Date.now(),
        });
      } catch {
        if (!alive) return;
        if (useExtractorStore.getState().health.connected) {
          toast.error("انقطع الاتصال بخدمة الاستخراج — تأكد من تشغيلها");
        }
        setHealth({ connected: false, lastCheck: Date.now() });
      }
    };
    void ping();
    const t = setInterval(ping, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [setHealth]);

  return (
    <div className="min-h-screen flex flex-col bg-background" dir="rtl">
      {/* الترويسة */}
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground elevation-1 shrink-0">
            <ScanText className="h-6 w-6" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold leading-tight flex items-center gap-2 flex-wrap">
              المستخرج الأسطوري
              <Badge className="bg-secondary text-secondary-foreground border-transparent font-semibold">
                v7.1 حاكمة
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground hidden sm:block">
              استخراج جداول ومعلومات المركبات — نقل حرفي • غموض مُعلَّم • تحسين يرفع الدقة
            </p>
          </div>
          <div className="grow" />
          {/* مؤشر حالة خدمة Python */}
          <div
            className={`flex items-center gap-2 rounded-full border border-transparent px-4 py-2 text-xs font-medium min-h-11 ${
              health.connected
                ? "bg-secondary text-secondary-foreground"
                : "bg-destructive/10 text-destructive border-destructive/30"
            }`}
            role="status"
            aria-live="polite"
          >
            {health.connected ? (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
                </span>
                <Wifi className="h-3.5 w-3.5" aria-hidden />
                الخدمة متصلة{health.version ? ` — v${health.version}` : ""}
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5" aria-hidden />
                الخدمة غير متصلة
              </>
            )}
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* المحتوى */}
      <main className="mx-auto w-full max-w-7xl grow px-4 py-6">
        <Tabs defaultValue="tables" className="w-full">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto custom-scroll flex-nowrap sm:flex-wrap p-1 mb-4">
            <TabsTrigger
              value="tables"
              className="min-h-11 gap-1.5 px-4 text-sm sm:text-base"
            >
              <BarChart3 className="h-4 w-4" aria-hidden /> 📊 الجداول
            </TabsTrigger>
            <TabsTrigger
              value="mechanic"
              className="min-h-11 gap-1.5 px-4 text-sm sm:text-base"
            >
              <CarFront className="h-4 w-4" aria-hidden /> 🚗 الميكانيك
            </TabsTrigger>
            <TabsTrigger
              value="benchmark"
              className="min-h-11 gap-1.5 px-4 text-sm sm:text-base"
            >
              <Scale className="h-4 w-4" aria-hidden /> ⚖️ مقارنة النماذج
            </TabsTrigger>
            <TabsTrigger
              value="review"
              className="min-h-11 gap-1.5 px-4 text-sm sm:text-base"
            >
              <SearchCheck className="h-4 w-4" aria-hidden /> 🔍 التدقيق
              {mounted && reviewCount > 0 && (
                <Badge className="ms-1 bg-tertiary/20 text-tertiary border border-tertiary/40 tabular-nums">
                  {reviewCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="min-h-11 gap-1.5 px-4 text-sm sm:text-base"
            >
              <Settings2 className="h-4 w-4" aria-hidden /> ⚙️ الإعدادات
            </TabsTrigger>
          </TabsList>

          {/* forceMount يحفظ حالة الجلسات عند تبديل التبويبات، والإخفاء عبر data-state */}
          <TabsContent value="tables" forceMount className="data-[state=inactive]:hidden">
            <TablesTab />
          </TabsContent>
          <TabsContent value="mechanic" forceMount className="data-[state=inactive]:hidden">
            <MechanicTab />
          </TabsContent>
          <TabsContent value="benchmark" forceMount className="data-[state=inactive]:hidden">
            <BenchmarkTab />
          </TabsContent>
          <TabsContent value="review" forceMount className="data-[state=inactive]:hidden">
            <ReviewTab />
          </TabsContent>
          <TabsContent value="settings" forceMount className="data-[state=inactive]:hidden">
            <SettingsTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* التذييل الثابت */}
      <footer className="mt-auto border-t border-outline-variant bg-surface-container pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p className="font-semibold">
            نقل كما هو مكتوب • الغموض يُعلَّم ولا يُخمَّن • التحسين الجيد ما يرفع الدقة لا ما يبدو أجمل
          </p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                health.connected ? "bg-primary" : "bg-destructive"
              }`}
              aria-hidden
            />
            <span>
              {health.connected
                ? `خدمة الاستخراج متصلة${health.version ? ` (v${health.version})` : ""}`
                : "خدمة الاستخراج غير متصلة"}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
