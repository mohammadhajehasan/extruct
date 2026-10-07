import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "المستخرج الأسطوري v7.1",
  description:
    "نظام استخراج الجداول ومعلومات المركبات (الـ13 حقلاً) من الصور وملفات PDF — نقل حرفي، الغموض يُعلَّم ولا يُخمَّن، والتحسين الجيد ما يرفع الدقة لا ما يبدو أجمل.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className="font-sans"
    >
      <body className="antialiased bg-background text-foreground font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster position="bottom-left" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
