#!/usr/bin/env node
/**
 * scripts/dev.js — تشغيل خادم Next.js للتطوير (dev) بشكل متوازٍ بين الأنظمة.
 *
 * السبب: السكربت القديم كان يستخدم `| tee dev.log` وهو أمر غير موجود في cmd.exe
 * على Windows فيتعطّل `npm run dev`. هذا الملف يمرّر الخرج إلى الطرفية وإلى
 * dev.log في الوقت نفسه عبر Node فقط (بلا tee وبلا bash).
 *
 * الاستخدام:  npm run dev            → المنفذ 3000
 *             PORT=3100 npm run dev  → منفذ آخر
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = String(process.env.PORT || 3000);
const logFile = path.join(root, 'dev.log');
const log = fs.createWriteStream(logFile, { flags: 'a' });

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
if (!fs.existsSync(nextBin)) {
  console.error('✖ لم يتم العثور على Next.js في node_modules — نفّذ تثبيت الحزم أولاً (npm install).');
  process.exit(1);
}

log.write(`\n===== dev start ${new Date().toISOString()} (port ${port}) =====\n`);

const child = spawn(process.execPath, [nextBin, 'dev', '-p', port], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: process.env,
});

/** تمرير الخرج إلى الطرفية + ملف السجل معاً (بديل tee عبر المنصات) */
function forward(stream, out) {
  if (!stream) return;
  stream.on('data', (chunk) => {
    out.write(chunk);
    log.write(chunk);
  });
}

forward(child.stdout, process.stdout);
forward(child.stderr, process.stderr);

child.on('exit', (code, signal) => {
  log.write(`===== dev exit code=${code} signal=${signal} =====\n`);
  log.end();
  process.exit(code === null ? (signal ? 1 : 0) : code);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* تجاهل */ }
  });
}
