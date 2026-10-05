import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PY_BASE = (
  process.env.PY_BASE ||
  process.env.PY_EXTRACTOR_URL ||
  process.env.NEXT_PUBLIC_PY_BASE ||
  'http://127.0.0.1:8000/api'
).replace(/\/$/, '');

async function handler(req: NextRequest) {
  const target = `${PY_BASE}/health`;
  const res = await fetch(target, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
  });
  return new NextResponse(JSON.stringify({ ok: res.ok }), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}

export GET = handler;
