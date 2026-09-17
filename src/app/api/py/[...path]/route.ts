import { NextRequest, NextResponse } from 'next/server';

/**
 *وكيل شفاف إلى خدمة Python (المستخرج الأسطوري) على المنفذ 8000.
 * يُمرَّر: /api/py/<path>?<query> → http://127.0.0.1:8000/api/<path>?<query>
 * يدعم JSON و multipart و الاستجابات ثنائية (تصدير الملفات) مع الترويسات المهمة.
 * است Calls من السيرفر إلى سيرفر على نفس الجهاز — لا ي Reveals المنفذ للمتصafen أبداً.
 *
 * PY_BASE يُقرأ من البيئة (PY_BASE / PY_EXTRACTOR_URL / NEXT_PUBLIC_PY_BASE) —
 * محلياً يُستخدم http://127.0.0.1:8000/api، على الاستضافة يُستخدم عنوان الـ backend.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const PY_BASE = (
  process.env.PY_BASE ||
  process.env.PY_EXTRACTOR_URL ||
  process.env.NEXT_PUBLIC_PY_BASE ||
  'http://127.0.0.1:8000/api'
).replace(/\/$/, '');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const incoming = new URL(req.url);
  const target = `${PY_BASE}/${(path || []).join('/')}${incoming.search || ''}`;

  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const accept = req.headers.get('accept');
  if (accept) headers.set('accept', accept);

  const method = req.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, { method, headers, body, cache: 'no-store' });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'تعذر الاتصال بخدمة الاستخراج';
    return NextResponse.json({ ok: false, error: `خدمة Python غير متاحة: ${message}` }, { status: 502 });
  }

  const resHeaders = new Headers();
  res.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) resHeaders.set(key, value);
  });

  const data = await res.arrayBuffer();
  return new NextResponse(data, { status: res.status, headers: resHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
