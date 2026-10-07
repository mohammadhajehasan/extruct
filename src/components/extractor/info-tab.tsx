"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui-bundle";
import {
  ScanText,
  Upload,
  BarChart3,
  CarFront,
  Scale,
  SearchCheck,
  AlertTriangle,
  Settings2,
  ClipboardCheck,
  Download,
} from "lucide-react";

export function InfoTab() {
  const sections = [
    {
      icon: <ScanText className="h-5 w-5 text-primary" aria-hidden />,
      title: "نظرة عامة على النظام",
      desc:
        "المستخرج الأسطوري v7.1 هو نظام محلي يستخرج الجداول ومعلومات السيارات (🚗 13 حقلاً ميكانيكياً) من صور الأقلام المسحوبة وملفات PDF. يعتمد على نماذج رؤية ذكاء اصطناعي متعددة مع خيار failover بين المزودات ويدعم Ollama محلياً كخيار أخير.",
    },
    {
      icon: <Upload className="h-5 w-5 text-primary" aria-hidden />,
      title: "كيفية الاستخدام",
      desc: "حمّل صورة أو ملف PDF من خلال منطقة السحب أو زر التحميل، ثم اختر التبويب. استخرج الجداول أو صنّف الميكانيك خطوة بخطوة، وستظهر الأخطاء في «الأفلاس» مع زر إعادة المحاولة.",
    },
    {
      icon: <BarChart3 className="h-5 w-5 text-primary" aria-hidden />,
      title: "📊 الجداول",
      desc: "يستخرج الجداول من كل صورة. الخلايا غير المقروءة (UNCLEAR) تُرسل تلقائياً إلى «التدقيق» لتدريب النظام.",
    },
    {
      icon: <CarFront className="h-5 w-5 text-primary" aria-hidden />,
      title: "🚗 الميكانيك",
      desc: "يصنّف الوجوه، يجمعها في مجموعات، ثم يستخرج 13 الحقل الميكانيكية مع التحقق من صلاحية الشاسيه (VIN).",
    },
    {
      icon: <Scale className="h-5 w-5 text-primary" aria-hidden />,
      title: "⚖️ مقارنة النماذج",
      desc: "يقارن بين نماذج متعددة على نفس الصور ويحدد أدق نموذج بالإجماع.",
    },
    {
      icon: <SearchCheck className="h-5 w-5 text-primary" aria-hidden />,
      title: "🔍 التدقيق",
      desc: "قائمة مراجعة للخلايا/الحقول ذات الثقة المنخفضة — علّم النظام الحقيقة لتحسين دقته تلقائياً.",
    },
    {
      icon: <AlertTriangle className="h-5 w-5 text-primary" aria-hidden />,
      title: "⚠️ الأفلاس",
      desc: "تسجيل الفشل مع إمكانية معاينة الصورة وإعادة المحاولة. يدعم إعادة محاولة مجموعات الوجوه.",
    },
    {
      icon: <Settings2 className="h-5 w-5 text-primary" aria-hidden />,
      title: "⚙️ الإعدادات",
      desc: "تكوين المزود، المفتاح، معدل DPI، التوازي، وسلسلة التراجع (failover) بين المزودات والـOllama المحلي.",
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <ScanText className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold">📘 دليل المستخدم والمعلومات</h1>
          <p className="text-sm text-muted-foreground">
            نظام المستخرج الأسطوري — كل ما تحتاجه معرفته للبدء
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((s) => (
          <Card key={s.title}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {s.icon}
                {s.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-xs text-muted-foreground">
                {s.desc}
              </CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-5 w-5 text-primary" aria-hidden />
            خطوات سريعة للبدء
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 text-sm">
          <div className="flex items-start gap-2">
            <span className="font-semibold text-primary shrink-0">1.</span>
            <span>افتح النظام وتأكد أن مؤشر الخدمة الأخضر (متصلة).</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-semibold text-primary shrink-0">2.</span>
            <span>اسحب صورة أو PDF إلى منطقة الرفع في الجدول أو الميكانيك.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-semibold text-primary shrink-0">3.</span>
            <span>اختر التبويب (📊 الجداول أو 🚗 الميكانيك) وابدأ الاستخراج.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-semibold text-primary shrink-0">4.</span>
            <span>راجع ✅ النتائج، ثم صدّق/صحّح الخلايا المعلعلة في 🔍 التدقيق.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="font-semibold text-primary shrink-0">5.</span>
            <span>صدّر الجدول كـ CSV/Excel باستخدام زر التنزيل.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-5 w-5 text-primary" aria-hidden />
            ملاحظات مهمة
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <li>النظام كامل محلياً — لا يرفع صورك بشكل تلقائي إلا إلى المزود الذي تحدده.</li>
          <li>الغموض يُعلّم ولا يُخمّن؛ صحّح الخلايا المعلّقة في التدقيق لتحسين الدقة.</li>
          <li>فشل الاستخراج؟ اضغط إعادة في ⚠️ الأفلاس — يدعم الموافقة بين النماذج تلقائياً.</li>
        </CardContent>
      </Card>
    </div>
  );
}
