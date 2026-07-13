const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'app.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','NUTRITIONIST')),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_reset INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_code TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE(user_id, store_id)
);

CREATE TABLE IF NOT EXISTS common_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_code TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(group_code, code)
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code TEXT UNIQUE NOT NULL,
  item_name TEXT NOT NULL,
  large_category TEXT,
  mid_category TEXT,
  small_category TEXT,
  spec TEXT,
  purchase_unit TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','API')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_code TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','API')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS initial_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL DEFAULT 0,
  set_by INTEGER REFERENCES users(id),
  set_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(store_id, item_id)
);

CREATE TABLE IF NOT EXISTS inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  inbound_date TEXT NOT NULL,
  quantity REAL NOT NULL,
  supply_price REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  expiry_date TEXT,
  inbound_temp TEXT,
  package_status TEXT,
  quality_status TEXT,
  memo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  outbound_date TEXT NOT NULL,
  quantity REAL NOT NULL,
  supply_price REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  memo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS io_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  io_type TEXT NOT NULL CHECK(io_type IN ('INBOUND','OUTBOUND')),
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','DELETE')),
  target_id INTEGER NOT NULL,
  store_id INTEGER,
  item_id INTEGER,
  detail TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL CHECK(action IN ('LOGIN_SUCCESS','LOGIN_FAIL','LOGOUT')),
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE')),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id)
);
`);

// ---------- password hashing (scrypt: Node.js 내장, OWASP 권장 알고리즘) ----------
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(plain, salt, 64).toString('hex');
  return { hash, salt };
}
function verifyPassword(plain, hash, salt) {
  const check = crypto.scryptSync(plain, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// ---------- seed ----------
function seed() {
  const superAdminCount = db.prepare("SELECT COUNT(*) c FROM users WHERE role='SUPER_ADMIN'").get().c;
  if (superAdminCount === 0) {
    const { hash, salt } = hashPassword('Admin!2024');
    db.prepare(`INSERT INTO users (username, password_hash, password_salt, role, name, must_reset)
                VALUES (?,?,?,?,?,0)`)
      .run('admin', hash, salt, 'SUPER_ADMIN', '최고관리자');
    console.log('[seed] 최고관리자 계정 생성: admin / Admin!2024 (반드시 로그인 후 변경 요청 절차를 확인하세요)');
  }

  const qsCount = db.prepare("SELECT COUNT(*) c FROM common_codes WHERE group_code='QUALITY_STATUS'").get().c;
  if (qsCount === 0) {
    const codes = [
      ['GOOD', '양호', 1],
      ['BAD', '불량', 2],
      ['MISSING', '누락', 3],
      ['DAMAGED', '파손', 4],
      ['ETC', '기타', 5],
    ];
    const ins = db.prepare(`INSERT INTO common_codes (group_code, code, label, sort_order) VALUES ('QUALITY_STATUS', ?, ?, ?)`);
    for (const [code, label, order] of codes) ins.run(code, label, order);
  }

  const pkCount = db.prepare("SELECT COUNT(*) c FROM common_codes WHERE group_code='PACKAGE_STATUS'").get().c;
  if (pkCount === 0) {
    const codes = [
      ['NORMAL', '정상', 1],
      ['DAMAGED', '파손', 2],
      ['OPENED', '개봉됨', 3],
      ['ETC', '기타', 4],
    ];
    const ins = db.prepare(`INSERT INTO common_codes (group_code, code, label, sort_order) VALUES ('PACKAGE_STATUS', ?, ?, ?)`);
    for (const [code, label, order] of codes) ins.run(code, label, order);
  }

  const storeCount = db.prepare('SELECT COUNT(*) c FROM stores').get().c;
  if (storeCount === 0) {
    const ins = db.prepare('INSERT INTO stores (store_code, store_name) VALUES (?,?)');
    ins.run('ST001', '본원 급식소');
    ins.run('ST002', '분원 급식소');
    console.log('[seed] 샘플 매장 2건 생성');
  }
}

seed();

module.exports = { db, hashPassword, verifyPassword };
