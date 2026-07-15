const http = require('http');
const fs = require('fs');
const path = require('path');
const { router } = require('./api');
const { sendJSON } = require('./util');
const { initDb } = require('./db');

const PORT = process.env.PORT || 8787;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(data2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;
    if (pathname.startsWith('/api/')) {
      const handled = await router.handle(req, res, pathname);
      if (!handled) sendJSON(res, 404, { error: 'Not found' });
      return;
    }
    serveStatic(req, res, pathname);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJSON(res, 500, { error: '서버 오류가 발생했습니다.', detail: e.message });
  }
});

async function start() {
  try {
    await initDb();
  } catch (err) {
    console.error('[server] DB 초기화 실패:', err.message);
    console.error('POSTGRES_URL / DATABASE_URL 환경변수와 네트워크 연결(Neon 등)을 확인하세요.');
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`영양사 식자재 재고관리 시스템이 http://localhost:${PORT} 에서 실행 중입니다.`);
  });
}

start();
