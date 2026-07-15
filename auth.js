const crypto = require('crypto');
const { db, verifyPassword } = require('./db');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8시간

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)', [token, userId, expiresAt]);
  return token;
}

async function getSession(token) {
  if (!token) return null;
  const row = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  const user = await db.get('SELECT id, username, name, role, is_active FROM users WHERE id = ?', [row.user_id]);
  if (!user || !user.is_active) return null;
  return user;
}

async function destroySession(token) {
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
}

// Vercel Node 서버리스 함수는 req.cookies를 자동으로 파싱해줍니다.
// 로컬 raw http 서버(server.js)에서는 직접 헤더를 파싱합니다.
function parseCookies(req) {
  if (req.cookies && typeof req.cookies === 'object') return req.cookies;
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

async function login(username, password, ip) {
  const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user || !user.is_active) {
    await db.run('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)', [user ? user.id : null, username, 'LOGIN_FAIL', ip]);
    return null;
  }
  const ok = verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) {
    await db.run('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)', [user.id, username, 'LOGIN_FAIL', ip]);
    return null;
  }
  await db.run('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)', [user.id, username, 'LOGIN_SUCCESS', ip]);
  const token = await createSession(user.id);
  return { token, user: { id: user.id, username: user.username, name: user.name, role: user.role, must_reset: user.must_reset } };
}

async function logout(token, user, ip) {
  if (user) {
    await db.run('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)', [user.id, user.username, 'LOGOUT', ip]);
  }
  await destroySession(token);
}

module.exports = { createSession, getSession, destroySession, parseCookies, login, logout };
