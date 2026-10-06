import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PY_BASE = (
  process.env.PY_BASE ||
  process.env.PY_EXTRACTOR_URL ||
  process.env.NEXT_PUBLIC_PY_BASE ||
  'http://127.0.0.1:8000/api'
).replace(/\/$/, '');

export async function GET(request: NextRequest) {
  const target = `${PY_BASE}/health`;
  const res = await fetch(target, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'accept': 'application/json',
    },
  });
  const data = await res.json();
  return NextResponse.json(data, {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
