/* ============================================================
   급식소 식자재 재고관리 시스템 - Frontend SPA (Vanilla JS)
   ============================================================ */

const S = {
  user: null,
  page: null,
  stores: [],          // 접근 가능한 매장 목록
  selectedStoreId: null,
  items: [],
  vendors: [],
  qualityCodes: [],
  packageCodes: [],
  sidebarOpen: false,
};

const $app = document.getElementById('app');

// ---------------------------------------------------------------
// API helper
// ---------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) {
    throw new Error(data.error || `요청 실패 (${res.status})`);
  }
  return data;
}

function toast(msg, type = 'default') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtNum(n) {
  if (n === null || n === undefined || n === '') return '-';
  return Number(n).toLocaleString('ko-KR');
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------
// Logo mark (signature element: 잎사귀 + 상자 모노그램)
// ---------------------------------------------------------------
const LOGO_SVG = `<svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="16" width="24" height="20" rx="2" fill="#D98A3D" opacity="0.9"/>
  <path d="M4 22h24" stroke="#14493D" stroke-width="1.4" opacity="0.5"/>
  <path d="M24 6c6 0 10 4 10 10-6 0-10-4-10-10Z" fill="#1F6F5C"/>
  <path d="M24 6c-2 5-2 8 0 10" stroke="#EAF3F0" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

// ---------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------
async function boot() {
  try {
    const { user } = await api('/api/auth/me');
    S.user = user;
    await loadCommonData();
    renderShell();
  } catch (e) {
    renderLogin();
  }
}

async function loadCommonData() {
  const [stores, vendors, qc, pc] = await Promise.all([
    api('/api/stores'),
    api('/api/vendors'),
    api('/api/common-codes?group=QUALITY_STATUS'),
    api('/api/common-codes?group=PACKAGE_STATUS'),
  ]);
  S.stores = stores.items;
  S.vendors = vendors.items;
  S.qualityCodes = qc.items;
  S.packageCodes = pc.items;
  if (!S.selectedStoreId && S.stores.length) S.selectedStoreId = S.stores[0].id;
}

// 품목은 매장에 종속되므로, 특정 매장의 품목 목록이 필요할 때마다 조회한다.
async function fetchItemsForStore(storeId) {
  if (!storeId) return [];
  const { items } = await api(`/api/items?store_id=${storeId}`);
  return items;
}

// ---------------------------------------------------------------
// 로그인 화면
// ---------------------------------------------------------------
function renderLogin() {
  $app.innerHTML = `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-brand">
        <span class="login-brand-mark">${LOGO_SVG}</span>
        <span class="login-brand-name">급식소 식자재 재고관리</span>
      </div>
      <h1>로그인</h1>
      <p class="login-sub">발급받은 계정으로 로그인해주세요.</p>
      <div id="login-error"></div>
      <form id="login-form">
        <div class="field">
          <label>아이디</label>
          <input type="text" name="username" autocomplete="username" required />
        </div>
        <div class="field">
          <label>비밀번호</label>
          <input type="password" name="password" autocomplete="current-password" required />
        </div>
        <button type="submit" class="btn btn-primary btn-block">로그인</button>
      </form>
      <div class="login-hint">비밀번호를 분실했나요? 로그인 후 화면 우측 상단 메뉴에서 "비밀번호 재발급 요청"을 보낼 수 있습니다. 계정은 본인이 직접 초기화할 수 없으며, 최고관리자가 처리합니다.</div>
    </div>
  </div>`;

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const { user } = await api('/api/auth/login', { method: 'POST', body: { username: fd.get('username'), password: fd.get('password') } });
      S.user = user;
      await loadCommonData();
      renderShell();
    } catch (err) {
      document.getElementById('login-error').innerHTML = `<div class="login-error">${esc(err.message)}</div>`;
    }
  });
}

// ---------------------------------------------------------------
// 앱 셸 (사이드바 + 상단바 + 컨텐츠)
// ---------------------------------------------------------------
const NAV = {
  SUPER_ADMIN: [
    { section: '계정/조직', items: [
      { key: 'admin-nutritionists', label: '영양사 관리' },
      { key: 'admin-stores', label: '매장 관리' },
      { key: 'admin-pw-requests', label: '비밀번호 재발급 요청함' },
    ]},
    { section: '기준정보', items: [
      { key: 'admin-items', label: '품목 관리' },
      { key: 'admin-vendors', label: '거래처 관리' },
      { key: 'admin-codes', label: '공통코드 관리' },
      { key: 'admin-initial-stock', label: '기초재고 등록' },
    ]},
    { section: '조회/리포트', items: [
      { key: 'inventory', label: '재고 조회' },
      { key: 'inbound', label: '입고 조회' },
      { key: 'outbound', label: '출고 조회' },
      { key: 'admin-io-logs', label: '입출고 작업 로그' },
      { key: 'admin-auth-logs', label: '로그인 로그' },
    ]},
  ],
  NUTRITIONIST: [
    { section: '업무', items: [
      { key: 'inventory', label: '재고관리' },
      { key: 'inbound', label: '입고관리' },
      { key: 'outbound', label: '출고관리' },
    ]},
  ],
};

function defaultPage() {
  return S.user.role === 'SUPER_ADMIN' ? 'admin-nutritionists' : 'inventory';
}

function renderShell() {
  if (!S.page) S.page = defaultPage();
  const nav = NAV[S.user.role];
  const roleLabel = S.user.role === 'SUPER_ADMIN' ? '최고관리자' : '영양사';

  $app.innerHTML = `
  <div class="app-shell">
    <div class="overlay-mask ${S.sidebarOpen ? 'show' : ''}" id="overlay"></div>
    <aside class="sidebar ${S.sidebarOpen ? 'open' : ''}" id="sidebar">
      <div class="sidebar-head">
        <span class="mark">${LOGO_SVG}</span>
        <span class="name">식자재 재고관리</span>
      </div>
      <nav class="sidebar-nav">
        ${nav.map((sec) => `
          <div class="nav-section-label">${esc(sec.section)}</div>
          ${sec.items.map((it) => `
            <button class="nav-item ${S.page === it.key ? 'active' : ''}" data-nav="${it.key}">
              <span class="dot"></span>${esc(it.label)}
            </button>
          `).join('')}
        `).join('')}
      </nav>
      <div class="sidebar-foot">
        <div class="sidebar-user"><b>${esc(S.user.name)}</b><span class="sidebar-role-badge">${roleLabel}</span></div>
        <button class="btn btn-secondary btn-sm btn-block" id="pw-req-btn" style="margin-bottom:6px;">비밀번호 재발급 요청</button>
        <button class="btn btn-ghost btn-sm btn-block" id="logout-btn">로그아웃</button>
      </div>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <button class="hamburger" id="hamburger" aria-label="메뉴"><span></span><span></span><span></span></button>
        <span class="topbar-title" id="page-title"></span>
        <span class="topbar-spacer"></span>
        <div class="store-select-wrap" id="store-select-slot"></div>
      </header>
      <main class="content" id="content"></main>
    </div>
  </div>`;

  document.getElementById('hamburger').addEventListener('click', () => { S.sidebarOpen = true; renderShell(); });
  document.getElementById('overlay').addEventListener('click', () => { S.sidebarOpen = false; renderShell(); });
  document.getElementById('logout-btn').addEventListener('click', doLogout);
  document.getElementById('pw-req-btn').addEventListener('click', requestPasswordReset);
  $app.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
    S.page = b.dataset.nav;
    S.sidebarOpen = false;
    renderShell();
  }));

  renderStoreSelector();
  renderPage();
}

function renderStoreSelector() {
  const slot = document.getElementById('store-select-slot');
  const showsStorePicker = ['inventory', 'inbound', 'outbound'].includes(S.page);
  if (!showsStorePicker || S.stores.length === 0) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <label for="store-select">매장</label>
    <select id="store-select">
      ${S.user.role === 'SUPER_ADMIN' ? `<option value="all" ${S.selectedStoreId === 'all' ? 'selected' : ''}>전체 매장</option>` : ''}
      ${S.stores.map((s) => `<option value="${s.id}" ${String(S.selectedStoreId) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}
    </select>`;
  document.getElementById('store-select').addEventListener('change', (e) => {
    S.selectedStoreId = e.target.value === 'all' ? 'all' : Number(e.target.value);
    renderPage();
  });
}

async function doLogout() {
  await api('/api/auth/logout', { method: 'POST' });
  S.user = null; S.page = null;
  renderLogin();
}

async function requestPasswordReset() {
  try {
    await api('/api/password-reset-requests', { method: 'POST' });
    toast('비밀번호 재발급 요청을 최고관리자에게 전달했습니다.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

const PAGE_TITLES = {
  'admin-nutritionists': '영양사 관리', 'admin-stores': '매장 관리', 'admin-pw-requests': '비밀번호 재발급 요청함',
  'admin-items': '품목 관리', 'admin-vendors': '거래처 관리', 'admin-codes': '공통코드 관리', 'admin-initial-stock': '기초재고 등록',
  'inventory': '재고관리', 'inbound': '입고관리', 'outbound': '출고관리',
  'admin-io-logs': '입출고 작업 로그', 'admin-auth-logs': '로그인 로그',
};

function renderPage() {
  document.getElementById('page-title').textContent = PAGE_TITLES[S.page] || '';
  const c = document.getElementById('content');
  c.innerHTML = '<p style="color:var(--color-text-muted)">불러오는 중...</p>';
  const fns = {
    'admin-nutritionists': pageNutritionists,
    'admin-stores': pageStores,
    'admin-pw-requests': pagePwRequests,
    'admin-items': pageItems,
    'admin-vendors': pageVendors,
    'admin-codes': pageCodes,
    'admin-initial-stock': pageInitialStock,
    'inventory': pageInventory,
    'inbound': pageInbound,
    'outbound': pageOutbound,
    'admin-io-logs': pageIoLogs,
    'admin-auth-logs': pageAuthLogs,
  };
  (fns[S.page] || (() => { c.innerHTML = ''; }))().catch?.((e) => toast(e.message, 'error'));
}

function pageHead(title, desc) {
  return `<div class="page-head"><div><h2>${esc(title)}</h2><p>${esc(desc || '')}</p></div></div>`;
}

// =================================================================
// 관리자: 영양사 관리 (요건 1,2,3,12)
// =================================================================
async function pageNutritionists() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/nutritionists');
  c.innerHTML = `
    ${pageHead('영양사 관리', '최고관리자가 영양사 계정을 발급하고 담당 매장을 지정합니다.')}
    <div class="card">
      <div class="card-head"><h3>영양사 목록 (${items.length}명)</h3>
        <button class="btn btn-primary btn-sm" id="add-nutri-btn">+ 영양사 추가</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>아이디</th><th>이름</th><th>담당 매장</th><th>상태</th><th>등록일</th><th>관리</th></tr></thead>
        <tbody>
          ${items.length === 0 ? `<tr class="empty-row"><td colspan="6">등록된 영양사가 없습니다.</td></tr>` : items.map((n) => `
            <tr>
              <td>${esc(n.username)}</td>
              <td>${esc(n.name)}</td>
              <td>${n.stores.map((s) => `<span class="badge badge-muted">${esc(s.store_name)}</span>`).join(' ') || '-'}</td>
              <td>${n.is_active ? '<span class="badge badge-good">사용</span>' : '<span class="badge badge-bad">중지</span>'}</td>
              <td>${esc((n.created_at || '').slice(0, 10))}</td>
              <td class="row-actions">
                <button class="btn btn-secondary btn-sm" data-edit="${n.id}">수정</button>
                <button class="btn btn-secondary btn-sm" data-reset="${n.id}">비번재발급</button>
                <button class="btn btn-danger btn-sm" data-del="${n.id}">삭제</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>`;

  document.getElementById('add-nutri-btn').addEventListener('click', () => nutritionistModal());
  items.forEach((n) => {
    c.querySelector(`[data-edit="${n.id}"]`)?.addEventListener('click', () => nutritionistModal(n));
    c.querySelector(`[data-reset="${n.id}"]`)?.addEventListener('click', () => resetPasswordModal(n));
    c.querySelector(`[data-del="${n.id}"]`)?.addEventListener('click', () => confirmModal(
      `'${n.name}(${n.username})' 계정을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`,
      async () => { await api(`/api/admin/nutritionists/${n.id}`, { method: 'DELETE' }); toast('삭제되었습니다.', 'success'); pageNutritionists(); }
    ));
  });
}

function nutritionistModal(existing) {
  const isEdit = !!existing;
  const selectedIds = new Set((existing?.stores || []).map((s) => s.id));
  openModal({
    title: isEdit ? '영양사 정보 수정' : '영양사 계정 발급',
    bodyHtml: `
      <div class="form-grid">
        <div class="field"><label>아이디${isEdit ? '' : ' *'}</label><input name="username" value="${esc(existing?.username || '')}" ${isEdit ? 'disabled' : 'required'} /></div>
        <div class="field"><label>이름 *</label><input name="name" value="${esc(existing?.name || '')}" required /></div>
        ${!isEdit ? `<div class="field span-2"><label>초기 비밀번호 *</label><input name="password" type="text" required minlength="6" placeholder="6자 이상" /></div>` : ''}
        ${isEdit ? `<div class="field"><label>계정 상태</label><select name="is_active"><option value="1" ${existing.is_active ? 'selected' : ''}>사용</option><option value="0" ${!existing.is_active ? 'selected' : ''}>중지</option></select></div>` : ''}
        <div class="field span-2"><label>담당 매장 (복수 선택 가능)</label>
          <div style="display:flex; flex-wrap:wrap; gap:8px; padding:10px; border:1px solid var(--color-border); border-radius:6px;">
            ${S.stores.length === 0 ? '<span class="helper-text">먼저 매장을 등록해주세요.</span>' : S.stores.map((s) => `
              <label style="display:flex; align-items:center; gap:5px; font-size:13px; font-weight:400;">
                <input type="checkbox" name="store_ids" value="${s.id}" ${selectedIds.has(s.id) ? 'checked' : ''}/> ${esc(s.store_name)}
              </label>`).join('')}
          </div>
        </div>
      </div>`,
    onSubmit: async (fd, close) => {
      const storeIds = fd.getAll('store_ids').map(Number);
      if (isEdit) {
        await api(`/api/admin/nutritionists/${existing.id}`, { method: 'PUT', body: { name: fd.get('name'), is_active: fd.get('is_active') === '1', store_ids: storeIds } });
      } else {
        await api('/api/admin/nutritionists', { method: 'POST', body: { username: fd.get('username'), name: fd.get('name'), password: fd.get('password'), store_ids: storeIds } });
      }
      toast('저장되었습니다.', 'success'); close(); pageNutritionists();
    },
  });
}

function resetPasswordModal(n) {
  openModal({
    title: `비밀번호 재발급 - ${n.name}(${n.username})`,
    bodyHtml: `<div class="field"><label>새 비밀번호 *</label><input name="new_password" type="text" required minlength="6" placeholder="6자 이상" /></div>
               <p class="helper-text">계정 소유자는 본인이 직접 비밀번호를 변경할 수 없으며, 항상 최고관리자가 재발급합니다.</p>`,
    onSubmit: async (fd, close) => {
      await api(`/api/admin/nutritionists/${n.id}/reset-password`, { method: 'POST', body: { new_password: fd.get('new_password') } });
      toast('비밀번호가 재발급되었습니다.', 'success'); close(); pageNutritionists();
    },
  });
}

// =================================================================
// 관리자: 매장 관리 (요건 13)
// =================================================================
async function pageStores() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/stores');
  c.innerHTML = `
    ${pageHead('매장 관리', '영양사가 담당할 매장 목록(공통코드)을 관리합니다.')}
    <div class="card">
      <div class="card-head"><h3>매장 목록 (${items.length})</h3><button class="btn btn-primary btn-sm" id="add-store-btn">+ 매장 추가</button></div>
      <div class="table-scroll"><table>
        <thead><tr><th>매장코드</th><th>매장명</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>
          ${items.map((s) => `<tr>
            <td>${esc(s.store_code)}</td><td>${esc(s.store_name)}</td>
            <td>${s.is_active ? '<span class="badge badge-good">사용</span>' : '<span class="badge badge-bad">중지</span>'}</td>
            <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${s.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${s.id}">비활성화</button></td>
          </tr>`).join('') || `<tr class="empty-row"><td colspan="4">등록된 매장이 없습니다.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  document.getElementById('add-store-btn').addEventListener('click', () => storeModal());
  items.forEach((s) => {
    c.querySelector(`[data-edit="${s.id}"]`).addEventListener('click', () => storeModal(s));
    c.querySelector(`[data-del="${s.id}"]`).addEventListener('click', () => confirmModal(`'${s.store_name}' 매장을 비활성화하시겠습니까?`, async () => {
      await api(`/api/admin/stores/${s.id}`, { method: 'DELETE' }); toast('처리되었습니다.', 'success'); await loadCommonData(); pageStores();
    }));
  });
}
function storeModal(existing) {
  openModal({
    title: existing ? '매장 정보 수정' : '매장 추가',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>매장코드 *</label><input name="store_code" value="${esc(existing?.store_code || '')}" required /></div>
      <div class="field"><label>매장명 *</label><input name="store_name" value="${esc(existing?.store_name || '')}" required /></div>
      ${existing ? `<div class="field"><label>상태</label><select name="is_active"><option value="1" ${existing.is_active ? 'selected' : ''}>사용</option><option value="0" ${!existing.is_active ? 'selected' : ''}>중지</option></select></div>` : ''}
    </div>`,
    onSubmit: async (fd, close) => {
      const body = { store_code: fd.get('store_code'), store_name: fd.get('store_name') };
      if (existing) { body.is_active = fd.get('is_active') === '1'; await api(`/api/admin/stores/${existing.id}`, { method: 'PUT', body }); }
      else await api('/api/admin/stores', { method: 'POST', body });
      toast('저장되었습니다.', 'success'); close(); await loadCommonData(); pageStores();
    },
  });
}

// =================================================================
// 관리자: 비밀번호 재발급 요청함 (요건 12)
// =================================================================
async function pagePwRequests() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/password-reset-requests');
  c.innerHTML = `
    ${pageHead('비밀번호 재발급 요청함', '영양사가 보낸 재발급 요청을 확인하고 처리합니다.')}
    <div class="card">
      <div class="table-scroll"><table>
        <thead><tr><th>영양사</th><th>요청일시</th><th>상태</th><th>처리일시</th><th>관리</th></tr></thead>
        <tbody>
          ${items.map((r) => `<tr>
            <td>${esc(r.name)} (${esc(r.username)})</td><td>${esc(r.requested_at)}</td>
            <td>${r.status === 'PENDING' ? '<span class="badge badge-warn">대기중</span>' : '<span class="badge badge-good">처리완료</span>'}</td>
            <td>${esc(r.resolved_at || '-')}</td>
            <td>${r.status === 'PENDING' ? `<button class="btn btn-primary btn-sm" data-resolve="${r.user_id}" data-name="${esc(r.name)}" data-username="${esc(r.username)}">비밀번호 재발급</button>` : '-'}</td>
          </tr>`).join('') || `<tr class="empty-row"><td colspan="5">요청 내역이 없습니다.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  c.querySelectorAll('[data-resolve]').forEach((btn) => btn.addEventListener('click', () => {
    resetPasswordModal({ id: btn.dataset.resolve, name: btn.dataset.name, username: btn.dataset.username });
  }));
}
// resolve 후 목록 새로고침을 pw-requests 페이지에서도 동작하도록 보정
const _origResetModal = resetPasswordModal;

// =================================================================
// 관리자: 품목 관리 (요건 3)
// =================================================================
async function pageItems(filterStoreId) {
  const c = document.getElementById('content');
  if (filterStoreId === undefined) filterStoreId = S.adminItemStoreId ?? (S.stores[0]?.id ?? '');
  S.adminItemStoreId = filterStoreId;
  const qs = filterStoreId ? `?store_id=${filterStoreId}` : '';
  const { items } = await api(`/api/admin/items${qs}`);
  c.innerHTML = `
    ${pageHead('품목 관리', '식자재 품목은 매장별로 등록/관리됩니다. 동일한 품명코드라도 매장이 다르면 서로 다른 품목으로 등록할 수 있습니다. 향후 외부 시스템 API 연동(POST /api/integration/items, 매장코드 포함)으로도 자동 등록될 수 있습니다.')}
    <div class="card">
      <div class="card-head">
        <h3>품목 목록 (${items.length})</h3>
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="item-store-filter" style="min-width:160px;">
            <option value="">전체 매장</option>
            ${S.stores.map((s) => `<option value="${s.id}" ${String(filterStoreId) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}
          </select>
          <button class="btn btn-primary btn-sm" id="add-item-btn" ${S.stores.length === 0 ? 'disabled' : ''}>+ 품목 추가</button>
        </div>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>매장</th><th>품명코드</th><th>품명</th><th>대분류</th><th>중분류</th><th>소분류</th><th>규격/사양</th><th>구매단위</th><th>등록방식</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>
          ${items.map((it) => `<tr>
            <td>${esc(it.store_name)}</td>
            <td>${esc(it.item_code)}</td><td>${esc(it.item_name)}</td><td>${esc(it.large_category)}</td><td>${esc(it.mid_category)}</td><td>${esc(it.small_category)}</td>
            <td>${esc(it.spec)}</td><td>${esc(it.purchase_unit)}</td>
            <td>${it.source === 'API' ? '<span class="badge badge-warn">API연동</span>' : '<span class="badge badge-muted">수기등록</span>'}</td>
            <td>${it.is_active ? '<span class="badge badge-good">사용</span>' : '<span class="badge badge-bad">중지</span>'}</td>
            <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${it.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${it.id}">비활성화</button></td>
          </tr>`).join('') || `<tr class="empty-row"><td colspan="11">등록된 품목이 없습니다.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  document.getElementById('item-store-filter').addEventListener('change', (e) => pageItems(e.target.value));
  document.getElementById('add-item-btn')?.addEventListener('click', () => itemModal(null, filterStoreId));
  items.forEach((it) => {
    c.querySelector(`[data-edit="${it.id}"]`).addEventListener('click', () => itemModal(it));
    c.querySelector(`[data-del="${it.id}"]`).addEventListener('click', () => confirmModal(`'${it.item_name}' 품목을 비활성화하시겠습니까?`, async () => {
      await api(`/api/admin/items/${it.id}`, { method: 'DELETE' }); toast('처리되었습니다.', 'success'); pageItems(filterStoreId);
    }));
  });
}
function itemModal(existing, defaultStoreId) {
  const modal = openModal({
    title: existing ? '품목 정보 수정' : '품목 추가',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>매장 *</label>
        ${existing
          ? `<input value="${esc(existing.store_name)}" disabled />`
          : `<select name="store_id" required>${S.stores.map((s) => `<option value="${s.id}" ${String(defaultStoreId) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}</select>`}
      </div>
      <div class="field"><label>품명코드 *</label><input name="item_code" id="item-code-input" value="${esc(existing?.item_code || '')}" ${existing ? 'disabled' : 'required'} /></div>
      <div class="field"><label>품명 *</label><input name="item_name" id="item-name-input" value="${esc(existing?.item_name || '')}" required />
        <div class="helper-text" id="item-name-hint"></div>
      </div>
      <div class="field"><label>대분류</label><input name="large_category" value="${esc(existing?.large_category || '')}" /></div>
      <div class="field"><label>중분류</label><input name="mid_category" value="${esc(existing?.mid_category || '')}" /></div>
      <div class="field"><label>소분류</label><input name="small_category" value="${esc(existing?.small_category || '')}" /></div>
      <div class="field"><label>규격/사양</label><input name="spec" value="${esc(existing?.spec || '')}" /></div>
      <div class="field"><label>구매단위</label><input name="purchase_unit" value="${esc(existing?.purchase_unit || '')}" placeholder="예: kg, box, ea" /></div>
      ${existing ? `<div class="field"><label>상태</label><select name="is_active"><option value="1" ${existing.is_active ? 'selected' : ''}>사용</option><option value="0" ${!existing.is_active ? 'selected' : ''}>중지</option></select></div>` : ''}
      <p class="helper-text span-2" style="grid-column:1/-1;">품명코드는 같은 매장 안에서는 중복 등록할 수 없고, 다른 매장에서는 별도 품목으로 등록할 수 있습니다. 단, 동일한 품명코드는 모든 매장에서 항상 같은 품명을 가져야 합니다. ${existing ? '품명을 수정하면 같은 품명코드를 쓰는 다른 매장의 품목명도 함께 자동으로 맞춰집니다.' : ''}</p>
    </div>`,
    onSubmit: async (fd, close) => {
      const body = Object.fromEntries(['item_name', 'large_category', 'mid_category', 'small_category', 'spec', 'purchase_unit'].map((k) => [k, fd.get(k)]));
      if (existing) { body.is_active = fd.get('is_active') === '1'; await api(`/api/admin/items/${existing.id}`, { method: 'PUT', body }); }
      else { body.item_code = fd.get('item_code'); body.store_id = Number(fd.get('store_id')); await api('/api/admin/items', { method: 'POST', body }); }
      toast('저장되었습니다.', 'success'); close(); pageItems(S.adminItemStoreId);
    },
  });
  if (!existing) {
    const codeInput = modal.querySelector('#item-code-input');
    const nameInput = modal.querySelector('#item-name-input');
    const hint = modal.querySelector('#item-name-hint');
    let lastLookupCode = null;
    codeInput.addEventListener('change', async () => {
      const code = codeInput.value.trim();
      if (!code || code === lastLookupCode) return;
      lastLookupCode = code;
      try {
        const { item_name } = await api(`/api/admin/items/lookup?item_code=${encodeURIComponent(code)}`);
        if (item_name) {
          nameInput.value = item_name;
          nameInput.readOnly = true;
          hint.textContent = `이미 다른 매장에 등록된 품명코드입니다. 품명은 '${item_name}'으로 고정됩니다.`;
        } else {
          nameInput.readOnly = false;
          hint.textContent = '';
        }
      } catch (e) { /* 조회 실패 시 자유 입력 유지 */ }
    });
  }
}

// =================================================================
// 관리자: 거래처 관리 (요건 4,6)
// =================================================================
async function pageVendors() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/vendors');
  c.innerHTML = `
    ${pageHead('거래처 관리', '입고 등록 시 선택할 거래처 마스터를 관리합니다. 외부 API(POST /api/integration/vendors)로도 연동 가능합니다.')}
    <div class="card">
      <div class="card-head"><h3>거래처 목록 (${items.length})</h3><button class="btn btn-primary btn-sm" id="add-vendor-btn">+ 거래처 추가</button></div>
      <div class="table-scroll"><table>
        <thead><tr><th>거래처코드</th><th>거래처명</th><th>등록방식</th><th>상태</th><th>관리</th></tr></thead>
        <tbody>
          ${items.map((v) => `<tr>
            <td>${esc(v.vendor_code)}</td><td>${esc(v.vendor_name)}</td>
            <td>${v.source === 'API' ? '<span class="badge badge-warn">API연동</span>' : '<span class="badge badge-muted">수기등록</span>'}</td>
            <td>${v.is_active ? '<span class="badge badge-good">사용</span>' : '<span class="badge badge-bad">중지</span>'}</td>
            <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${v.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${v.id}">비활성화</button></td>
          </tr>`).join('') || `<tr class="empty-row"><td colspan="5">등록된 거래처가 없습니다.</td></tr>`}
        </tbody>
      </table></div>
    </div>`;
  document.getElementById('add-vendor-btn').addEventListener('click', () => vendorModal());
  items.forEach((v) => {
    c.querySelector(`[data-edit="${v.id}"]`).addEventListener('click', () => vendorModal(v));
    c.querySelector(`[data-del="${v.id}"]`).addEventListener('click', () => confirmModal(`'${v.vendor_name}' 거래처를 비활성화하시겠습니까?`, async () => {
      await api(`/api/admin/vendors/${v.id}`, { method: 'DELETE' }); toast('처리되었습니다.', 'success'); await loadCommonData(); pageVendors();
    }));
  });
}
function vendorModal(existing) {
  openModal({
    title: existing ? '거래처 정보 수정' : '거래처 추가',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>거래처코드 *</label><input name="vendor_code" value="${esc(existing?.vendor_code || '')}" ${existing ? 'disabled' : 'required'} /></div>
      <div class="field"><label>거래처명 *</label><input name="vendor_name" value="${esc(existing?.vendor_name || '')}" required /></div>
      ${existing ? `<div class="field"><label>상태</label><select name="is_active"><option value="1" ${existing.is_active ? 'selected' : ''}>사용</option><option value="0" ${!existing.is_active ? 'selected' : ''}>중지</option></select></div>` : ''}
    </div>`,
    onSubmit: async (fd, close) => {
      const body = { vendor_name: fd.get('vendor_name') };
      if (existing) { body.is_active = fd.get('is_active') === '1'; await api(`/api/admin/vendors/${existing.id}`, { method: 'PUT', body }); }
      else { body.vendor_code = fd.get('vendor_code'); await api('/api/admin/vendors', { method: 'POST', body }); }
      toast('저장되었습니다.', 'success'); close(); await loadCommonData(); pageVendors();
    },
  });
}

// =================================================================
// 관리자: 공통코드 관리 (요건 10) - 품질상태/포장상태 등
// =================================================================
async function pageCodes() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/common-codes');
  const groups = {};
  items.forEach((r) => { (groups[r.group_code] = groups[r.group_code] || []).push(r); });
  const groupLabels = { QUALITY_STATUS: '품질상태', PACKAGE_STATUS: '포장상태' };
  c.innerHTML = `
    ${pageHead('공통코드 관리', '입고 등록 시 사용하는 드롭다운 값을 관리합니다. (예: 품질상태 - 양호/불량/누락/파손/기타)')}
    <div class="card">
      <div class="card-head"><h3>공통코드 그룹</h3><button class="btn btn-primary btn-sm" id="add-code-btn">+ 코드 추가</button></div>
      ${Object.keys(groups).map((g) => `
        <h4 style="font-size:13px; margin: 18px 0 8px; color:var(--color-text-muted);">${esc(groupLabels[g] || g)} <span style="font-family:var(--font-mono); font-weight:400;">(${esc(g)})</span></h4>
        <div class="table-scroll"><table>
          <thead><tr><th>코드</th><th>라벨</th><th>정렬순서</th><th>상태</th><th>관리</th></tr></thead>
          <tbody>${groups[g].map((cd) => `<tr>
            <td>${esc(cd.code)}</td><td>${esc(cd.label)}</td><td class="num">${cd.sort_order}</td>
            <td>${cd.is_active ? '<span class="badge badge-good">사용</span>' : '<span class="badge badge-bad">중지</span>'}</td>
            <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${cd.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${cd.id}">비활성화</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      `).join('')}
    </div>`;
  document.getElementById('add-code-btn').addEventListener('click', () => codeModal(groupLabels));
  items.forEach((cd) => {
    c.querySelector(`[data-edit="${cd.id}"]`).addEventListener('click', () => codeModal(groupLabels, cd));
    c.querySelector(`[data-del="${cd.id}"]`).addEventListener('click', () => confirmModal(`'${cd.label}' 코드를 비활성화하시겠습니까?`, async () => {
      await api(`/api/admin/common-codes/${cd.id}`, { method: 'DELETE' }); toast('처리되었습니다.', 'success'); await loadCommonData(); pageCodes();
    }));
  });
}
function codeModal(groupLabels, existing) {
  openModal({
    title: existing ? '공통코드 수정' : '공통코드 추가',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>그룹코드 *</label>
        ${existing ? `<input value="${esc(existing.group_code)}" disabled />` : `<select name="group_code"><option value="QUALITY_STATUS">품질상태</option><option value="PACKAGE_STATUS">포장상태</option></select>`}
      </div>
      <div class="field"><label>코드 *</label><input name="code" value="${esc(existing?.code || '')}" ${existing ? 'disabled' : 'required'} placeholder="예: GOOD"/></div>
      <div class="field"><label>화면 표시명 *</label><input name="label" value="${esc(existing?.label || '')}" required placeholder="예: 양호"/></div>
      <div class="field"><label>정렬순서</label><input name="sort_order" type="number" value="${existing?.sort_order ?? 0}" /></div>
      ${existing ? `<div class="field"><label>상태</label><select name="is_active"><option value="1" ${existing.is_active ? 'selected' : ''}>사용</option><option value="0" ${!existing.is_active ? 'selected' : ''}>중지</option></select></div>` : ''}
    </div>`,
    onSubmit: async (fd, close) => {
      if (existing) {
        await api(`/api/admin/common-codes/${existing.id}`, { method: 'PUT', body: { label: fd.get('label'), sort_order: Number(fd.get('sort_order')), is_active: fd.get('is_active') === '1' } });
      } else {
        await api('/api/admin/common-codes', { method: 'POST', body: { group_code: fd.get('group_code'), code: fd.get('code'), label: fd.get('label'), sort_order: Number(fd.get('sort_order')) } });
      }
      toast('저장되었습니다.', 'success'); close(); await loadCommonData(); pageCodes();
    },
  });
}

// =================================================================
// 관리자: 기초재고 등록 (요건 5)
// =================================================================
async function pageInitialStock() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/initial-stock');
  c.innerHTML = `
    ${pageHead('기초재고 등록', '시스템 도입 시점의 매장별 품목 기초재고를 설정합니다. 기본값은 0이며, 이후 입고/출고 내역이 여기에 가감되어 현재 재고가 계산됩니다.')}
    <div class="card">
      <div class="card-head"><h3>기초재고 설정</h3><button class="btn btn-primary btn-sm" id="add-is-btn">+ 기초재고 등록/수정</button></div>
      <div class="table-scroll"><table>
        <thead><tr><th>매장</th><th>품명코드</th><th>품명</th><th class="num">기초재고</th><th>설정일시</th></tr></thead>
        <tbody>${items.map((r) => `<tr><td>${esc(r.store_name)}</td><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td><td class="num">${fmtNum(r.quantity)}</td><td>${esc(r.set_at)}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="5">설정된 기초재고가 없습니다. (모든 품목 기초재고 기본값 0)</td></tr>`}</tbody>
      </table></div>
    </div>`;
  document.getElementById('add-is-btn').addEventListener('click', async () => {
    const defaultStoreId = S.stores[0]?.id;
    const initialItems = await fetchItemsForStore(defaultStoreId);
    const modal = openModal({
      title: '기초재고 등록/수정',
      bodyHtml: `<div class="form-grid">
        <div class="field"><label>매장 *</label><select name="store_id" id="is-store-select" required>${S.stores.map((s) => `<option value="${s.id}">${esc(s.store_name)}</option>`).join('')}</select></div>
        <div class="field"><label>품목 *</label><select name="item_id" id="is-item-select" required>${initialItems.map((it) => `<option value="${it.id}">${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>'}</select></div>
        <div class="field span-2"><label>기초재고 수량 *</label><input name="quantity" type="number" step="0.01" value="0" required /></div>
      </div>`,
      onSubmit: async (fd, close) => {
        if (!fd.get('item_id')) { toast('선택한 매장에 등록된 품목이 없습니다.', 'error'); return; }
        await api('/api/admin/initial-stock', { method: 'POST', body: { store_id: Number(fd.get('store_id')), item_id: Number(fd.get('item_id')), quantity: Number(fd.get('quantity')) } });
        toast('기초재고가 저장되었습니다.', 'success'); close(); pageInitialStock();
      },
    });
    modal.querySelector('#is-store-select').addEventListener('change', async (e) => {
      const its = await fetchItemsForStore(e.target.value);
      const sel = modal.querySelector('#is-item-select');
      sel.innerHTML = its.map((it) => `<option value="${it.id}">${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>';
    });
  });
}

// =================================================================
// 관리자: 로그 조회 (요건 8, 14)
// =================================================================
async function pageIoLogs() {
  const c = document.getElementById('content');
  renderFilterableLogPage(c);
}
async function renderFilterableLogPage(c, q = {}) {
  const qs = new URLSearchParams(q).toString();
  const { items } = await api(`/api/admin/io-logs${qs ? '?' + qs : ''}`);
  const actionBadge = { CREATE: 'badge-good', UPDATE: 'badge-warn', DELETE: 'badge-bad' };
  c.innerHTML = `
    ${pageHead('입출고 작업 로그', '입고/출고 등록·수정·삭제 이력을 구분석으로 조회합니다.')}
    <div class="card">
      <div class="filter-row">
        <div class="filter-field"><label>구분</label><select id="f-iotype"><option value="">전체</option><option value="INBOUND" ${q.io_type === 'INBOUND' ? 'selected' : ''}>입고</option><option value="OUTBOUND" ${q.io_type === 'OUTBOUND' ? 'selected' : ''}>출고</option></select></div>
        <div class="filter-field"><label>작업내용</label><select id="f-action"><option value="">전체</option><option value="CREATE" ${q.action === 'CREATE' ? 'selected' : ''}>등록</option><option value="UPDATE" ${q.action === 'UPDATE' ? 'selected' : ''}>수정</option><option value="DELETE" ${q.action === 'DELETE' ? 'selected' : ''}>삭제</option></select></div>
        <div class="filter-field"><label>매장</label><select id="f-store"><option value="">전체</option>${S.stores.map((s) => `<option value="${s.id}" ${String(q.store_id) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}</select></div>
        <div class="filter-field"><label>시작일</label><input id="f-from" type="date" value="${q.date_from || ''}" /></div>
        <div class="filter-field"><label>종료일</label><input id="f-to" type="date" value="${q.date_to || ''}" /></div>
        <button class="btn btn-primary btn-sm" id="f-apply">조회</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>일시</th><th>구분</th><th>작업내용</th><th>매장</th><th>품목</th><th>처리자</th></tr></thead>
        <tbody>${items.map((l) => `<tr>
          <td>${esc(l.created_at)}</td>
          <td>${l.io_type === 'INBOUND' ? '입고' : '출고'}</td>
          <td><span class="badge ${actionBadge[l.action]}">${{ CREATE: '등록', UPDATE: '수정', DELETE: '삭제' }[l.action]}</span></td>
          <td>${esc(l.store_name || '-')}</td>
          <td>${esc(l.item_name || '-')} ${l.item_code ? `(${esc(l.item_code)})` : ''}</td>
          <td>${esc(l.user_name || '-')}</td>
        </tr>`).join('') || `<tr class="empty-row"><td colspan="6">로그가 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  document.getElementById('f-apply').addEventListener('click', () => {
    renderFilterableLogPage(c, {
      io_type: document.getElementById('f-iotype').value,
      action: document.getElementById('f-action').value,
      store_id: document.getElementById('f-store').value,
      date_from: document.getElementById('f-from').value,
      date_to: document.getElementById('f-to').value,
    });
  });
}
async function pageAuthLogs() {
  const c = document.getElementById('content');
  const { items } = await api('/api/admin/auth-logs');
  const badge = { LOGIN_SUCCESS: 'badge-good', LOGIN_FAIL: 'badge-bad', LOGOUT: 'badge-muted' };
  const label = { LOGIN_SUCCESS: '로그인 성공', LOGIN_FAIL: '로그인 실패', LOGOUT: '로그아웃' };
  c.innerHTML = `
    ${pageHead('로그인 로그', '전체 계정의 로그인/로그아웃 이력입니다.')}
    <div class="card"><div class="table-scroll"><table>
      <thead><tr><th>일시</th><th>아이디</th><th>이벤트</th><th>IP</th></tr></thead>
      <tbody>${items.map((l) => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.username)}</td><td><span class="badge ${badge[l.action]}">${label[l.action]}</span></td><td>${esc(l.ip)}</td></tr>`).join('') || `<tr class="empty-row"><td colspan="4">로그가 없습니다.</td></tr>`}</tbody>
    </table></div></div>`;
}

// =================================================================
// 재고관리 (요건 6, 7, 13)
// =================================================================
async function pageInventory() {
  const c = document.getElementById('content');
  const storeParam = S.selectedStoreId === 'all' ? {} : { store_id: S.selectedStoreId };
  await renderInventoryTable(c, storeParam);
}
async function renderInventoryTable(c, extraQ = {}, keyword = '') {
  const q = { ...extraQ };
  if (keyword) q.keyword = keyword;
  const qs = new URLSearchParams(q).toString();
  const { items } = await api(`/api/inventory${qs ? '?' + qs : ''}`);
  const totalStock = items.reduce((s, r) => s + r.current_stock, 0);
  c.innerHTML = `
    ${pageHead('재고관리', '입고·출고 내역을 기반으로 산출된 매장별 현재 재고입니다.')}
    <div class="stat-grid">
      <div class="stat-card"><div class="label">조회 품목 수</div><div class="value">${items.length}</div></div>
      <div class="stat-card accent"><div class="label">재고 합계(전체 품목 단위 합)</div><div class="value">${fmtNum(totalStock)}</div></div>
    </div>
    <div class="card">
      <div class="filter-row">
        <div class="filter-field" style="min-width:220px;"><label>품목 검색</label><input id="inv-kw" placeholder="품명 또는 품명코드" value="${esc(keyword)}"/></div>
        <button class="btn btn-primary btn-sm" id="inv-search">검색</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>매장</th><th>품명코드</th><th>품명</th><th>단위</th><th class="num">기초재고</th><th class="num">입고누계</th><th class="num">출고누계</th><th class="num">현재재고</th></tr></thead>
        <tbody>${items.map((r) => `<tr>
          <td>${esc(r.store_name)}</td><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td><td>${esc(r.purchase_unit || '-')}</td>
          <td class="num">${fmtNum(r.initial_quantity)}</td><td class="num">${fmtNum(r.inbound_total)}</td><td class="num">${fmtNum(r.outbound_total)}</td>
          <td class="num" style="font-weight:700;">${fmtNum(r.current_stock)}${r.current_stock <= 0 ? ' <span class=\"badge badge-bad\">품절</span>' : ''}</td>
        </tr>`).join('') || `<tr class="empty-row"><td colspan="8">조회된 품목이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  document.getElementById('inv-search').addEventListener('click', () => renderInventoryTable(c, extraQ, document.getElementById('inv-kw').value.trim()));
}

// =================================================================
// 입고관리 (요건 4, 6, 9, 10, 15)
// =================================================================
async function pageInbound() {
  const c = document.getElementById('content');
  await renderInboundTable(c, {});
}
async function renderInboundTable(c, filters) {
  const q = { ...filters };
  if (S.selectedStoreId !== 'all') q.store_id = S.selectedStoreId;
  const qs = new URLSearchParams(q).toString();
  const { items } = await api(`/api/inbound${qs ? '?' + qs : ''}`);
  const qLabel = Object.fromEntries(S.qualityCodes.map((x) => [x.code, x.label]));
  c.innerHTML = `
    ${pageHead('입고관리', '식자재 입고 내역을 등록하고 관리합니다.')}
    <div class="card">
      <div class="card-head"><h3>입고 내역 (${items.length}건)</h3><button class="btn btn-primary btn-sm" id="add-inbound-btn" ${S.stores.length === 0 ? 'disabled' : ''}>+ 입고 등록</button></div>
      <div class="filter-row">
        <div class="filter-field"><label>품목검색</label><input id="ib-kw" placeholder="품명/품명코드" value="${esc(filters.keyword || '')}"/></div>
        <div class="filter-field"><label>거래처</label><select id="ib-vendor"><option value="">전체</option>${S.vendors.map((v) => `<option value="${v.id}" ${String(filters.vendor_id) === String(v.id) ? 'selected' : ''}>${esc(v.vendor_name)}</option>`).join('')}</select></div>
        <div class="filter-field"><label>품질상태</label><select id="ib-quality"><option value="">전체</option>${S.qualityCodes.map((qc) => `<option value="${qc.code}" ${filters.quality_status === qc.code ? 'selected' : ''}>${esc(qc.label)}</option>`).join('')}</select></div>
        <div class="filter-field"><label>시작일</label><input id="ib-from" type="date" value="${filters.date_from || ''}"/></div>
        <div class="filter-field"><label>종료일</label><input id="ib-to" type="date" value="${filters.date_to || ''}"/></div>
        <button class="btn btn-secondary btn-sm" id="ib-search">조회</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>입고일자</th><th>매장</th><th>품명코드</th><th>품명</th><th>거래처</th><th class="num">수량</th><th class="num">공급가액</th><th class="num">부가세</th><th>유통기한</th><th>입고온도</th><th>포장상태</th><th>품질상태</th><th>관리</th></tr></thead>
        <tbody>${items.map((r) => `<tr>
          <td>${esc(r.inbound_date)}</td><td>${esc(r.store_name)}</td><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td><td>${esc(r.vendor_name)}</td>
          <td class="num">${fmtNum(r.quantity)}</td><td class="num">${fmtNum(r.supply_price)}</td><td class="num">${fmtNum(r.vat)}</td>
          <td>${esc(r.expiry_date || '-')}</td><td>${esc(r.inbound_temp || '-')}</td><td>${esc(r.package_status || '-')}</td>
          <td>${r.quality_status ? `<span class="badge ${r.quality_status === 'GOOD' ? 'badge-good' : r.quality_status === 'BAD' ? 'badge-bad' : 'badge-warn'}">${esc(qLabel[r.quality_status] || r.quality_status)}</span>` : '-'}</td>
          <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${r.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${r.id}">삭제</button></td>
        </tr>`).join('') || `<tr class="empty-row"><td colspan="13">입고 내역이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;

  document.getElementById('add-inbound-btn')?.addEventListener('click', () => inboundModal());
  document.getElementById('ib-search').addEventListener('click', () => renderInboundTable(c, {
    keyword: document.getElementById('ib-kw').value.trim(),
    vendor_id: document.getElementById('ib-vendor').value,
    quality_status: document.getElementById('ib-quality').value,
    date_from: document.getElementById('ib-from').value,
    date_to: document.getElementById('ib-to').value,
  }));
  items.forEach((r) => {
    c.querySelector(`[data-edit="${r.id}"]`).addEventListener('click', () => inboundModal(r));
    c.querySelector(`[data-del="${r.id}"]`).addEventListener('click', () => confirmModal(`${r.inbound_date} / ${r.item_name} 입고 내역을 삭제하시겠습니까?`, async () => {
      try { await api(`/api/inbound/${r.id}`, { method: 'DELETE' }); toast('삭제되었습니다.', 'success'); renderInboundTable(c, filters); }
      catch (e) { toast(e.message, 'error'); }
    }));
  });
}

async function inboundModal(existing) {
  const defaultStore = existing?.store_id || (S.selectedStoreId !== 'all' ? S.selectedStoreId : S.stores[0]?.id);
  const initialItems = existing
    ? [{ id: existing.item_id, item_code: existing.item_code, item_name: existing.item_name }]
    : await fetchItemsForStore(defaultStore);
  const modal = openModal({
    title: existing ? '입고 내역 수정' : '입고 등록',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>매장 *</label><select name="store_id" id="ib-store-select" required ${existing ? 'disabled' : ''}>${S.stores.map((s) => `<option value="${s.id}" ${String(defaultStore) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}</select></div>
      <div class="field">
        <label>품목 * <button type="button" class="btn btn-ghost btn-sm qr-btn" id="ib-qr-btn">📷 QR스캔</button></label>
        <select name="item_id" id="ib-item-select" required ${existing ? 'disabled' : ''}>${initialItems.map((it) => `<option value="${it.id}" data-code="${esc(it.item_code)}" ${String(existing?.item_id) === String(it.id) ? 'selected' : ''}>${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>'}</select>
      </div>
      <div class="field"><label>거래처 *</label><select name="vendor_id" required>${S.vendors.map((v) => `<option value="${v.id}" ${String(existing?.vendor_id) === String(v.id) ? 'selected' : ''}>${esc(v.vendor_name)}</option>`).join('')}</select></div>
      <div class="field"><label>입고일자 *</label><input name="inbound_date" type="date" value="${existing?.inbound_date || todayStr()}" required /></div>
      <div class="field"><label>수량 *</label><input name="quantity" type="number" step="0.01" min="0.01" value="${existing?.quantity || ''}" required /></div>
      <div class="field"><label>공급가액 *</label><input name="supply_price" id="ib-supply" type="number" step="1" min="0" value="${existing?.supply_price ?? 0}" required /></div>
      <div class="field"><label>부가세</label><input name="vat" id="ib-vat" type="number" step="1" min="0" value="${existing?.vat ?? 0}" /><div class="vat-hint">공급가액 입력 시 10%로 자동계산되며, 필요 시 직접 수정할 수 있습니다.</div></div>
      <div class="field"><label>유통기한</label><input name="expiry_date" type="date" value="${existing?.expiry_date || ''}" /></div>
      <div class="field"><label>입고온도(℃)</label><input name="inbound_temp" value="${esc(existing?.inbound_temp || '')}" placeholder="예: 5"/></div>
      <div class="field"><label>포장상태</label><select name="package_status"><option value="">선택안함</option>${S.packageCodes.map((p) => `<option value="${p.code}" ${existing?.package_status === p.code ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></div>
      <div class="field"><label>품질상태</label><select name="quality_status"><option value="">선택안함</option>${S.qualityCodes.map((qc) => `<option value="${qc.code}" ${existing?.quality_status === qc.code ? 'selected' : ''}>${esc(qc.label)}</option>`).join('')}</select></div>
      <div class="field span-2"><label>비고</label><textarea name="memo" rows="2">${esc(existing?.memo || '')}</textarea></div>
    </div>`,
    onSubmit: async (fd, close) => {
      const body = {
        store_id: Number(fd.get('store_id')), item_id: Number(fd.get('item_id')), vendor_id: Number(fd.get('vendor_id')),
        inbound_date: fd.get('inbound_date'), quantity: Number(fd.get('quantity')), supply_price: Number(fd.get('supply_price')),
        vat: fd.get('vat') === '' ? undefined : Number(fd.get('vat')),
        expiry_date: fd.get('expiry_date') || null, inbound_temp: fd.get('inbound_temp') || null,
        package_status: fd.get('package_status') || null, quality_status: fd.get('quality_status') || null, memo: fd.get('memo') || null,
      };
      try {
        if (existing) await api(`/api/inbound/${existing.id}`, { method: 'PUT', body });
        else await api('/api/inbound', { method: 'POST', body });
        toast('저장되었습니다.', 'success'); close(); renderInboundTable(document.getElementById('content'), {});
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  const supplyInput = modal.querySelector('#ib-supply');
  const vatInput = modal.querySelector('#ib-vat');
  let vatTouched = !!existing;
  supplyInput.addEventListener('input', () => { if (!vatTouched) vatInput.value = Math.round((Number(supplyInput.value) || 0) * 0.1); });
  vatInput.addEventListener('input', () => { vatTouched = true; });
  modal.querySelector('#ib-qr-btn').addEventListener('click', () => openQrScanner((code) => {
    const sel = modal.querySelector('#ib-item-select');
    const opt = [...sel.options].find((o) => o.dataset.code === code);
    if (opt) { sel.value = opt.value; toast(`품목이 선택되었습니다: ${opt.textContent}`, 'success'); }
    else toast('일치하는 품목코드를 찾을 수 없습니다: ' + code, 'error');
  }));
  if (!existing) {
    modal.querySelector('#ib-store-select').addEventListener('change', async (e) => {
      const its = await fetchItemsForStore(e.target.value);
      const sel = modal.querySelector('#ib-item-select');
      sel.innerHTML = its.map((it) => `<option value="${it.id}" data-code="${esc(it.item_code)}">${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>';
    });
  }
}

// =================================================================
// 출고관리 (요건 5, 7)
// =================================================================
async function pageOutbound() {
  const c = document.getElementById('content');
  await renderOutboundTable(c, {});
}
async function renderOutboundTable(c, filters) {
  const q = { ...filters };
  if (S.selectedStoreId !== 'all') q.store_id = S.selectedStoreId;
  const qs = new URLSearchParams(q).toString();
  const { items } = await api(`/api/outbound${qs ? '?' + qs : ''}`);
  c.innerHTML = `
    ${pageHead('출고관리', '식자재 출고 내역을 등록하고 관리합니다. 현재 재고를 초과하는 수량은 출고할 수 없습니다.')}
    <div class="card">
      <div class="card-head"><h3>출고 내역 (${items.length}건)</h3><button class="btn btn-primary btn-sm" id="add-outbound-btn" ${S.stores.length === 0 ? 'disabled' : ''}>+ 출고 등록</button></div>
      <div class="filter-row">
        <div class="filter-field"><label>품목검색</label><input id="ob-kw" placeholder="품명/품명코드" value="${esc(filters.keyword || '')}"/></div>
        <div class="filter-field"><label>시작일</label><input id="ob-from" type="date" value="${filters.date_from || ''}"/></div>
        <div class="filter-field"><label>종료일</label><input id="ob-to" type="date" value="${filters.date_to || ''}"/></div>
        <button class="btn btn-secondary btn-sm" id="ob-search">조회</button>
      </div>
      <div class="table-scroll"><table>
        <thead><tr><th>출고일자</th><th>매장</th><th>품명코드</th><th>품명</th><th class="num">수량</th><th class="num">공급가액</th><th class="num">부가세</th><th>관리</th></tr></thead>
        <tbody>${items.map((r) => `<tr>
          <td>${esc(r.outbound_date)}</td><td>${esc(r.store_name)}</td><td>${esc(r.item_code)}</td><td>${esc(r.item_name)}</td>
          <td class="num">${fmtNum(r.quantity)}</td><td class="num">${fmtNum(r.supply_price)}</td><td class="num">${fmtNum(r.vat)}</td>
          <td class="row-actions"><button class="btn btn-secondary btn-sm" data-edit="${r.id}">수정</button><button class="btn btn-danger btn-sm" data-del="${r.id}">삭제</button></td>
        </tr>`).join('') || `<tr class="empty-row"><td colspan="8">출고 내역이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  document.getElementById('add-outbound-btn')?.addEventListener('click', () => outboundModal());
  document.getElementById('ob-search').addEventListener('click', () => renderOutboundTable(c, {
    keyword: document.getElementById('ob-kw').value.trim(),
    date_from: document.getElementById('ob-from').value,
    date_to: document.getElementById('ob-to').value,
  }));
  items.forEach((r) => {
    c.querySelector(`[data-edit="${r.id}"]`).addEventListener('click', () => outboundModal(r));
    c.querySelector(`[data-del="${r.id}"]`).addEventListener('click', () => confirmModal(`${r.outbound_date} / ${r.item_name} 출고 내역을 삭제하시겠습니까?`, async () => {
      try { await api(`/api/outbound/${r.id}`, { method: 'DELETE' }); toast('삭제되었습니다.', 'success'); renderOutboundTable(c, filters); }
      catch (e) { toast(e.message, 'error'); }
    }));
  });
}

async function outboundModal(existing) {
  const defaultStore = existing?.store_id || (S.selectedStoreId !== 'all' ? S.selectedStoreId : S.stores[0]?.id);
  const initialItems = existing
    ? [{ id: existing.item_id, item_code: existing.item_code, item_name: existing.item_name }]
    : await fetchItemsForStore(defaultStore);
  const modal = openModal({
    title: existing ? '출고 내역 수정' : '출고 등록',
    bodyHtml: `<div class="form-grid">
      <div class="field"><label>매장 *</label><select name="store_id" id="ob-store" required ${existing ? 'disabled' : ''}>${S.stores.map((s) => `<option value="${s.id}" ${String(defaultStore) === String(s.id) ? 'selected' : ''}>${esc(s.store_name)}</option>`).join('')}</select></div>
      <div class="field">
        <label>품목 * <button type="button" class="btn btn-ghost btn-sm qr-btn" id="ob-qr-btn">📷 QR스캔</button></label>
        <select name="item_id" id="ob-item-select" required ${existing ? 'disabled' : ''}>${initialItems.map((it) => `<option value="${it.id}" data-code="${esc(it.item_code)}" ${String(existing?.item_id) === String(it.id) ? 'selected' : ''}>${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>'}</select>
      </div>
      <div class="field"><label>출고일자 *</label><input name="outbound_date" type="date" value="${existing?.outbound_date || todayStr()}" required /></div>
      <div class="field"><label>수량 *</label><input name="quantity" type="number" step="0.01" min="0.01" value="${existing?.quantity || ''}" required /></div>
      <div class="field"><label>공급가액 *</label><input name="supply_price" id="ob-supply" type="number" step="1" min="0" value="${existing?.supply_price ?? 0}" required /></div>
      <div class="field"><label>부가세</label><input name="vat" id="ob-vat" type="number" step="1" min="0" value="${existing?.vat ?? 0}" /><div class="vat-hint">공급가액 입력 시 10%로 자동계산되며, 필요 시 직접 수정할 수 있습니다.</div></div>
      <div class="field span-2" id="ob-stock-hint" style="font-size:12.5px; color:var(--color-text-muted);"></div>
      <div class="field span-2"><label>비고</label><textarea name="memo" rows="2">${esc(existing?.memo || '')}</textarea></div>
    </div>`,
    onSubmit: async (fd, close) => {
      const body = {
        store_id: Number(fd.get('store_id')), item_id: Number(fd.get('item_id')), outbound_date: fd.get('outbound_date'),
        quantity: Number(fd.get('quantity')), supply_price: Number(fd.get('supply_price')),
        vat: fd.get('vat') === '' ? undefined : Number(fd.get('vat')), memo: fd.get('memo') || null,
      };
      try {
        if (existing) await api(`/api/outbound/${existing.id}`, { method: 'PUT', body });
        else await api('/api/outbound', { method: 'POST', body });
        toast('저장되었습니다.', 'success'); close(); renderOutboundTable(document.getElementById('content'), {});
      } catch (e) { toast(e.message, 'error'); }
    },
  });
  const supplyInput = modal.querySelector('#ob-supply');
  const vatInput = modal.querySelector('#ob-vat');
  let vatTouched = !!existing;
  supplyInput.addEventListener('input', () => { if (!vatTouched) vatInput.value = Math.round((Number(supplyInput.value) || 0) * 0.1); });
  vatInput.addEventListener('input', () => { vatTouched = true; });
  modal.querySelector('#ob-qr-btn').addEventListener('click', () => openQrScanner((code) => {
    const sel = modal.querySelector('#ob-item-select');
    const opt = [...sel.options].find((o) => o.dataset.code === code);
    if (opt) { sel.value = opt.value; toast(`품목이 선택되었습니다: ${opt.textContent}`, 'success'); refreshStockHint(); }
    else toast('일치하는 품목코드를 찾을 수 없습니다: ' + code, 'error');
  }));
  async function refreshStockHint() {
    const storeId = modal.querySelector('#ob-store').value;
    const itemId = modal.querySelector('#ob-item-select').value;
    if (!storeId || !itemId) return;
    try {
      const { items } = await api(`/api/inventory?store_id=${storeId}&item_id=${itemId}`);
      const stock = items[0]?.current_stock ?? 0;
      modal.querySelector('#ob-stock-hint').textContent = `현재 재고: ${fmtNum(stock)}${existing ? ' (본 출고 건 수량은 별도로 반영되어 있습니다)' : ' — 이 수량을 초과하여 출고할 수 없습니다.'}`;
    } catch (e) { /* ignore */ }
  }
  modal.querySelector('#ob-store').addEventListener('change', async (e) => {
    if (!existing) {
      const its = await fetchItemsForStore(e.target.value);
      const sel = modal.querySelector('#ob-item-select');
      sel.innerHTML = its.map((it) => `<option value="${it.id}" data-code="${esc(it.item_code)}">${esc(it.item_name)} (${esc(it.item_code)})</option>`).join('') || '<option value="">등록된 품목이 없습니다</option>';
    }
    refreshStockHint();
  });
  modal.querySelector('#ob-item-select').addEventListener('change', refreshStockHint);
  refreshStockHint();
}

// ---------------------------------------------------------------
// 공통 모달 / 확인창
// ---------------------------------------------------------------
function openModal({ title, bodyHtml, onSubmit }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-box">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" id="modal-close">✕</button></div>
      <form id="modal-form">
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-foot">
          <button type="button" class="btn btn-secondary" id="modal-cancel">취소</button>
          <button type="submit" class="btn btn-primary">저장</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#modal-close').addEventListener('click', close);
  backdrop.querySelector('#modal-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const form = backdrop.querySelector('#modal-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try { await onSubmit(new FormData(form), close); }
    catch (err) { toast(err.message, 'error'); }
    finally { submitBtn.disabled = false; }
  });
  return backdrop;
}

function confirmModal(message, onConfirm) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal-box" style="max-width:400px;">
      <div class="modal-body" style="padding-top:24px;">${esc(message)}</div>
      <div class="modal-foot">
        <button type="button" class="btn btn-secondary" id="c-cancel">취소</button>
        <button type="button" class="btn btn-danger" id="c-ok">확인</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector('#c-cancel').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector('#c-ok').addEventListener('click', async () => {
    try { await onConfirm(); close(); } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------
// QR 스캔 (요건 15 - 확장 기능)
// ---------------------------------------------------------------
let qrScanner = null;
function openQrScanner(onCode) {
  const modal = document.getElementById('qr-modal');
  modal.classList.remove('hidden');
  if (typeof Html5Qrcode === 'undefined') {
    document.getElementById('qr-reader').innerHTML = '<p style="padding:20px; font-size:13px; color:var(--color-text-muted);">QR 스캔 라이브러리를 불러올 수 없습니다. 네트워크 연결을 확인해주세요.</p>';
    return;
  }
  document.getElementById('qr-reader').innerHTML = '';
  qrScanner = new Html5Qrcode('qr-reader');
  qrScanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 220 },
    (decodedText) => { closeQrScanner(); onCode(decodedText.trim()); },
    () => {}
  ).catch(() => {
    document.getElementById('qr-reader').innerHTML = '<p style="padding:20px; font-size:13px; color:var(--color-text-muted);">카메라에 접근할 수 없습니다. 브라우저 카메라 권한을 확인해주세요.</p>';
  });
}
function closeQrScanner() {
  const modal = document.getElementById('qr-modal');
  modal.classList.add('hidden');
  if (qrScanner) { qrScanner.stop().catch(() => {}).finally(() => { qrScanner.clear?.(); qrScanner = null; }); }
}
document.getElementById('qr-close-btn').addEventListener('click', closeQrScanner);

// ---------------------------------------------------------------
boot();
