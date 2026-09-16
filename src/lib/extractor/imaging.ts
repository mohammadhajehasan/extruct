"use client";

// مساعدات معالجة الصور في المتصفح — مكدس عمليات غير إتلافي
// الأصل (dataUrl) لا يُلمس أبداً؛ العمليات تُطبَّق لحظة التطبيق/الاستخراج فقط

import type { EditorOp } from "./types";
import { dataUrlToB64, b64ToDataUrl } from "./api";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("فشل تحميل الصورة"));
    img.src = src;
  });
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

/** مستطيل المحتوى (حدود غير بيضاء) للقص التلقائي — يُرجع null إن لم يجد */
export function findContentRect(canvas: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const isContent = (i: number) => {
    // أي قناة أغمق من 240 تعتبر محتوى (خلفية بيضاء ≈ 255)
    return data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240;
  };
  let top = -1, bottom = -1, left = -1, right = -1;
  outer1: for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (isContent((y * w + x) * 4)) { top = y; break outer1; }
  if (top < 0) return null;
  outer2: for (let y = h - 1; y >= 0; y--)
    for (let x = 0; x < w; x++)
      if (isContent((y * w + x) * 4)) { bottom = y; break outer2; }
  outer3: for (let x = 0; x < w; x++)
    for (let y = 0; y < h; y++)
      if (isContent((y * w + x) * 4)) { left = x; break outer3; }
  outer4: for (let x = w - 1; x >= 0; x--)
    for (let y = 0; y < h; y++)
      if (isContent((y * w + x) * 4)) { right = x; break outer4; }
  return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
}

/** يطبق مكدس العمليات على صورة الأصل ويعيد canvas جديد (الأصل سليم دائماً) */
export async function renderOpsToCanvas(img: HTMLImageElement, ops: EditorOp[]): Promise<HTMLCanvasElement> {
  let canvas = newCanvas(img.naturalWidth, img.naturalHeight);
  canvas.getContext("2d")!.drawImage(img, 0, 0);

  for (const op of ops) {
    switch (op.op) {
      case "rot90": {
        const next = newCanvas(canvas.height, canvas.width);
        const nctx = next.getContext("2d")!;
        nctx.translate(next.width / 2, next.height / 2);
        nctx.rotate(Math.PI / 2);
        nctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        canvas = next;
        break;
      }
      case "rot180": {
        const next = newCanvas(canvas.width, canvas.height);
        const nctx = next.getContext("2d")!;
        nctx.translate(canvas.width / 2, canvas.height / 2);
        nctx.rotate(Math.PI);
        nctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
        canvas = next;
        break;
      }
      case "flip_h": {
        const next = newCanvas(canvas.width, canvas.height);
        const nctx = next.getContext("2d")!;
        nctx.translate(canvas.width, 0);
        nctx.scale(-1, 1);
        nctx.drawImage(canvas, 0, 0);
        canvas = next;
        break;
      }
      case "flip_v": {
        const next = newCanvas(canvas.width, canvas.height);
        const nctx = next.getContext("2d")!;
        nctx.translate(0, canvas.height);
        nctx.scale(1, -1);
        nctx.drawImage(canvas, 0, 0);
        canvas = next;
        break;
      }
      case "crop": {
        const x = Math.max(0, Math.round(op.params.x));
        const y = Math.max(0, Math.round(op.params.y));
        const w = Math.min(canvas.width - x, Math.round(op.params.w));
        const h = Math.min(canvas.height - y, Math.round(op.params.h));
        if (w <= 0 || h <= 0) break;
        const next = newCanvas(w, h);
        next.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        canvas = next;
        break;
      }
      case "autocrop": {
        const rect = findContentRect(canvas);
        if (rect && rect.w > 4 && rect.h > 4) {
          const next = newCanvas(rect.w, rect.h);
          next.getContext("2d")!.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
          canvas = next;
        }
        break;
      }
      case "upscale": {
        const factor = (op.params.percent ?? 100) / 100;
        const uw = Math.max(1, Math.round(canvas.width * factor));
        const uh = Math.max(1, Math.round(canvas.height * factor));
        const next = newCanvas(uw, uh);
        const nctx = next.getContext("2d")!;
        nctx.imageSmoothingEnabled = true;
        nctx.imageSmoothingQuality = "high";
        nctx.drawImage(canvas, 0, 0, uw, uh);
        canvas = next;
        break;
      }
      case "bright":
      case "contrast": {
        const v = op.params.value / 100;
        const next = newCanvas(canvas.width, canvas.height);
        const nctx = next.getContext("2d")!;
        nctx.filter = op.op === "bright" ? `brightness(${(1 + v).toFixed(3)})` : `contrast(${(1 + v).toFixed(3)})`;
        nctx.drawImage(canvas, 0, 0);
        nctx.filter = "none";
        canvas = next;
        break;
      }
    }
  }
  return canvas;
}

/** dataUrl مع العمليات المطبقة (للمعاينة/التحسين) */
export async function renderOpsToDataUrl(dataUrl: string, ops: EditorOp[]): Promise<string> {
  if (ops.length === 0) return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = await renderOpsToCanvas(img, ops);
  return canvas.toDataURL("image/png");
}

/** مصغرة سريعة للقائمة بعد التطبيق */
export async function makeThumb(dataUrl: string, max = 160): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = newCanvas(img.naturalWidth * scale, img.naturalHeight * scale);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

/**
 * تسوية صورة النموذج: النماذج الرؤيوية تُصغّر الصورة داخلياً إلى ~1.1–1.6 ميجابكسل،
 * فأي شيء فوق 2048px بالضلع الأطول (مثل صفحات PDF بمعدل 300dpi ≈ 2480×3508)
 * يضاعف زمن الرفع والمعالجة لدى المزود دون أي رفع للدقة — عملياً 72–248 ثانية/صورة.
 * الترميز JPEG بخلفية بيضاء (بلا قناة ألفا) يقلّص الحمولة ~10–20×،
 * والأصل كامل الدقة يبقى محفوظاً في المتصفح للعرض والتصدير دون مساس.
 */
export const MODEL_MAX_EDGE = 2048;
export const MODEL_JPEG_QUALITY = 0.92;

/** قص جزء محدد من الصورة وإرجاعه كصورة جديدة */
export async function cropImageToDataUrl(
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<string> {
  const img = await loadImage(dataUrl);
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  const c = newCanvas(cw, ch);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, x, y, w, h, 0, 0, cw, ch);
  return c.toDataURL("image/png");
}

/** أي صورة (dataUrl) → base64 خام مُسوّى للنموذج (حد الضلع + JPEG بخلفية بيضاء) */
export async function imageToModelB64(src: string): Promise<string> {
  const img = await loadImage(src);
  const long = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = Math.min(1, MODEL_MAX_EDGE / long);
  const c = newCanvas(Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; // JPEG بلا ألفا — يمنع تحوّل الشفاف إلى أسود
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return dataUrlToB64(c.toDataURL("image/jpeg", MODEL_JPEG_QUALITY));
}

/**
 * الصورة الجاهزة للاستخراج (base64 خام بلا بادئة):
 * المحسّنة إن وُجدت، وإلا الأصل بعد تطبيق عمليات المحرر —
 * تُمرّ إجبارياً عبر تسوية الحجم/الترميز لتقليل زمن الاستخراج جذرياً.
 */
export async function getExtractB64(item: {
  dataUrl: string;
  ops: EditorOp[];
  enhanced?: { b64: string } | undefined;
}): Promise<string> {
  const src = item.enhanced?.b64
    ? b64ToDataUrl(item.enhanced.b64)
    : item.ops.length > 0
      ? await renderOpsToDataUrl(item.dataUrl, item.ops)
      : item.dataUrl;
  return imageToModelB64(src);
}

/** الصورة المرسلة للتحسين/التصنيف/التجميع: نفس تسوية الحجم والترميز (الأصل سليم دائماً) */
export async function getEnhanceB64(item: { dataUrl: string; ops: EditorOp[] }): Promise<string> {
  const src = item.ops.length > 0 ? await renderOpsToDataUrl(item.dataUrl, item.ops) : item.dataUrl;
  return imageToModelB64(src);
}
