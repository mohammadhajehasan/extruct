"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui-bundle";
import {
  Phone,
  Mail,
  MessageCircle,
  UserRound,
  BadgeCheck,
} from "lucide-react";

export function ContactTab() {
  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <UserRound className="h-6 w-6 text-primary" aria-hidden />
        </div>
        <div>
          <h1 className="text-2xl font-bold">📞 تواصل مع المطور</h1>
          <p className="text-sm text-muted-foreground">
            تم تطوير وتصميم النظام من قبل المهندس احمد الفرحات
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Phone className="h-5 w-5 text-primary" aria-hidden />
              رقم الهاتف
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              <a
                href="tel:+963991758886"
                className="font-semibold text-primary hover:underline"
              >
                +963991758886
              </a>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              متاح للاتصال المباشر
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageCircle className="h-5 w-5 text-primary" aria-hidden />
              واتساب
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              <a
                href="https://wa.me/963991758886"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-primary hover:underline"
              >
                +963991758886
              </a>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              واتساب: +963991758886
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-5 w-5 text-primary" aria-hidden />
              البريد الإلكتروني
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              <a
                href="mailto:ahmadalfarahat099175@gmail.com"
                className="font-semibold text-primary hover:underline"
              >
                ahmadalfarahat099175@gmail.com
              </a>
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              للتواصل الفني والملاحظات
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BadgeCheck className="h-5 w-5 text-primary" aria-hidden />
            معلومات المطور
          </CardTitle>
          <CardDescription>
            تم تطوير وتصميم النظام من قبل المهندس احمد الفرحات
          </CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
          <UserRound className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            للتواصل المباشر: +963991758886
            {" "}• واتساب +963991758886
            {" "}• ahmadalfarahat099175@gmail.com
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
