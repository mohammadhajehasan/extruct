import { NextRequest, NextResponse } from 'next/server';
import {
  pyServiceBase,
  pyServiceToken,
  pyServiceTimeoutMs,
  pyServiceUnreachableError,
} from '@/lib/extractor/py-service';

/**
 * وكيل شفاف إلى خدمة Python (المستخرج الأسطوري).
 * يُمرَّر: /api/py/<path>?<query> → <PY_EXTRACTOR_URL>/api/<path>?<query>
 * وعند غياب الضبط: http://127.0.0.1:8000/api/<path> (التطوير المحلي).
 * يدعم JSON و multipart و الاستجابات الثنائية (تصدير الملفات) مع الترويسات المهمة.
 * الرابط والسر يبقيان على السيرفر — لا يُكشفان للمتصفح أبداً.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
]);

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const incoming = new URL(req.url);
  const target = `${pyServiceBase()}/${(path || []).join('/')}${incoming.search || ''}`;

  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const accept = req.headers.get('accept');
  if (accept) headers.set('accept', accept);
  // سر مشترك للخدمة المستضافة (لا يأتي من العميل أبداً)
  const token = pyServiceToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const method = req.method.toUpperCase();
  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, {
      method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(pyServiceTimeoutMs()),
    });
  } catch (err: unknown) {
    const detail =
      err instanceof Error
        ? err.name === 'TimeoutError' || err.name === 'AbortError'
          ? 'انتهت المهلة'
          : err.message
        : 'اتصال مقطوع';
    return NextResponse.json(
      { ok: false, error: pyServiceUnreachableError(detail), error_type: 'network_down' },
      { status: 502 },
    );
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
