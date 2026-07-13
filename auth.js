const crypto = require('crypto');
const { db, verifyPassword } = require('./db');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8시간

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, expiresAt);
  return token;
}

function getSession(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  const user = db.prepare('SELECT id, username, name, role, is_active FROM users WHERE id = ?').get(row.user_id);
  if (!user || !user.is_active) return null;
  return user;
}

function destroySession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function parseCookies(req) {
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

function login(username, password, ip) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !user.is_active) {
    db.prepare('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)')
      .run(user ? user.id : null, username, 'LOGIN_FAIL', ip);
    return null;
  }
  const ok = verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) {
    db.prepare('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)')
      .run(user.id, username, 'LOGIN_FAIL', ip);
    return null;
  }
  db.prepare('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)')
    .run(user.id, username, 'LOGIN_SUCCESS', ip);
  const token = createSession(user.id);
  return { token, user: { id: user.id, username: user.username, name: user.name, role: user.role, must_reset: user.must_reset } };
}

function logout(token, user, ip) {
  if (user) {
    db.prepare('INSERT INTO auth_logs (user_id, username, action, ip) VALUES (?,?,?,?)')
      .run(user.id, user.username, 'LOGOUT', ip);
  }
  destroySession(token);
}

module.exports = { createSession, getSession, destroySession, parseCookies, login, logout };
