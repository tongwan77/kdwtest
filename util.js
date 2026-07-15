function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  // Vercel Node 서버리스 함수는 JSON 본문을 req.body로 미리 파싱해서 넘겨줍니다.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return Promise.resolve(req.body ? JSON.parse(req.body) : {}); }
      catch (e) { return Promise.resolve({}); }
    }
    return Promise.resolve(req.body);
  }
  // 로컬 raw http 서버(server.js)에서는 스트림을 직접 읽습니다.
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 5 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// 매우 단순한 라우터: pattern e.g. '/api/admin/items/:id'
function compilePattern(pattern) {
  const keys = [];
  const regexStr = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + regexStr + '$'), keys };
}

class Router {
  constructor() {
    this.routes = [];
  }
  add(method, pattern, handler) {
    const { regex, keys } = compilePattern(pattern);
    this.routes.push({ method, regex, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  async handle(req, res, pathname) {
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      await r.handler(req, res, params);
      return true;
    }
    return false;
  }
}

function getIp(req) {
  return (req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '').toString();
}

module.exports = { sendJSON, readBody, Router, getIp };
