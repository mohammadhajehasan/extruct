import type { Metadata } from "next";
import { Cairo, Roboto } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

/* Material Design: Roboto للاتينية والأرقام، Cairo احتياطاً للعربية */
const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const cairo = Cairo({
  variable: "--font-cairo",
  subsets: ["arabic", "latin"],
  weight: ["400", "600", "700"],
});

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
      className={`${roboto.variable} ${cairo.variable}`}
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
