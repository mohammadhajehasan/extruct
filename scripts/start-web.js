#!/usr/bin/env node
/**
 * scripts/start-web.js — تشغيل نسخة الإنتاج (Next.js standalone) بين الأنظمة.
 *
 * السبب: السكربت القديم
 *   NODE_ENV=production node .next/standalone/server.js 2>&1 | tee server.log
 * لا يعمل على Windows (صيغة المتغيرات غير مدعومة في cmd.exe و`tee` غير موجود).
 * هذا الملف يضبط NODE_ENV ويمرّر الخرج إلى الطرفية وإلى server.log معاً.
 *
 * الاستخدام:  npm run build && npm start
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = String(process.env.PORT || 3000);
const hostname = process.env.HOSTNAME || '0.0.0.0';
const server = path.join(root, '.next', 'standalone', 'server.js');
const logFile = path.join(root, 'server.log');

if (!fs.existsSync(server)) {
  console.error('✖ لم يتم العثور على .next/standalone/server.js — نفّذ `npm run build` أولاً.');
  process.exit(1);
}

const log = fs.createWriteStream(logFile, { flags: 'a' });
log.write(`\n===== production start ${new Date().toISOString()} (port ${port}) =====\n`);

const child = spawn(process.execPath, [server], {
  cwd: root,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'production', PORT: port, HOSTNAME: hostname },
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
  log.write(`===== production exit code=${code} signal=${signal} =====\n`);
  log.end();
  process.exit(code === null ? (signal ? 1 : 0) : code);
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    try { child.kill(sig); } catch { /* تجاهل */ }
  });
}

