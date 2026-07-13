const { db, hashPassword } = require('./db');
const { getSession, parseCookies, login, logout } = require('./auth');
const { sendJSON, readBody, Router, getIp } = require('./util');

const router = new Router();

// ---------------------------------------------------------------------------
// 공통 헬퍼
// ---------------------------------------------------------------------------
function getUser(req) {
  const cookies = parseCookies(req);
  return getSession(cookies.session);
}

function isAdmin(user) {
  return user && user.role === 'SUPER_ADMIN';
}

function accessibleStoreIds(user) {
  if (isAdmin(user)) {
    return db.prepare('SELECT id FROM stores WHERE is_active = 1').all().map((r) => r.id);
  }
  return db.prepare('SELECT store_id FROM user_stores WHERE user_id = ?').all(user.id).map((r) => r.store_id);
}

function canAccessStore(user, storeId) {
  if (isAdmin(user)) return true;
  const row = db.prepare('SELECT 1 FROM user_stores WHERE user_id = ? AND store_id = ?').get(user.id, storeId);
  return !!row;
}

function requireAuth(req, res) {
  const user = getUser(req);
  if (!user) {
    sendJSON(res, 401, { error: '로그인이 필요합니다.' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!isAdmin(user)) {
    sendJSON(res, 403, { error: '최고관리자만 접근할 수 있습니다.' });
    return null;
  }
  return user;
}

function computeStock(storeId, itemId) {
  const init = db.prepare('SELECT quantity FROM initial_stock WHERE store_id=? AND item_id=?').get(storeId, itemId);
  const inb = db.prepare("SELECT COALESCE(SUM(quantity),0) s FROM inbound WHERE store_id=? AND item_id=? AND is_deleted=0").get(storeId, itemId);
  const outb = db.prepare("SELECT COALESCE(SUM(quantity),0) s FROM outbound WHERE store_id=? AND item_id=? AND is_deleted=0").get(storeId, itemId);
  return (init ? init.quantity : 0) + inb.s - outb.s;
}

function writeIoLog(ioType, action, targetId, storeId, itemId, detail, userId) {
  db.prepare(`INSERT INTO io_logs (io_type, action, target_id, store_id, item_id, detail, user_id)
              VALUES (?,?,?,?,?,?,?)`)
    .run(ioType, action, targetId, storeId, itemId, JSON.stringify(detail || {}), userId);
}

function parseQuery(req) {
  const u = new URL(req.url, 'http://localhost');
  return Object.fromEntries(u.searchParams.entries());
}

// ---------------------------------------------------------------------------
// 인증
// ---------------------------------------------------------------------------
router.post('/api/auth/login', async (req, res) => {
  const body = await readBody(req);
  const { username, password } = body;
  if (!username || !password) return sendJSON(res, 400, { error: '아이디와 비밀번호를 입력하세요.' });
  const result = login(username, password, getIp(req));
  if (!result) return sendJSON(res, 401, { error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  res.setHeader('Set-Cookie', `session=${result.token}; HttpOnly; Path=/; Max-Age=${8 * 3600}; SameSite=Lax`);
  sendJSON(res, 200, { user: result.user });
});

router.post('/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req);
  const user = getUser(req);
  logout(cookies.session, user, getIp(req));
  res.setHeader('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0');
  sendJSON(res, 200, { ok: true });
});

router.get('/api/auth/me', async (req, res) => {
  const user = getUser(req);
  if (!user) return sendJSON(res, 401, { error: 'not logged in' });
  sendJSON(res, 200, { user });
});

// 영양사 본인 비밀번호 초기화 요청 (본인은 직접 변경 불가 - 관리자에게 요청만 가능)
router.post('/api/password-reset-requests', async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const exists = db.prepare("SELECT id FROM password_reset_requests WHERE user_id=? AND status='PENDING'").get(user.id);
  if (exists) return sendJSON(res, 200, { ok: true, message: '이미 처리 대기 중인 요청이 있습니다.' });
  db.prepare('INSERT INTO password_reset_requests (user_id) VALUES (?)').run(user.id);
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 관리자: 영양사 계정 관리
// ---------------------------------------------------------------------------
router.get('/api/admin/nutritionists', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const rows = db.prepare("SELECT id, username, name, is_active, created_at FROM users WHERE role='NUTRITIONIST' ORDER BY id DESC").all();
  const withStores = rows.map((r) => {
    const stores = db.prepare(`SELECT s.id, s.store_code, s.store_name FROM user_stores us
                                JOIN stores s ON s.id = us.store_id WHERE us.user_id = ?`).all(r.id);
    return { ...r, stores };
  });
  sendJSON(res, 200, { items: withStores });
});

router.post('/api/admin/nutritionists', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  const { username, name, password, store_ids } = body;
  if (!username || !name || !password) return sendJSON(res, 400, { error: '아이디, 이름, 초기 비밀번호는 필수입니다.' });
  const dup = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (dup) return sendJSON(res, 400, { error: '이미 사용 중인 아이디입니다.' });
  const { hash, salt } = hashPassword(password);
  const info = db.prepare(`INSERT INTO users (username, password_hash, password_salt, role, name) VALUES (?,?,?,'NUTRITIONIST',?)`)
    .run(username, hash, salt, name);
  const userId = info.lastInsertRowid;
  if (Array.isArray(store_ids)) {
    const ins = db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?,?)');
    for (const sid of store_ids) ins.run(userId, sid);
  }
  sendJSON(res, 201, { id: userId });
});

router.put('/api/admin/nutritionists/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='NUTRITIONIST'").get(id);
  if (!existing) return sendJSON(res, 404, { error: '대상 영양사를 찾을 수 없습니다.' });
  const name = body.name !== undefined ? body.name : existing.name;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;
  db.prepare("UPDATE users SET name=?, is_active=?, updated_at=datetime('now') WHERE id=?").run(name, isActive, id);
  if (Array.isArray(body.store_ids)) {
    db.prepare('DELETE FROM user_stores WHERE user_id=?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?,?)');
    for (const sid of body.store_ids) ins.run(id, sid);
  }
  sendJSON(res, 200, { ok: true });
});

router.delete('/api/admin/nutritionists/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const id = Number(params.id);
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='NUTRITIONIST'").get(id);
  if (!existing) return sendJSON(res, 404, { error: '대상 영양사를 찾을 수 없습니다.' });
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  sendJSON(res, 200, { ok: true });
});

// 관리자가 영양사 비밀번호 재발급
router.post('/api/admin/nutritionists/:id/reset-password', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='NUTRITIONIST'").get(id);
  if (!existing) return sendJSON(res, 404, { error: '대상 영양사를 찾을 수 없습니다.' });
  if (!body.new_password || body.new_password.length < 6) return sendJSON(res, 400, { error: '새 비밀번호는 6자 이상이어야 합니다.' });
  const { hash, salt } = hashPassword(body.new_password);
  db.prepare("UPDATE users SET password_hash=?, password_salt=?, updated_at=datetime('now') WHERE id=?").run(hash, salt, id);
  db.prepare("UPDATE password_reset_requests SET status='DONE', resolved_at=datetime('now'), resolved_by=? WHERE user_id=? AND status='PENDING'")
    .run(admin.id, id);
  sendJSON(res, 200, { ok: true });
});

router.get('/api/admin/password-reset-requests', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const rows = db.prepare(`SELECT p.id, p.status, p.requested_at, p.resolved_at, u.id as user_id, u.username, u.name
                            FROM password_reset_requests p JOIN users u ON u.id = p.user_id
                            ORDER BY p.requested_at DESC`).all();
  sendJSON(res, 200, { items: rows });
});

// ---------------------------------------------------------------------------
// 관리자: 매장(공통코드) 관리
// ---------------------------------------------------------------------------
router.get('/api/admin/stores', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  sendJSON(res, 200, { items: db.prepare('SELECT * FROM stores ORDER BY id').all() });
});
router.post('/api/admin/stores', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  if (!body.store_code || !body.store_name) return sendJSON(res, 400, { error: '매장코드와 매장명은 필수입니다.' });
  try {
    const info = db.prepare('INSERT INTO stores (store_code, store_name) VALUES (?,?)').run(body.store_code, body.store_name);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  } catch (e) {
    sendJSON(res, 400, { error: '이미 존재하는 매장코드입니다.' });
  }
});
router.put('/api/admin/stores/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM stores WHERE id=?').get(id);
  if (!existing) return sendJSON(res, 404, { error: '매장을 찾을 수 없습니다.' });
  db.prepare('UPDATE stores SET store_code=?, store_name=?, is_active=? WHERE id=?').run(
    body.store_code ?? existing.store_code,
    body.store_name ?? existing.store_name,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
    id
  );
  sendJSON(res, 200, { ok: true });
});
router.delete('/api/admin/stores/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  db.prepare('UPDATE stores SET is_active=0 WHERE id=?').run(Number(params.id));
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 관리자: 공통코드 (품질상태, 포장상태 등)
// ---------------------------------------------------------------------------
router.get('/api/admin/common-codes', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const q = parseQuery(req);
  const rows = q.group
    ? db.prepare('SELECT * FROM common_codes WHERE group_code=? ORDER BY sort_order').all(q.group)
    : db.prepare('SELECT * FROM common_codes ORDER BY group_code, sort_order').all();
  sendJSON(res, 200, { items: rows });
});
router.post('/api/admin/common-codes', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  if (!body.group_code || !body.code || !body.label) return sendJSON(res, 400, { error: '그룹코드, 코드, 라벨은 필수입니다.' });
  try {
    const info = db.prepare('INSERT INTO common_codes (group_code, code, label, sort_order) VALUES (?,?,?,?)')
      .run(body.group_code, body.code, body.label, body.sort_order || 0);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  } catch (e) {
    sendJSON(res, 400, { error: '이미 존재하는 코드입니다.' });
  }
});
router.put('/api/admin/common-codes/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const body = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM common_codes WHERE id=?').get(id);
  if (!existing) return sendJSON(res, 404, { error: '코드를 찾을 수 없습니다.' });
  db.prepare('UPDATE common_codes SET label=?, sort_order=?, is_active=? WHERE id=?').run(
    body.label ?? existing.label,
    body.sort_order !== undefined ? body.sort_order : existing.sort_order,
    body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active,
    id
  );
  sendJSON(res, 200, { ok: true });
});
router.delete('/api/admin/common-codes/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  db.prepare('UPDATE common_codes SET is_active=0 WHERE id=?').run(Number(params.id));
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 품목 마스터 (관리자 등록 + 외부 API 연동 확장)
// ---------------------------------------------------------------------------
router.get('/api/admin/items', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  sendJSON(res, 200, { items: db.prepare('SELECT * FROM items ORDER BY id DESC').all() });
});
router.post('/api/admin/items', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const b = await readBody(req);
  if (!b.item_code || !b.item_name) return sendJSON(res, 400, { error: '품명코드와 품명은 필수입니다.' });
  try {
    const info = db.prepare(`INSERT INTO items (item_code, item_name, large_category, mid_category, small_category, spec, purchase_unit, source)
                              VALUES (?,?,?,?,?,?,?,'MANUAL')`)
      .run(b.item_code, b.item_name, b.large_category || null, b.mid_category || null, b.small_category || null, b.spec || null, b.purchase_unit || null);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  } catch (e) {
    sendJSON(res, 400, { error: '이미 존재하는 품명코드입니다.' });
  }
});
router.put('/api/admin/items/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const b = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id=?').get(id);
  if (!existing) return sendJSON(res, 404, { error: '품목을 찾을 수 없습니다.' });
  db.prepare(`UPDATE items SET item_name=?, large_category=?, mid_category=?, small_category=?, spec=?, purchase_unit=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      b.item_name ?? existing.item_name,
      b.large_category ?? existing.large_category,
      b.mid_category ?? existing.mid_category,
      b.small_category ?? existing.small_category,
      b.spec ?? existing.spec,
      b.purchase_unit ?? existing.purchase_unit,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
      id
    );
  sendJSON(res, 200, { ok: true });
});
router.delete('/api/admin/items/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  db.prepare('UPDATE items SET is_active=0 WHERE id=?').run(Number(params.id));
  sendJSON(res, 200, { ok: true });
});

// 외부 시스템 연동용 인터페이스 (확장 포인트) - 품목: 품명, 품명코드, 대/중/소분류, 규격, 구매단위
// 실제 운영시 별도 API-KEY 인증 미들웨어를 추가해 확장 가능
router.post('/api/integration/items', async (req, res) => {
  const b = await readBody(req);
  const list = Array.isArray(b.items) ? b.items : [b];
  const upsert = db.prepare(`INSERT INTO items (item_code, item_name, large_category, mid_category, small_category, spec, purchase_unit, source)
                              VALUES (?,?,?,?,?,?,?,'API')
                              ON CONFLICT(item_code) DO UPDATE SET
                                item_name=excluded.item_name, large_category=excluded.large_category,
                                mid_category=excluded.mid_category, small_category=excluded.small_category,
                                spec=excluded.spec, purchase_unit=excluded.purchase_unit,
                                source='API', updated_at=datetime('now')`);
  let count = 0;
  for (const it of list) {
    if (!it.item_code || !it.item_name) continue;
    upsert.run(it.item_code, it.item_name, it.large_category || null, it.mid_category || null, it.small_category || null, it.spec || null, it.purchase_unit || null);
    count++;
  }
  sendJSON(res, 200, { ok: true, processed: count });
});

// ---------------------------------------------------------------------------
// 거래처 마스터 (관리자 등록 + 외부 API 연동 확장)
// ---------------------------------------------------------------------------
router.get('/api/admin/vendors', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  sendJSON(res, 200, { items: db.prepare('SELECT * FROM vendors ORDER BY id DESC').all() });
});
router.post('/api/admin/vendors', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const b = await readBody(req);
  if (!b.vendor_code || !b.vendor_name) return sendJSON(res, 400, { error: '거래처코드와 거래처명은 필수입니다.' });
  try {
    const info = db.prepare(`INSERT INTO vendors (vendor_code, vendor_name, source) VALUES (?,?,'MANUAL')`).run(b.vendor_code, b.vendor_name);
    sendJSON(res, 201, { id: info.lastInsertRowid });
  } catch (e) {
    sendJSON(res, 400, { error: '이미 존재하는 거래처코드입니다.' });
  }
});
router.put('/api/admin/vendors/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const b = await readBody(req);
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM vendors WHERE id=?').get(id);
  if (!existing) return sendJSON(res, 404, { error: '거래처를 찾을 수 없습니다.' });
  db.prepare(`UPDATE vendors SET vendor_name=?, is_active=?, updated_at=datetime('now') WHERE id=?`).run(
    b.vendor_name ?? existing.vendor_name,
    b.is_active !== undefined ? (b.is_active ? 1 : 0) : existing.is_active,
    id
  );
  sendJSON(res, 200, { ok: true });
});
router.delete('/api/admin/vendors/:id', async (req, res, params) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  db.prepare('UPDATE vendors SET is_active=0 WHERE id=?').run(Number(params.id));
  sendJSON(res, 200, { ok: true });
});

router.post('/api/integration/vendors', async (req, res) => {
  const b = await readBody(req);
  const list = Array.isArray(b.vendors) ? b.vendors : [b];
  const upsert = db.prepare(`INSERT INTO vendors (vendor_code, vendor_name, source) VALUES (?,?,'API')
                              ON CONFLICT(vendor_code) DO UPDATE SET vendor_name=excluded.vendor_name, source='API', updated_at=datetime('now')`);
  let count = 0;
  for (const v of list) {
    if (!v.vendor_code || !v.vendor_name) continue;
    upsert.run(v.vendor_code, v.vendor_name);
    count++;
  }
  sendJSON(res, 200, { ok: true, processed: count });
});

// ---------------------------------------------------------------------------
// 기초재고 (관리자 등록, 기본값 0)
// ---------------------------------------------------------------------------
router.get('/api/admin/initial-stock', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const q = parseQuery(req);
  let sql = `SELECT i.id, i.store_id, s.store_name, i.item_id, it.item_code, it.item_name, i.quantity, i.set_at
             FROM initial_stock i JOIN stores s ON s.id=i.store_id JOIN items it ON it.id=i.item_id WHERE 1=1`;
  const args = [];
  if (q.store_id) { sql += ' AND i.store_id=?'; args.push(q.store_id); }
  sql += ' ORDER BY i.set_at DESC';
  sendJSON(res, 200, { items: db.prepare(sql).all(...args) });
});
router.post('/api/admin/initial-stock', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const b = await readBody(req);
  if (!b.store_id || !b.item_id || b.quantity === undefined) return sendJSON(res, 400, { error: '매장, 품목, 수량은 필수입니다.' });
  db.prepare(`INSERT INTO initial_stock (store_id, item_id, quantity, set_by) VALUES (?,?,?,?)
              ON CONFLICT(store_id, item_id) DO UPDATE SET quantity=excluded.quantity, set_by=excluded.set_by, set_at=datetime('now')`)
    .run(b.store_id, b.item_id, b.quantity, admin.id);
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 공통 조회 (로그인한 모든 사용자) - 매장/품목/거래처/공통코드 드롭다운용
// ---------------------------------------------------------------------------
router.get('/api/stores', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const ids = accessibleStoreIds(user);
  if (ids.length === 0) return sendJSON(res, 200, { items: [] });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM stores WHERE id IN (${placeholders}) AND is_active=1 ORDER BY store_code`).all(...ids);
  sendJSON(res, 200, { items: rows });
});
router.get('/api/items', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  sendJSON(res, 200, { items: db.prepare('SELECT * FROM items WHERE is_active=1 ORDER BY item_name').all() });
});
router.get('/api/vendors', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  sendJSON(res, 200, { items: db.prepare('SELECT * FROM vendors WHERE is_active=1 ORDER BY vendor_name').all() });
});
router.get('/api/common-codes', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const q = parseQuery(req);
  const rows = q.group
    ? db.prepare('SELECT * FROM common_codes WHERE group_code=? AND is_active=1 ORDER BY sort_order').all(q.group)
    : db.prepare('SELECT * FROM common_codes WHERE is_active=1 ORDER BY group_code, sort_order').all();
  sendJSON(res, 200, { items: rows });
});

// ---------------------------------------------------------------------------
// 입고관리
// ---------------------------------------------------------------------------
function buildIoFilterSQL(base, q, args) {
  let sql = base;
  if (q.store_id) { sql += ' AND t.store_id=?'; args.push(q.store_id); }
  if (q.item_id) { sql += ' AND t.item_id=?'; args.push(q.item_id); }
  if (q.date_from) { sql += ' AND t.date_col >= ?'; args.push(q.date_from); }
  if (q.date_to) { sql += ' AND t.date_col <= ?'; args.push(q.date_to); }
  if (q.keyword) { sql += ' AND (it.item_name LIKE ? OR it.item_code LIKE ?)'; args.push(`%${q.keyword}%`, `%${q.keyword}%`); }
  return sql;
}

router.get('/api/inbound', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const q = parseQuery(req);
  const args = [];
  let sql = `SELECT t.id, t.store_id, s.store_name, t.item_id, it.item_code, it.item_name, t.vendor_id, v.vendor_name,
             t.inbound_date as date_col, t.quantity, t.supply_price, t.vat, t.expiry_date, t.inbound_temp,
             t.package_status, t.quality_status, t.memo, t.created_at, t.updated_at
             FROM inbound t
             JOIN stores s ON s.id=t.store_id JOIN items it ON it.id=t.item_id JOIN vendors v ON v.id=t.vendor_id
             WHERE t.is_deleted=0`;
  sql = buildIoFilterSQL(sql, q, args);
  if (q.vendor_id) { sql += ' AND t.vendor_id=?'; args.push(q.vendor_id); }
  if (q.quality_status) { sql += ' AND t.quality_status=?'; args.push(q.quality_status); }
  const storeIds = accessibleStoreIds(user);
  if (storeIds.length === 0) return sendJSON(res, 200, { items: [] });
  sql += ` AND t.store_id IN (${storeIds.map(() => '?').join(',')})`;
  args.push(...storeIds);
  sql += ' ORDER BY t.inbound_date DESC, t.id DESC';
  const rows = db.prepare(sql).all(...args).map((r) => ({ ...r, inbound_date: r.date_col }));
  sendJSON(res, 200, { items: rows });
});

router.post('/api/inbound', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const b = await readBody(req);
  const required = ['store_id', 'item_id', 'vendor_id', 'inbound_date', 'quantity'];
  for (const f of required) if (b[f] === undefined || b[f] === '') return sendJSON(res, 400, { error: `${f} 값은 필수입니다.` });
  if (!canAccessStore(user, b.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  const supplyPrice = Number(b.supply_price) || 0;
  const vat = b.vat !== undefined && b.vat !== '' ? Number(b.vat) : Math.round(supplyPrice * 0.1);
  const info = db.prepare(`INSERT INTO inbound (store_id, item_id, vendor_id, inbound_date, quantity, supply_price, vat,
                            expiry_date, inbound_temp, package_status, quality_status, memo, created_by)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(b.store_id, b.item_id, b.vendor_id, b.inbound_date, Number(b.quantity), supplyPrice, vat,
      b.expiry_date || null, b.inbound_temp || null, b.package_status || null, b.quality_status || null, b.memo || null, user.id);
  writeIoLog('INBOUND', 'CREATE', info.lastInsertRowid, b.store_id, b.item_id, { after: b }, user.id);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

router.put('/api/inbound/:id', async (req, res, params) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM inbound WHERE id=? AND is_deleted=0').get(id);
  if (!existing) return sendJSON(res, 404, { error: '입고 내역을 찾을 수 없습니다.' });
  if (!canAccessStore(user, existing.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  const b = await readBody(req);
  const newQty = b.quantity !== undefined ? Number(b.quantity) : existing.quantity;
  // 재고 무결성 체크: 이 입고 건을 제외하고 새 수량 반영 시 재고가 음수가 되면 거부
  const currentStock = computeStock(existing.store_id, existing.item_id);
  const stockWithoutThis = currentStock - existing.quantity;
  if (stockWithoutThis + newQty < 0) {
    return sendJSON(res, 400, { error: '이미 출고된 수량보다 적게 수정할 수 없습니다. (재고가 음수가 됩니다)' });
  }
  const supplyPrice = b.supply_price !== undefined ? Number(b.supply_price) : existing.supply_price;
  const vat = b.vat !== undefined && b.vat !== '' ? Number(b.vat) : Math.round(supplyPrice * 0.1);
  db.prepare(`UPDATE inbound SET vendor_id=?, inbound_date=?, quantity=?, supply_price=?, vat=?, expiry_date=?,
              inbound_temp=?, package_status=?, quality_status=?, memo=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      b.vendor_id ?? existing.vendor_id, b.inbound_date ?? existing.inbound_date, newQty, supplyPrice, vat,
      b.expiry_date ?? existing.expiry_date, b.inbound_temp ?? existing.inbound_temp,
      b.package_status ?? existing.package_status, b.quality_status ?? existing.quality_status,
      b.memo ?? existing.memo, id
    );
  writeIoLog('INBOUND', 'UPDATE', id, existing.store_id, existing.item_id, { before: existing, after: b }, user.id);
  sendJSON(res, 200, { ok: true });
});

router.delete('/api/inbound/:id', async (req, res, params) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM inbound WHERE id=? AND is_deleted=0').get(id);
  if (!existing) return sendJSON(res, 404, { error: '입고 내역을 찾을 수 없습니다.' });
  if (!canAccessStore(user, existing.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  const currentStock = computeStock(existing.store_id, existing.item_id);
  if (currentStock - existing.quantity < 0) {
    return sendJSON(res, 400, { error: '이미 출고된 수량이 있어 삭제할 수 없습니다. (재고가 음수가 됩니다)' });
  }
  db.prepare('UPDATE inbound SET is_deleted=1, updated_at=datetime(\'now\') WHERE id=?').run(id);
  writeIoLog('INBOUND', 'DELETE', id, existing.store_id, existing.item_id, { before: existing }, user.id);
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 출고관리
// ---------------------------------------------------------------------------
router.get('/api/outbound', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const q = parseQuery(req);
  const args = [];
  let sql = `SELECT t.id, t.store_id, s.store_name, t.item_id, it.item_code, it.item_name,
             t.outbound_date as date_col, t.quantity, t.supply_price, t.vat, t.memo, t.created_at, t.updated_at
             FROM outbound t JOIN stores s ON s.id=t.store_id JOIN items it ON it.id=t.item_id
             WHERE t.is_deleted=0`;
  sql = buildIoFilterSQL(sql, q, args);
  const storeIds = accessibleStoreIds(user);
  if (storeIds.length === 0) return sendJSON(res, 200, { items: [] });
  sql += ` AND t.store_id IN (${storeIds.map(() => '?').join(',')})`;
  args.push(...storeIds);
  sql += ' ORDER BY t.outbound_date DESC, t.id DESC';
  const rows = db.prepare(sql).all(...args).map((r) => ({ ...r, outbound_date: r.date_col }));
  sendJSON(res, 200, { items: rows });
});

router.post('/api/outbound', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const b = await readBody(req);
  const required = ['store_id', 'item_id', 'outbound_date', 'quantity'];
  for (const f of required) if (b[f] === undefined || b[f] === '') return sendJSON(res, 400, { error: `${f} 값은 필수입니다.` });
  if (!canAccessStore(user, b.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  const qty = Number(b.quantity);
  if (qty <= 0) return sendJSON(res, 400, { error: '수량은 0보다 커야 합니다.' });
  const currentStock = computeStock(b.store_id, b.item_id);
  if (qty > currentStock) {
    return sendJSON(res, 400, { error: `현재 재고(${currentStock})를 초과하여 출고할 수 없습니다.` });
  }
  const supplyPrice = Number(b.supply_price) || 0;
  const vat = b.vat !== undefined && b.vat !== '' ? Number(b.vat) : Math.round(supplyPrice * 0.1);
  const info = db.prepare(`INSERT INTO outbound (store_id, item_id, outbound_date, quantity, supply_price, vat, memo, created_by)
                            VALUES (?,?,?,?,?,?,?,?)`)
    .run(b.store_id, b.item_id, b.outbound_date, qty, supplyPrice, vat, b.memo || null, user.id);
  writeIoLog('OUTBOUND', 'CREATE', info.lastInsertRowid, b.store_id, b.item_id, { after: b }, user.id);
  sendJSON(res, 201, { id: info.lastInsertRowid });
});

router.put('/api/outbound/:id', async (req, res, params) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM outbound WHERE id=? AND is_deleted=0').get(id);
  if (!existing) return sendJSON(res, 404, { error: '출고 내역을 찾을 수 없습니다.' });
  if (!canAccessStore(user, existing.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  const b = await readBody(req);
  const newQty = b.quantity !== undefined ? Number(b.quantity) : existing.quantity;
  if (newQty <= 0) return sendJSON(res, 400, { error: '수량은 0보다 커야 합니다.' });
  const currentStock = computeStock(existing.store_id, existing.item_id);
  const stockWithoutThis = currentStock + existing.quantity; // 이 출고건 효과 제거
  if (newQty > stockWithoutThis) {
    return sendJSON(res, 400, { error: `현재 재고(${stockWithoutThis})를 초과하여 출고할 수 없습니다.` });
  }
  const supplyPrice = b.supply_price !== undefined ? Number(b.supply_price) : existing.supply_price;
  const vat = b.vat !== undefined && b.vat !== '' ? Number(b.vat) : Math.round(supplyPrice * 0.1);
  db.prepare(`UPDATE outbound SET outbound_date=?, quantity=?, supply_price=?, vat=?, memo=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.outbound_date ?? existing.outbound_date, newQty, supplyPrice, vat, b.memo ?? existing.memo, id);
  writeIoLog('OUTBOUND', 'UPDATE', id, existing.store_id, existing.item_id, { before: existing, after: b }, user.id);
  sendJSON(res, 200, { ok: true });
});

router.delete('/api/outbound/:id', async (req, res, params) => {
  const user = requireAuth(req, res); if (!user) return;
  const id = Number(params.id);
  const existing = db.prepare('SELECT * FROM outbound WHERE id=? AND is_deleted=0').get(id);
  if (!existing) return sendJSON(res, 404, { error: '출고 내역을 찾을 수 없습니다.' });
  if (!canAccessStore(user, existing.store_id)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  db.prepare('UPDATE outbound SET is_deleted=1, updated_at=datetime(\'now\') WHERE id=?').run(id);
  writeIoLog('OUTBOUND', 'DELETE', id, existing.store_id, existing.item_id, { before: existing }, user.id);
  sendJSON(res, 200, { ok: true });
});

// ---------------------------------------------------------------------------
// 재고관리 (조회 전용, 입출고 내역 기반 산출)
// ---------------------------------------------------------------------------
router.get('/api/inventory', async (req, res) => {
  const user = requireAuth(req, res); if (!user) return;
  const q = parseQuery(req);
  const storeIds = accessibleStoreIds(user);
  if (storeIds.length === 0) return sendJSON(res, 200, { items: [] });
  const targetStoreIds = q.store_id ? [Number(q.store_id)] : storeIds;
  for (const sid of targetStoreIds) {
    if (!storeIds.includes(sid)) return sendJSON(res, 403, { error: '담당 매장이 아닙니다.' });
  }
  const placeholders = targetStoreIds.map(() => '?').join(',');
  let itemSql = 'SELECT * FROM items WHERE is_active=1';
  const itemArgs = [];
  if (q.keyword) { itemSql += ' AND (item_name LIKE ? OR item_code LIKE ?)'; itemArgs.push(`%${q.keyword}%`, `%${q.keyword}%`); }
  if (q.item_id) { itemSql += ' AND id=?'; itemArgs.push(q.item_id); }
  const items = db.prepare(itemSql).all(...itemArgs);

  const result = [];
  for (const sid of targetStoreIds) {
    const store = db.prepare('SELECT * FROM stores WHERE id=?').get(sid);
    if (!store) continue;
    for (const it of items) {
      const init = db.prepare('SELECT quantity FROM initial_stock WHERE store_id=? AND item_id=?').get(sid, it.id);
      const inb = db.prepare("SELECT COALESCE(SUM(quantity),0) s FROM inbound WHERE store_id=? AND item_id=? AND is_deleted=0").get(sid, it.id);
      const outb = db.prepare("SELECT COALESCE(SUM(quantity),0) s FROM outbound WHERE store_id=? AND item_id=? AND is_deleted=0").get(sid, it.id);
      const initQty = init ? init.quantity : 0;
      const stock = initQty + inb.s - outb.s;
      if (q.hide_zero === '1' && stock === 0 && initQty === 0 && inb.s === 0 && outb.s === 0) continue;
      result.push({
        store_id: sid, store_name: store.store_name,
        item_id: it.id, item_code: it.item_code, item_name: it.item_name, purchase_unit: it.purchase_unit,
        initial_quantity: initQty, inbound_total: inb.s, outbound_total: outb.s, current_stock: stock,
      });
    }
  }
  sendJSON(res, 200, { items: result });
});

// ---------------------------------------------------------------------------
// 관리자: 로그 조회 (입출고 작업로그 / 로그인로그)
// ---------------------------------------------------------------------------
router.get('/api/admin/io-logs', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const q = parseQuery(req);
  let sql = `SELECT l.*, s.store_name, it.item_name, it.item_code, u.name as user_name, u.username
             FROM io_logs l LEFT JOIN stores s ON s.id=l.store_id LEFT JOIN items it ON it.id=l.item_id
             LEFT JOIN users u ON u.id = l.user_id WHERE 1=1`;
  const args = [];
  if (q.io_type) { sql += ' AND l.io_type=?'; args.push(q.io_type); }
  if (q.action) { sql += ' AND l.action=?'; args.push(q.action); }
  if (q.store_id) { sql += ' AND l.store_id=?'; args.push(q.store_id); }
  if (q.date_from) { sql += ' AND date(l.created_at) >= date(?)'; args.push(q.date_from); }
  if (q.date_to) { sql += ' AND date(l.created_at) <= date(?)'; args.push(q.date_to); }
  sql += ' ORDER BY l.created_at DESC LIMIT 500';
  sendJSON(res, 200, { items: db.prepare(sql).all(...args) });
});

router.get('/api/admin/auth-logs', async (req, res) => {
  const admin = requireAdmin(req, res); if (!admin) return;
  const rows = db.prepare('SELECT * FROM auth_logs ORDER BY created_at DESC LIMIT 500').all();
  sendJSON(res, 200, { items: rows });
});

module.exports = { router, getUser };
