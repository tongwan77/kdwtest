const { Pool } = require('pg');
const crypto = require('crypto');

// Vercel에서 Postgres/Neon DB를 프로젝트에 연결(Storage 탭 → Connect Project)하면
// 아래 환경변수 중 하나가 자동으로 주입됩니다. 로컬에서 돌릴 때는 .env 파일이나
// 셸 환경변수로 POSTGRES_URL(또는 DATABASE_URL)을 직접 설정해주세요.
const connectionString =
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

if (!connectionString) {
  console.warn('[db] POSTGRES_URL / DATABASE_URL 환경변수가 없습니다. Vercel 프로젝트 Storage 탭에서 DB 연결 상태를 확인하세요.');
}

// 서버리스(Vercel) 환경에서는 커넥션 풀을 모듈 스코프에 한 번만 만들고,
// warm invocation 사이에 재사용합니다. Neon의 "Pooled connection" 문자열(PgBouncer 경유) 사용을 권장합니다.
const pool = new Pool({
  connectionString,
  ssl: connectionString && connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  console.error('[db] 유휴 커넥션에서 예기치 않은 오류:', err.message);
});

// ---------- '?' 플레이스홀더를 Postgres의 $1,$2... 형식으로 자동 변환 ----------
function toPgSql(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function all(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows;
}
async function get(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return res.rows[0] || null;
}
// INSERT 시 새 id를 돌려받으려면 SQL 끝에 RETURNING id 를 붙여주세요.
async function run(sql, params = []) {
  const res = await pool.query(toPgSql(sql), params);
  return {
    rowCount: res.rowCount,
    changes: res.rowCount,
    rows: res.rows,
    lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined,
  };
}

const db = { all, get, run, pool };

// ---------- 스키마 ----------
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','NUTRITIONIST')),
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_reset INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stores (
  id SERIAL PRIMARY KEY,
  store_code TEXT UNIQUE NOT NULL,
  store_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_stores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  UNIQUE(user_id, store_id)
);

CREATE TABLE IF NOT EXISTS common_codes (
  id SERIAL PRIMARY KEY,
  group_code TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_code, code)
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_code TEXT NOT NULL,
  item_name TEXT NOT NULL,
  large_category TEXT,
  mid_category TEXT,
  small_category TEXT,
  spec TEXT,
  purchase_unit TEXT,
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','API')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, item_code, item_name)
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  vendor_code TEXT UNIQUE NOT NULL,
  vendor_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source IN ('MANUAL','API')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS initial_stock (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  quantity REAL NOT NULL DEFAULT 0,
  set_by INTEGER REFERENCES users(id),
  set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(store_id, item_id)
);

-- 날짜 컬럼은 프론트엔드(<input type="date">)와의 포맷 일치를 위해 TEXT('YYYY-MM-DD')로 저장합니다.
CREATE TABLE IF NOT EXISTS inbound (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS outbound (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  outbound_date TEXT NOT NULL,
  quantity REAL NOT NULL,
  supply_price REAL NOT NULL DEFAULT 0,
  vat REAL NOT NULL DEFAULT 0,
  memo TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS io_logs (
  id SERIAL PRIMARY KEY,
  io_type TEXT NOT NULL CHECK(io_type IN ('INBOUND','OUTBOUND')),
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','DELETE')),
  target_id INTEGER NOT NULL,
  store_id INTEGER,
  item_id INTEGER,
  detail TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL CHECK(action IN ('LOGIN_SUCCESS','LOGIN_FAIL','LOGOUT')),
  ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DONE')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id)
);
`;

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

// ---------- 초기화(스키마 생성 + 시드) ----------
// 서버리스 환경에서는 매 콜드스타트마다 호출될 수 있으므로 멱등하게 작성되어 있습니다.
// 같은 warm 컨테이너 안에서는 한 번만 실행되도록 캐시합니다.
let initPromise = null;
async function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      await pool.query(SCHEMA_SQL);
      await seed();
    })().catch((err) => {
      initPromise = null; // 실패하면 다음 요청에서 재시도할 수 있도록 캐시 해제
      throw err;
    });
  }
  return initPromise;
}

async function seed() {
  const superAdminCount = await get("SELECT COUNT(*)::int c FROM users WHERE role='SUPER_ADMIN'");
  if (superAdminCount.c === 0) {
    const { hash, salt } = hashPassword('Admin!2024');
    await run(
      `INSERT INTO users (username, password_hash, password_salt, role, name, must_reset) VALUES (?,?,?,?,?,0)`,
      ['admin', hash, salt, 'SUPER_ADMIN', '최고관리자']
    );
    console.log('[seed] 최고관리자 계정 생성: admin / Admin!2024 (반드시 로그인 후 변경 요청 절차를 확인하세요)');
  }

  const qsCount = await get("SELECT COUNT(*)::int c FROM common_codes WHERE group_code='QUALITY_STATUS'");
  if (qsCount.c === 0) {
    const codes = [
      ['GOOD', '양호', 1],
      ['BAD', '불량', 2],
      ['MISSING', '누락', 3],
      ['DAMAGED', '파손', 4],
      ['ETC', '기타', 5],
    ];
    for (const [code, label, order] of codes) {
      await run(`INSERT INTO common_codes (group_code, code, label, sort_order) VALUES ('QUALITY_STATUS', ?, ?, ?)`, [code, label, order]);
    }
  }

  const pkCount = await get("SELECT COUNT(*)::int c FROM common_codes WHERE group_code='PACKAGE_STATUS'");
  if (pkCount.c === 0) {
    const codes = [
      ['NORMAL', '정상', 1],
      ['DAMAGED', '파손', 2],
      ['OPENED', '개봉됨', 3],
      ['ETC', '기타', 4],
    ];
    for (const [code, label, order] of codes) {
      await run(`INSERT INTO common_codes (group_code, code, label, sort_order) VALUES ('PACKAGE_STATUS', ?, ?, ?)`, [code, label, order]);
    }
  }

  const storeCount = await get('SELECT COUNT(*)::int c FROM stores');
  if (storeCount.c === 0) {
    await run('INSERT INTO stores (store_code, store_name) VALUES (?,?)', ['ST001', '본원 급식소']);
    await run('INSERT INTO stores (store_code, store_name) VALUES (?,?)', ['ST002', '분원 급식소']);
    console.log('[seed] 샘플 매장 2건 생성');
  }
}

module.exports = { db, hashPassword, verifyPassword, initDb, pool };
