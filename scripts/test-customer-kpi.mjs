#!/usr/bin/env node
/**
 * BO TESTCASE cho module khach-hang (Muc 1) — chay TRUC TIEP vao server dang chay.
 *
 * Cach dung:
 *   npm run test:customer-kpi
 *   hoac: node scripts/test-customer-kpi.js [BASE_URL] [ADMIN_USER] [ADMIN_PASS]
 *
 * Mien dich: script tao 1 tieu chi tam ten 'kpi_test_auto' roi XOA di ngay
 * (ke ca khi loi) — khong de lai du lieu rac. Chay an toan tren DB dev.
 *
 * Test phan quyen:
 *   - Nhom F tu dong: tao 4 user theo 4 role (manager/user/pm-khach-hang, view),
 *     test ma tran 6 endpoint/role roi xoa mem user. Chay lai thoai mai.
 *   - Nhom E tuy chon: tai khoan NGOAI he thong role moi — truyen:
 *     set TEST_USER=ten_dang_nhap & set TEST_PASS=mat_khau & npm run test:customer-kpi
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_USER = process.argv[3] || process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.argv[4] || process.env.ADMIN_PASS || 'admin';
const TEST_USER = process.env.TEST_USER;
const TEST_PASS = process.env.TEST_PASS;

// ===== ĐỒNG HỒ: in thời gian mỗi nhóm (kỹ thuật: bọc console.log, mỗi lần
// gặp tiêu đề nhóm "-- X. ..." thì in khoảng cách từ tiêu đề trước) =====
const T0 = Date.now();
let _prevMark = T0;
const _log = console.log.bind(console);
console.log = (...args) => {
  const msg = String(args[0] ?? '');
  if (msg.startsWith('--')) {
    const now = Date.now();
    _log(`   ⏱ nhóm trước: ${((now - _prevMark) / 1000).toFixed(1)}s (tổng ${((now - T0) / 1000).toFixed(1)}s)`);
    _prevMark = now;
  }
  _log(...args);
};

// Mật khẩu mặc định khi tạo user mới qua API = PASSWORD_DEFAULT trong .env
let DEFAULT_PASSWORD = 'default_password';
try {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const m = readFileSync(envPath, 'utf8').match(/^PASSWORD_DEFAULT\s*=\s*(.+)$/m);
  if (m) DEFAULT_PASSWORD = m[1].trim().replace(/^["']|["']$/g, '');
} catch {}

let adminToken = null;
let createdId = null;
let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function bad(name, detail) {
  fail++;
  failures.push({ name, detail });
  console.log(`  ✗ ${name}\n      → ${detail}`);
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

async function expect(name, want, fn) {
  try {
    const got = await fn();
    if (typeof want === 'number') {
      if (got !== want) throw new Error(`HTTP ${got} (kỳ vọng ${want})`);
    } else if (Array.isArray(want)) {
      if (!want.includes(got)) throw new Error(`HTTP ${got} (kỳ vọng một trong ${want.join('/')})`);
    }
    ok(name);
    return got;
  } catch (e) {
    bad(name, e.message);
    return undefined;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }

console.log(`\n== BO TEST MODULE KHACH-HANG ==\n   Server: ${BASE}\n   Tai khoan admin: ${ADMIN_USER}\n`);

// ============ A. XAC THUC ============
console.log('-- A. Xác thực --');
await expect('Không token → 401', 401, async () => (await call('GET', '/customers')).status);
await expect('Token sai → 401', 401, async () => (await call('GET', '/customers', { token: 'token-gia' })).status);
{
  const r = await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
  if (r.status === 200 || r.status === 201) {
    adminToken = r.json?.access_token || r.json?.token || r.json?.accessToken;
    if (adminToken) ok('Đăng nhập admin');
    else bad('Đăng nhập admin', `HTTP ${r.status} nhưng không tìm thấy trường token trong: ${Object.keys(r.json || {}).join(', ')}`);
  } else {
    bad('Đăng nhập admin', `HTTP ${r.status} — ${ADMIN_USER}/${'***'} không đúng? Chạy lại kèm: node scripts/test-customer-kpi.js ${BASE} <user> <pass>`);
  }
}
if (!adminToken) {
  console.log('\nKhông lấy được token → dừng, không chạy tiếp các nhóm test.');
  process.exit(1);
}
const H = () => ({ token: adminToken });

// ============ B. CAU HINH TIEU CHI (CRUD that) ============
console.log('\n-- B. Cấu hình tiêu chí (CRUD thật) --');
await expect('GET definitions → 200', 200, async () => (await call('GET', '/customer-kpi-definitions', H())).status);
{
  const r = await call('GET', '/customer-kpi-definitions', H());
  const data = r.json?.data || [];
  assert(r.status === 200 && data.length >= 5, `chỉ có ${data.length} tiêu chí`);
  assert(data.some((d) => d.key === 'doanh_so_key'), 'thiếu tiêu chí doanh_so_key');
  assert(data.some((d) => d.key === 'goi_y_thuc_hien'), 'thiếu tiêu chí goi_y_thuc_hien');
  ok(`Seed đủ ≥5 tiêu chí mặc định (thấy ${data.length})`);
}

const TEST_KEY = 'kpi_test_auto';
await expect('POST tạo tiêu chí tạm → 201', 201, async () => {
  const r = await call('POST', '/customer-kpi-definitions', {
    ...H(),
    body: {
      key: TEST_KEY, name: 'Tiêu chí tự động test', metric: 'contacted_customers',
      scoring_mode: 'ratio', denominator: 'all_customers', period: 'day',
    },
  });
  createdId = r.json?.id;
  assert(createdId, 'response không có id');
  return r.status;
});
await expect('POST trùng key → 409', 409, async () => (await call('POST', '/customer-kpi-definitions', {
  ...H(),
  body: { key: TEST_KEY, name: 'Trùng', metric: 'contacted_customers', scoring_mode: 'binary' },
})).status);
if (createdId) {
  await expect(`PATCH đổi tên (id=${createdId}) → 200`, 200, async () => (await call('PATCH', `/customer-kpi-definitions/${createdId}`, {
    ...H(), body: { name: 'Tiêu chí tự động test (đã sửa)' },
  })).status);
  await expect('Đổi scoring_mode binary → tự xoá denominator', 200, async () => {
    const r = await call('PATCH', `/customer-kpi-definitions/${createdId}`, { ...H(), body: { scoring_mode: 'binary', comparison: 'gte' } });
    assert(r.json?.denominator == null, `denominator còn giữ: ${r.json?.denominator}`);
    return r.status;
  });
  await expect('Đổi ngược lại ratio → tự xoá comparison', 200, async () => {
    const r = await call('PATCH', `/customer-kpi-definitions/${createdId}`, { ...H(), body: { scoring_mode: 'ratio', denominator: 'all_customers' } });
    assert(r.json?.comparison == null, `comparison còn giữ: ${r.json?.comparison}`);
    return r.status;
  });
}
await expect('DELETE tiêu chí tạm → 200', 200, async () => (await call('DELETE', `/customer-kpi-definitions/${createdId}`, H())).status);
await expect('DELETE lần 2 → 404', 404, async () => (await call('DELETE', `/customer-kpi-definitions/${createdId}`, H())).status);
createdId = null;

// ============ C. API DOC DANH SACH (hop dong phan trang) ============
console.log('\n-- C. API đọc danh sách --');
for (const path of ['/customers', '/customers/unmatched', '/customer-assignments/import-sessions', '/customer-kpi-targets', '/approval-requests']) {
  await expect(`GET ${path} → 200 + phân trang`, 200, async () => {
    const r = await call('GET', path, H());
    for (const k of ['data', 'total', 'page', 'pageSize']) {
      assert(k in r.json, `thiếu trường "${k}"`);
    }
    return r.status;
  });
}
await expect('GET /customers/99999999 → 403 (ngoài phạm vi/không tồn tại)', 403,
  async () => (await call('GET', '/customers/99999999', H())).status);
await expect('GET /customers/99999999/zalo-accounts → 403', 403,
  async () => (await call('GET', '/customers/99999999/zalo-accounts', H())).status);
await expect('GET import-sessions/99999999/preview → 404', 404,
  async () => (await call('GET', '/customer-assignments/import-sessions/99999999/preview', H())).status);
await expect('GET /approval-requests/99999999 → 404', 404,
  async () => (await call('GET', '/approval-requests/99999999', H())).status);

// ============ D. HOP DONG BIEN (tung la 501 — Muc 3-4 da hien thuc het) ============
console.log('\n-- D. Hợp đồng biên (Mục 3-4 đã hiện thực — hết endpoint 501) --');
// Mục 3 đã hiện thực PATCH zalo-links — id không tồn tại giờ trả 404 (nhóm K test hành vi thật)
await expect('PATCH /customers/zalo-links/99999999 (id ảo) → 404', 404,
  async () => (await call('PATCH', '/customers/zalo-links/99999999', { ...H(), body: { is_active: false } })).status);
await expect('POST /customer-assignments/import thiếu file → 400', 400,
  async () => (await call('POST', '/customer-assignments/import', H())).status);
// Mục 4 đã hiện thực engine chấm điểm — các endpoint trả dữ liệu thật (nhóm M test nội dung)
await expect('GET /customer-kpi-reports/overview → 200 (hết 501)', 200,
  async () => (await call('GET', '/customer-kpi-reports/overview?from=2026-10-01&to=2026-10-05', H())).status);
await expect('GET /customer-kpi-reports/by-sale → 200 (hết 501)', 200,
  async () => (await call('GET', '/customer-kpi-reports/by-sale?from=2026-10-01&to=2026-10-05', H())).status);
await expect('GET /customer-kpi-reports/suggestions → 200 (hết 501)', 200,
  async () => (await call('GET', '/customer-kpi-reports/suggestions', H())).status);
await expect('POST /customer-kpi-targets thiếu trường → 400 (hết 501)', 400,
  async () => (await call('POST', '/customer-kpi-targets', { ...H(), body: {} })).status);

// ============ E. PHAN QUYEN (tuy chon) ============
if (TEST_USER && TEST_PASS) {
  console.log(`\n-- E. Phân quyền với tài khoản chưa gán role khach-hang (${TEST_USER}) --`);
  let userToken = null;
  {
    const r = await call('POST', '/auth/login', { body: { username: TEST_USER, password: TEST_PASS } });
    userToken = r.json?.access_token || r.json?.token || r.json?.accessToken;
    if (userToken) ok('Đăng nhập tài khoản test');
    else bad('Đăng nhập tài khoản test', `HTTP ${r.status}`);
  }
  if (userToken) {
    await expect('USER GET /customers → 403', 403,
      async () => (await call('GET', '/customers', { token: userToken })).status);
    await expect('USER GET /customer-kpi-definitions → 403', 403,
      async () => (await call('GET', '/customer-kpi-definitions', { token: userToken })).status);
  }
} else {
  console.log('\n-- E. Phân quyền: BỎ QUA (truyền TEST_USER/TEST_PASS để chạy) --');
}

// ============ F. MA TRẬN PHÂN QUYỀN THEO ROLE ============
// Script TỰ TẠO 4 user (mỗi role một user), login bằng mật khẩu mặc định,
// test 6 endpoint theo ma trận quyền, rồi XÓA MỀM các user đó.
// Chạy lại nhiều lần vẫn ổn: user bị xoá mềm lần trước được restore + gán lại role.
console.log('\n-- F. Ma trận phân quyền theo role (tự tạo user, tự dọn) --');

async function findRoleId(name) {
  const r = await call('GET', '/roles', H());
  const list = Array.isArray(r.json) ? r.json : r.json?.data || r.json?.roles || [];
  return list.find((x) => x.name === name)?.id;
}

async function ensureTestUser(username, roleIds) {
  const r = await call('POST', '/users', {
    ...H(),
    body: { username, fullName: `Test ${username}`, roleIds },
  });
  if (r.status === 201) return r.json?.id;
  if (r.status === 409 && r.json?.code === 'SOFT_DELETED_DUPLICATE') {
    const id = r.json?.userId;
    await call('PATCH', `/users/${id}/restore`, H());
    // LƯU Ý: route POST /users/:id/roles nhận MẢNG THÔNG THƯỜNG, không phải {roleIds}
    await call('POST', `/users/${id}/roles`, { ...H(), body: roleIds });
    return id;
  }
  if (r.status === 409) {
    // user còn hoạt động từ lần chạy trước bị gãy giữa chừng — tìm lại theo username
    const s = await call('GET', `/users?search=${encodeURIComponent(username)}&limit=50`, H());
    const list = Array.isArray(s.json) ? s.json : s.json?.data || [];
    const found = list.find((u) => u.username === username);
    if (found?.id) {
      await call('POST', `/users/${found.id}/roles`, { ...H(), body: roleIds });
      return found.id;
    }
  }
  throw new Error(
    `Không chuẩn bị được user ${username}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`,
  );
}

const ROLE_MATRIX = [
  {
    role: 'manager-khach-hang',
    label: 'Trưởng phòng',
    // PATCH giờ thật: manager test không có phòng ban (chưa vào nhóm H) → 403 phạm vi
    expectUpdate: 403,
    // approve bật → qua guard → id không tồn tại → 404
    expectDecide: 404,
  },
  {
    role: 'user-khach-hang',
    label: 'Nhân viên',
    // PATCH /customers/1: sale 1 không phải của mình → 403 (chỉ đề xuất được danh sách của mình)
    expectUpdate: 403,
    expectDecide: 403, // approve tắt
  },
  {
    role: 'pm-khach-hang',
    label: 'PM',
    expectUpdate: 403, // update tắt (chỉ read + export)
    expectDecide: 403,
  },
  {
    role: 'view',
    label: 'View-only',
    expectUpdate: 403, // guard chặn role view ngoài read/export
    expectDecide: 403,
  },
];

const createdTestUserIds = [];
{
  const roleIdByName = {};
  try {
    for (const { role } of ROLE_MATRIX) {
      roleIdByName[role] = await findRoleId(role);
      assert(roleIdByName[role], `Không tìm thấy role "${role}" — seed nhóm quyền đã chạy chưa?`);
    }
  } catch (e) {
    bad('Tra role cho ma trận phân quyền', e.message);
  }

  for (const { role, label, expectUpdate, expectDecide } of ROLE_MATRIX) {
    const username = `kpi_test_${role.replaceAll('-', '_')}`;
    try {
      const userId = await ensureTestUser(username, [roleIdByName[role]]);
      createdTestUserIds.push(userId);

      const lr = await call('POST', '/auth/login', {
        body: { username, password: DEFAULT_PASSWORD },
      });
      const token = lr.json?.access_token || lr.json?.token || lr.json?.accessToken;
      assert(token, `Login ${username} HTTP ${lr.status} — PASSWORD_DEFAULT trong .env có phải mật khẩu user này không?`);
      const U = { token };
      const T = (name, want, fn) => expect(`[${label}] ${name}`, want, fn);

      await T('GET /customers (read) → 200', 200,
        async () => (await call('GET', '/customers', U)).status);
      await T('GET /customer-kpi-definitions (read) → 200', 200,
        async () => (await call('GET', '/customer-kpi-definitions', U)).status);
      await T(`PATCH /customers/1 (update) → ${expectUpdate}`, expectUpdate,
        async () => (await call('PATCH', '/customers/1', { ...U, body: { customer_tier: 'KEY' } })).status);
      await T('PATCH /customer-kpi-definitions/1 (cấu hình tiêu chí) → 403 chỉ admin được', 403,
        async () => (await call('PATCH', '/customer-kpi-definitions/1', { ...U, body: { name: 'hack' } })).status);
      await T('POST /customer-assignments/import (import) → 403', 403,
        async () => (await call('POST', '/customer-assignments/import', U)).status);
      await T(`POST /approval-requests/99999999/decide (approve) → ${expectDecide}`, expectDecide,
        async () => (await call('POST', '/approval-requests/99999999/decide', { ...U, body: { action: 'approve' } })).status);
    } catch (e) {
      bad(`[${label}] Chuẩn bị user ${username}`, e.message);
    }
  }

  // User test GIỮ ACTIVE (quyết định 10/07) — không xoá, ensureTestUser tự tái sử dụng
}

// ============ G. THÊM/SỬA/XOÁ BẰNG TAY + BIÊN + TRA CỨU ZALO (admin) ============
console.log('\n-- G. Thêm/sửa/xoá bằng tay + biên + tra cứu Zalo (admin) --');
{
  let gAssignmentId = null;
  let gAssignmentId2 = null;
  const gCode = `TEST_AUTO_${Date.now()}`;
  const gBody = {
    customer_code: gCode,
    customer_name: 'Khách test tự động',
    department_slug: 'laptop',
    sale_id: 1,
    customer_tier: 'KEY',
  };
  await expect('POST /customers (thêm tay) → 201', 201, async () => {
    const r = await call('POST', '/customers', { ...H(), body: gBody });
    gAssignmentId = r.json?.assignmentId;
    assert(gAssignmentId, 'response thiếu assignmentId');
    return r.status;
  });
  await expect('POST /customers trùng phân công → 409', 409,
    async () => (await call('POST', '/customers', { ...H(), body: { ...gBody, customer_tier: 'NON' } })).status);
  await expect('POST /customers cùng mã KHÁC SAP → 201 (khách khác thật sự, giữ cả hai)', 201, async () => {
    const r = await call('POST', '/customers', { ...H(), body: { ...gBody, sap_code: 'C99999' } });
    gAssignmentId2 = r.json?.assignmentId;
    assert(gAssignmentId2 && gAssignmentId2 !== gAssignmentId, 'phải tạo dòng phân công MỚI cho khách (mã, SAP)');
    return r.status;
  });
  await expect('POST /customers sai phòng ban → 400', 400,
    async () => (await call('POST', '/customers', { ...H(), body: { ...gBody, customer_code: gCode + '_X', department_slug: 'khong-ton-tai' } })).status);
  await expect('POST /customers thiếu mã khách → 400', 400,
    async () => (await call('POST', '/customers', { ...H(), body: { department_slug: 'laptop', sale_id: 1, customer_tier: 'KEY' } })).status);
  await expect('POST /customers sai tier → 400', 400,
    async () => (await call('POST', '/customers', { ...H(), body: { ...gBody, customer_code: gCode + '_T', customer_tier: 'VIP' } })).status);

  if (gAssignmentId) {
    await expect('GET /customers/:id trên dữ liệu vừa tạo → 200 đủ trường', 200, async () => {
      const r = await call('GET', `/customers/${gAssignmentId}`, H());
      assert(r.json?.customer?.customerCode === gCode, `mã không khớp: ${r.json?.customer?.customerCode}`);
      assert(r.json?.sale?.id === 1, 'thiếu thông tin sale');
      assert(Array.isArray(r.json?.zaloAccounts), 'zaloAccounts không phải mảng');
      return r.status;
    });
    await expect('GET /customers/:id/zalo-accounts → 200', 200,
      async () => (await call('GET', `/customers/${gAssignmentId}/zalo-accounts`, H())).status);
    await expect('GET /customers/:id/response-daily → 200 đủ trường', 200, async () => {
      const r = await call('GET', `/customers/${gAssignmentId}/response-daily?from=2026-10-01&to=2026-10-05`, H());
      for (const k of ['responseDaily', 'activityDaily']) assert(Array.isArray(r.json?.[k]), `thiếu "${k}"`);
      return r.status;
    });
    await expect('bulk-update đúng 1 dòng → 200 (updated 1)', 200, async () => {
      const r = await call('POST', '/customers/bulk-update', {
        ...H(), body: { assignmentIds: [gAssignmentId], customer_tier: 'NON' },
      });
      assert(r.json?.updated === 1, `updated=${r.json?.updated}`);
      return r.status;
    });
    await expect('bulk-update mảng rỗng → 200 (updated 0)', 200, async () => {
      const r = await call('POST', '/customers/bulk-update', { ...H(), body: { assignmentIds: [], customer_tier: 'KEY' } });
      assert(r.json?.updated === 0, `updated=${r.json?.updated}`);
      return r.status;
    });
    await expect('bulk-update thiếu tier lẫn role → 400', 400,
      async () => (await call('POST', '/customers/bulk-update', { ...H(), body: { assignmentIds: [gAssignmentId] } })).status);
    await expect('bulk-update id lẫn lộn [thật + ảo] → updated 1 + skipped 1', 200, async () => {
      const r = await call('POST', '/customers/bulk-update', {
        ...H(), body: { assignmentIds: [gAssignmentId, 99999999], customer_tier: 'KEY' },
      });
      assert(r.json?.updated === 1, `updated=${r.json?.updated}`);
      assert(r.json?.skipped?.[0]?.assignmentId === 99999999, 'skipped sai');
      return r.status;
    });
  }
  await expect('GET /customers/zalo-contacts → 200 (đọc DB zalo)', 200, async () => {
    const r = await call('GET', '/customers/zalo-contacts?limit=5', H());
    assert(Array.isArray(r.json?.data), 'data không phải mảng');
    return r.status;
  });
  await expect('zalo-contacts tìm ký tự đặc biệt "%" → 200', 200,
    async () => (await call('GET', `/customers/zalo-contacts?search=${encodeURIComponent('%')}&limit=5`, H())).status);
  await expect('zalo-contacts limit=0 → 400', 400,
    async () => (await call('GET', '/customers/zalo-contacts?limit=0', H())).status);
  await expect('zalo-contacts limit=201 → 400', 400,
    async () => (await call('GET', '/customers/zalo-contacts?limit=201', H())).status);
  await expect('GET /customers?tier=VIP (giá trị không hợp lệ) → 400', 400,
    async () => (await call('GET', '/customers?tier=VIP', H())).status);
  await expect('GET /customers search SQL injection → 200 (query tham số hoá)', 200,
    async () => (await call('GET', `/customers?search=${encodeURIComponent("' OR 1=1--")}`, H())).status);
  await expect('GET /customers phân trang page=2&pageSize=5 → 200 đúng echo', 200, async () => {
    const r = await call('GET', '/customers?page=2&pageSize=5', H());
    assert(r.json?.page === 2 && r.json?.pageSize === 5, `page=${r.json?.page}, pageSize=${r.json?.pageSize}`);
    return r.status;
  });
  if (gAssignmentId) {
    await expect('DELETE /customers/:id → 200 (xoá mềm status=deleted)', 200,
      async () => (await call('DELETE', `/customers/${gAssignmentId}`, H())).status);
    await expect('DELETE lần 2 → 404 (đã xoá trước đó)', 404,
      async () => (await call('DELETE', `/customers/${gAssignmentId}`, H())).status);
    await expect('bulk-update trên khách đã xoá → skipped kèm lý do (không sửa lặng lẽ)', 200, async () => {
      const r = await call('POST', '/customers/bulk-update', {
        ...H(), body: { assignmentIds: [gAssignmentId], customer_tier: 'KEY' },
      });
      assert(
        r.json?.skipped?.[0]?.reason === 'khách đã bị xoá',
        `skipped=${JSON.stringify(r.json?.skipped)}`,
      );
      assert(r.json?.updated === 0, `updated=${r.json?.updated}`);
      return r.status;
    });
    gAssignmentId = null;
  }
  if (gAssignmentId2) {
    await expect('DELETE khách SAP thứ hai → 200', 200,
      async () => (await call('DELETE', `/customers/${gAssignmentId2}`, H())).status);
    gAssignmentId2 = null;
  }
  await expect('Danh sách sau xoá không còn khách nào cùng mã (cả 2 SAP)', 200, async () => {
    const r = await call('GET', `/customers?search=${gCode}`, H());
    assert((r.json?.total ?? 1) === 0, `vẫn còn ${r.json?.total} dòng`);
    return r.status;
  });
  // Export đã hiện thực (Mục 4, cv 6) — nhóm M test nội dung file với sale thu hẹp;
  // ở đây smoke-test khoảng cũ KHÔNG có dữ liệu (load nhanh) để xác nhận hết 501
  {
    const res = await fetch(`${BASE}/customer-kpi-reports/export?from=2020-01-01&to=2020-01-02`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(60000),
    });
    const ct = res.headers.get('content-type') || '';
    if (res.status === 200 && ct.includes('spreadsheetml')) ok('GET /customer-kpi-reports/export → 200 xlsx (hết 501)');
    else bad('GET /customer-kpi-reports/export', `HTTP ${res.status}, content-type=${ct}`);
  }

  // Nhóm tiêu chí khác kinh-doanh — luồng group riêng
  await expect('POST tiêu chí nhóm cong-no → 201', 201, async () => {
    const r = await call('POST', '/customer-kpi-definitions', { ...H(), body: {
      team_group: 'cong-no', key: 'kpi_test_cong_no', name: 'Test nhóm công nợ',
      metric: 'debt_balance', scoring_mode: 'binary', comparison: 'lte', period: 'month',
    }});
    assert(r.json?.id, 'thiếu id');
    return r.status;
  });
  await expect('GET lọc theo nhóm cong-no thấy tiêu chí vừa tạo → 200', 200, async () => {
    const r = await call('GET', '/customer-kpi-definitions?teamGroup=cong-no', H());
    assert((r.json?.data || []).some((d) => d.key === 'kpi_test_cong_no'), 'không thấy tiêu chí');
    return r.status;
  });
  await expect('DELETE tiêu chí nhóm cong-no → 200', 200, async () => {
    const r = await call('GET', '/customer-kpi-definitions?teamGroup=cong-no', H());
    const id = (r.json?.data || []).find((d) => d.key === 'kpi_test_cong_no')?.id;
    assert(id, 'không tìm thấy id để xoá');
    return (await call('DELETE', `/customer-kpi-definitions/${id}`, H())).status;
  });
}

// ============ H. PHẠM VI MANAGER VỚI PHÒNG BAN TỰ TẠO ============
// Tạo 1 phòng ban test (dùng lại bằng restore nếu đã có từ lần chạy trước),
// gán manager + user vào phòng, chứng minh: manager thêm/xem/sửa được dữ liệu
// của người CÙNG phòng, bị chặn với người NGOÀI phòng. Dọn sạch sau khi chạy.
console.log('\n-- H. Phạm vi manager với phòng ban tự tạo --');
{
  const DEPT_NAME = 'Test KPI Dept auto';
  let deptId = null;
  let createdCustomerAid = null;
  try {
    // 1. Tạo hoặc khôi phục phòng ban test
    const list = await call('GET', '/departments?pageSize=100', H());
    const dlist = Array.isArray(list.json) ? list.json : list.json?.data || [];
    deptId = dlist.find((d) => d.name === DEPT_NAME)?.id ?? null;
    if (!deptId) {
      const r = await call('POST', '/departments', { ...H(), body: { name: DEPT_NAME, server_ip: '' } });
      if (r.status === 201) {
        deptId = r.json?.id;
      } else if (r.json?.deletedDepartment?.id) {
        deptId = r.json.deletedDepartment.id;
        await call('PATCH', `/departments/${deptId}/restore`, H());
      } else {
        const dl = await call('GET', '/departments/deleted?pageSize=100', H());
        const dlList = Array.isArray(dl.json) ? dl.json : dl.json?.data || [];
        const d = dlList.find((x) => x.name === DEPT_NAME);
        if (d?.id) {
          deptId = d.id;
          await call('PATCH', `/departments/${deptId}/restore`, H());
        }
      }
    }
    assert(deptId, `Không tạo/khôi phục được phòng ban test (HTTP ${list.status})`);
    ok(`Chuẩn bị phòng ban test (id=${deptId})`);

    // 2. Đảm bảo 3 user test + gán phòng (pm KHÔNG gán — giữ ngoài phòng)
    const mgrId = await ensureTestUser('kpi_test_manager_khach_hang', [await findRoleId('manager-khach-hang')]);
    const khId = await ensureTestUser('kpi_test_user_khach_hang', [await findRoleId('user-khach-hang')]);
    const pmId = await ensureTestUser('kpi_test_pm_khach_hang', [await findRoleId('pm-khach-hang')]);
    await call('PATCH', `/users/${mgrId}`, { ...H(), body: { departmentIds: [deptId] } });
    await call('PATCH', `/users/${khId}`, { ...H(), body: { departmentIds: [deptId] } });

    // 3. Đăng nhập manager
    const lr = await call('POST', '/auth/login', {
      body: { username: 'kpi_test_manager_khach_hang', password: DEFAULT_PASSWORD },
    });
    const mgrToken = lr.json?.access_token || lr.json?.token || lr.json?.accessToken;
    assert(mgrToken, `Login manager HTTP ${lr.status} — PASSWORD_DEFAULT đúng chưa?`);
    const M = { token: mgrToken };

    const code = `TEST_MGR_${Date.now()}`;
    await expect('[H] Manager thêm khách cho sale CÙNG phòng → 201', 201, async () => {
      const r = await call('POST', '/customers', { ...M, body: {
        customer_code: code,
        customer_name: 'Khách test phạm vi manager',
        department_slug: 'laptop',
        sale_id: khId,
        customer_tier: 'KEY',
      }});
      createdCustomerAid = r.json?.assignmentId;
      assert(createdCustomerAid, 'thiếu assignmentId');
      return r.status;
    });
    await expect('[H] Manager thêm khách cho sale NGOÀI phòng → 403', 403,
      async () => (await call('POST', '/customers', { ...M, body: {
        customer_code: code + '_O', department_slug: 'laptop', sale_id: pmId, customer_tier: 'KEY',
      }})).status);
    await expect('[H] Manager GET /customers?saleId=<cùng phòng> → total ≥ 1', 200, async () => {
      const r = await call('GET', `/customers?saleId=${khId}`, M);
      assert((r.json?.total ?? 0) >= 1, `total=${r.json?.total}`);
      return r.status;
    });
    await expect('[H] Manager GET /customers?saleId=<ngoài phòng> → total = 0', 200, async () => {
      const r = await call('GET', `/customers?saleId=${pmId}`, M);
      assert((r.json?.total ?? 1) === 0, `total=${r.json?.total} — manager đang thấy dữ liệu ngoài phòng!`);
      return r.status;
    });
    if (createdCustomerAid) {
      await expect('[H] Manager bulk-update trong phòng → 200 (updated 1)', 200, async () => {
        const r = await call('POST', '/customers/bulk-update', {
          ...M, body: { assignmentIds: [createdCustomerAid], customer_tier: 'NON' },
        });
        assert(r.json?.updated === 1, `updated=${r.json?.updated}`);
        return r.status;
      });
    }

    // 5. Phạm vi phía NHÂN VIÊN — server ép scope theo chính mình,
    //    bỏ qua tham số saleId mà client tự truyền
    const uR = await call('POST', '/auth/login', {
      body: { username: 'kpi_test_user_khach_hang', password: DEFAULT_PASSWORD },
    });
    const userToken = uR.json?.access_token || uR.json?.token || uR.json?.accessToken;
    assert(userToken, `Login user_kh HTTP ${uR.status}`);
    const U = { token: userToken };
    await expect('[H] Nhân viên GET /customers?saleId=<người khác> → server ép về chính mình (total 0)', 200, async () => {
      const r = await call('GET', `/customers?saleId=${pmId}`, U);
      assert((r.json?.total ?? 1) === 0, `total=${r.json?.total} — nhân viên đang thấy dữ liệu người khác!`);
      return r.status;
    });
    await expect('[H] Nhân viên GET /customers (không tham số) → thấy đúng dữ liệu của mình (≥1)', 200, async () => {
      const r = await call('GET', '/customers', U);
      assert((r.json?.total ?? 0) >= 1, `total=${r.json?.total}`);
      return r.status;
    });
    if (createdCustomerAid) {
      await expect('[H] Nhân viên GET chi tiết khách của chính mình → 200', 200,
        async () => (await call('GET', `/customers/${createdCustomerAid}`, U)).status);
    }
    await expect('[H] Nhân viên zalo-contacts (trong phạm vi) → 200', 200,
      async () => (await call('GET', '/customers/zalo-contacts?limit=5', U)).status);
    await expect('[H] Nhân viên zalo-contacts accountId người khác → 403', 403,
      async () => (await call('GET', '/customers/zalo-contacts?accountId=3&limit=5', U)).status);

    // 6. Luồng sửa của NHÂN VIÊN → đề xuất → trưởng phòng duyệt (cv 5-6)
    let proposalId = null;
    if (createdCustomerAid) {
      await expect('[H] Manager sửa trực tiếp khách trong phòng → 200 (applied)', 200, async () => {
        const r = await call('PATCH', `/customers/${createdCustomerAid}`, { ...M, body: { customer_tier: 'NON' } });
        assert(r.json?.applied === true, `body=${JSON.stringify(r.json).slice(0, 120)}`);
        return r.status;
      });
      await expect('[H] Nhân viên sửa khách của mình → tạo đề xuất chờ duyệt', 200, async () => {
        const r = await call('PATCH', `/customers/${createdCustomerAid}`, { ...U, body: { customer_tier: 'KEY' } });
        assert(r.json?.proposal === true && r.json?.requestId, `body=${JSON.stringify(r.json).slice(0, 150)}`);
        proposalId = r.json.requestId;
        return r.status;
      });
      const pr = await call('POST', '/auth/login', {
        body: { username: 'kpi_test_pm_khach_hang', password: DEFAULT_PASSWORD },
      });
      const pmToken = pr.json?.access_token || pr.json?.token || pr.json?.accessToken;
      assert(pmToken, 'Login pm test thất bại');
      await expect('[H] PM duyệt đề xuất của phòng khác → 403', 403,
        async () => (await call('POST', `/approval-requests/${proposalId}/decide`, { token: pmToken, body: { action: 'approve' } })).status);
      await expect('[H] Manager duyệt đề xuất → 200 approved', 200, async () => {
        const r = await call('POST', `/approval-requests/${proposalId}/decide`, { ...M, body: { action: 'approve' } });
        assert(r.json?.status === 'approved', `body=${JSON.stringify(r.json).slice(0, 120)}`);
        return r.status;
      });
      await expect('[H] Sau duyệt: tier đúng như đề xuất (KEY)', 200, async () => {
        const r = await call('GET', `/customers/${createdCustomerAid}`, M);
        assert(r.json?.customerTier === 'KEY', `tier=${r.json?.customerTier}`);
        return r.status;
      });
      await expect('[H] Nhân viên đề xuất lần 2 (đổi về NON)', 200, async () => {
        const r = await call('PATCH', `/customers/${createdCustomerAid}`, { ...U, body: { customer_tier: 'NON' } });
        assert(r.json?.proposal === true && r.json?.requestId, `body=${JSON.stringify(r.json).slice(0, 120)}`);
        proposalId = r.json.requestId;
        return r.status;
      });
      await expect('[H] Manager từ chối kèm lý do → 200 rejected', 200, async () => {
        const r = await call('POST', `/approval-requests/${proposalId}/decide`, {
          ...M, body: { action: 'reject', reject_reason: 'Chưa đủ điều kiện nâng Key' },
        });
        assert(r.json?.status === 'rejected', `body=${JSON.stringify(r.json).slice(0, 120)}`);
        return r.status;
      });
      await expect('[H] Sau từ chối: tier không đổi (vẫn KEY)', 200, async () => {
        const r = await call('GET', `/customers/${createdCustomerAid}`, M);
        assert(r.json?.customerTier === 'KEY', `tier=${r.json?.customerTier}`);
        return r.status;
      });
      await expect('[H] Duyệt lại đề xuất đã từ chối → 400', 400,
        async () => (await call('POST', `/approval-requests/${proposalId}/decide`, { ...M, body: { action: 'approve' } })).status);
    }
  } catch (e) {
    bad('[H] Chuẩn bị phòng ban / user test', e.message);
  }
  // 4. Dọn: xoá mềm khách + phòng ban — user test GIỮ ACTIVE (quyết định 10/07)
  if (createdCustomerAid) {
    try { await call('DELETE', `/customers/${createdCustomerAid}`, H()); } catch {}
  }
  if (deptId) {
    try { await call('DELETE', `/departments/${deptId}`, H()); } catch {}
  }
}

// ============ I. IMPORT EXCEL THẬT (file demo trong test-fixtures) ============
console.log('\n-- I. Import Excel thật (test-fixtures) --');
{
  let sessionId = null;
  try {
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', 'test-fixtures', 'DSKH KDS_CHÍNH PHỤ_KEY NON.xlsx',
    );
    const buf = readFileSync(fixturePath); // thiếu file sẽ ném lỗi → rơi vào catch bên dưới

    // 1) Upload file demo
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'DSKH demo.xlsx');
    const up = await fetch(`${BASE}/customer-assignments/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd,
      signal: AbortSignal.timeout(180000),
    });
    const upJson = await up.json();
    if (up.status === 201 && upJson?.sessionId) {
      ok(`Upload file demo → 201 (session ${upJson.sessionId}, ${JSON.stringify(upJson.summary)})`);
      sessionId = upJson.sessionId;
    } else {
      bad('Upload file demo', `HTTP ${up.status}: ${JSON.stringify(upJson).slice(0, 200)}`);
    }

    if (sessionId) {
      const s = upJson.summary || {};
      const expectExact = (name, got, want) => {
        if (got === want) ok(name);
        else bad(name, `nhận ${got}, kỳ vọng ${want}`);
      };
      expectExact('Đọc đủ 4.750 dòng dữ liệu', s.rowsParsed, 4750);
      expectExact('2 cặp (mã, SAP) trùng trong file', s.duplicatePairs, 2);
      if (s.customersParsed >= 4740 && s.customersParsed <= 4750) ok(`Số khách sau gộp hợp lý (${s.customersParsed})`);
      else bad('Số khách sau gộp', `nhận ${s.customersParsed}, kỳ vọng 4740..4750`);
      if (s.errorRows >= 14 && s.errorRows <= 18) ok(`Dòng lỗi dữ liệu bẩn trong khoảng 14..18 (${s.errorRows})`);
      else bad('Dòng lỗi dữ liệu bẩn', `nhận ${s.errorRows}, kỳ vọng 14..18`);
      // Số "create" phụ thuộc DB đã có dữ liệu demo chưa: DB trống → ~9.000
      // (mỗi khách tối đa 6 phòng); DB đã seed demo → chỉ còn các dòng BẠN của
      // file (không bao giờ apply được) → create = errorRows - 2 × cặp trùng.
      // Chặn cận dưới chung cho cả hai thế giới.
      const minCreate = (s.errorRows ?? 0) - 2 * (s.duplicatePairs ?? 0);
      if (s.create >= minCreate && s.create <= s.customersParsed) {
        ok(`Số thay đổi tạo mới hợp lý (${s.create} ≥ ${minCreate} — DB trống thì ~9.000, DB đã seed thì chỉ còn dòng bẩn)`);
      } else {
        bad('Số thay đổi tạo mới', `nhận ${s.create}, kỳ vọng ${minCreate}..${s.customersParsed}`);
      }

      // 2) Preview session
      const pv = await call('GET', `/customer-assignments/import-sessions/${sessionId}/preview?pageSize=5`, H());
      if (pv.status === 200 && Array.isArray(pv.json?.data) && pv.json.data.length > 0
          && pv.json?.summary?.create === s.create) {
        ok('Preview session → 200, có thay đổi, khớp tổng');
      } else {
        bad('Preview session', `HTTP ${pv.status}, summary=${JSON.stringify(pv.json?.summary)?.slice(0, 120)}`);
      }

      // 3) Đặt quyết định Giữ/Bỏ cho 1 thay đổi — xác nhận qua preview (dữ liệu DB là chuẩn)
      const firstChange = pv.json?.data?.[0];
      if (firstChange?.id) {
        await expect('PATCH decision của 1 thay đổi → 200 + preview xác nhận', 200, async () => {
          const r = await call('PATCH',
            `/customer-assignments/import-sessions/${sessionId}/changes/${firstChange.id}`,
            { ...H(), body: { decision: 'skip' } });
          if (r.json?.decision !== 'skip') {
            throw new Error(`HTTP ${r.status}, body=${JSON.stringify(r.json).slice(0, 200)}`);
          }
          const pv2 = await call('GET',
            `/customer-assignments/import-sessions/${sessionId}/preview?pageSize=100`, H());
          const found = (pv2.json?.data || []).find((c) => c.id === firstChange.id);
          assert(found?.decision === 'skip', `preview thấy decision=${found?.decision}`);
          return r.status;
        });
      }
    }

    // 4) File mẫu
    {
      const res = await fetch(`${BASE}/customer-assignments/template`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(30000),
      });
      const ab = await res.arrayBuffer();
      const ct = res.headers.get('content-type') || '';
      if (res.status === 200 && ct.includes('spreadsheetml') && ab.byteLength > 3000) {
        ok(`Tải file mẫu → 200 (${Math.round(ab.byteLength / 1024)}KB)`);
      } else {
        bad('Tải file mẫu', `HTTP ${res.status}, content-type=${ct}, size=${ab.byteLength}`);
      }
    }

    // 5) Upload file không phải .xlsx → 400
    {
      const fd = new FormData();
      fd.append('file', new Blob(['khong phai excel']), 'ghi-chu.txt');
      const res = await fetch(`${BASE}/customer-assignments/import`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: fd,
      });
      if (res.status === 400) ok('Upload file .txt → 400');
      else bad('Upload file .txt', `HTTP ${res.status}, kỳ vọng 400`);
    }

    // 6) Huỷ session — xoá sạch danh sách thay đổi
    if (sessionId) {
      await expect('Huỷ session import → 200', 200,
        async () => (await call('DELETE', `/customer-assignments/import-sessions/${sessionId}`, H())).status);
      await expect('Sau huỷ, preview không còn thay đổi', 200, async () => {
        const pv = await call('GET', `/customer-assignments/import-sessions/${sessionId}/preview`, H());
        assert((pv.json?.data || []).length === 0, `vẫn còn ${pv.json?.data?.length} thay đổi`);
        return pv.status;
      });
      await expect('Huỷ lần 2 → 400 (đã huỷ)', 400,
        async () => (await call('DELETE', `/customer-assignments/import-sessions/${sessionId}`, H())).status);
      sessionId = null;
    }
  } catch (e) {
    bad('[I] Chuẩn bị file demo', `${e.message} — kiểm tra test-fixtures có file DSKH demo chưa`);
  }
}

// ============ J. APPLY + ROLLBACK (file demo thật + nhân viên test) ============
// DB dev có thể ĐÃ seed sẵn toàn bộ khách demo (seed-customer-kpi-dev.mjs) nên
// import nguyên file không còn gì để apply. Cách chắc chắn cho CẢ HAI thế giới:
// đọc file demo, NHÚNG thêm 2 khách có tag riêng từng lần chạy vào workbook
// (trong bộ nhớ, không đụng file gốc) → apply/rollback đúng 2 khách đó.
console.log('\n-- J. Apply + Rollback (file demo + 2 khách tag nhúng vào workbook) --');
{
  let sessionId = null;
  const createdEmpIds = [];
  try {
    const backendRequire = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    );
    const ExcelJS = backendRequire('exceljs');
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..', 'test-fixtures', 'DSKH KDS_CHÍNH PHỤ_KEY NON.xlsx',
    );

    // 1. Trích các mã NV (NKDS*) từ file demo
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(fixturePath);
    const ws = wb.getWorksheet('File Chi Tiết');
    const codes = new Set();
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      if (!String(row.getCell(3).value ?? '').trim()) continue;
      for (let col = 4; col <= 9; col++) {
        const raw = String(row.getCell(col).value ?? '').trim();
        if (raw) codes.add(raw.split('-')[0].trim().toUpperCase());
      }
    }
    assert(codes.size >= 30, `chỉ trích được ${codes.size} mã NV từ file`);

    // 2. Tạo user với đúng mã NV (lần chạy sau: restore user đã xoá mềm)
    for (const code of codes) {
      const username = `kpi_emp_${code.toLowerCase()}`;
      const r = await call('POST', '/users', {
        ...H(),
        body: { username, fullName: `NV test ${code}`, employeeCode: code },
      });
      if (r.status === 201) {
        createdEmpIds.push(r.json?.id);
      } else if (r.status === 409 && r.json?.code === 'SOFT_DELETED_DUPLICATE') {
        const id = r.json?.userId;
        await call('PATCH', `/users/${id}/restore`, H());
        createdEmpIds.push(id);
      } else if (r.status === 409) {
        const s = await call('GET', `/users?search=${encodeURIComponent(username)}&limit=10`, H());
        const list = Array.isArray(s.json) ? s.json : s.json?.data || [];
        const u = list.find((x) => x.username === username);
        assert(u?.id, `user ${username} không tìm thấy được`);
        createdEmpIds.push(u.id);
      } else {
        throw new Error(`Không tạo được NV ${code}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 150)}`);
      }
    }
    ok(`Chuẩn bị ${createdEmpIds.length} nhân viên test theo mã NKDS trong file`);

    // 3. Nhúng 2 khách tag vào workbook demo (in-memory) rồi upload
    const tag = Date.now().toString(36).slice(-6);
    const tagNum = Date.now() % 100000;
    const wsHeader = ws.getRow(1);
    const colOf = {};
    wsHeader.eachCell({ includeEmpty: false }, (cell, col) => {
      const n = String(cell.value ?? '')
        .replace(/Đ/g, 'D').replace(/đ/g, 'd')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim().toUpperCase();
      colOf[n] = col;
    });
    const colSap = colOf['MA DOI TAC SAP'];
    const colCode = colOf['MA KH'];
    const colLoai = colOf['LOAI MA'];
    const colEmp = colOf['S1-LAPTOP'];
    const colTier = colOf['LAPTOP'];
    assert(colSap && colCode && colLoai && colEmp && colTier,
      `không tìm thấy đủ cột trong file demo: ${JSON.stringify(colOf)}`);

    const J_CODES = { a: `KPI_J_${tag}A`, b: `KPI_J_${tag}B` };
    // addRow dạng OBJECT với key số KHÔNG hoạt động (exceljs map theo ws.columns
    // → ra dòng rỗng) — bắt buộc dùng mảng 1-based: arr[1] = cột A
    const mkRow = (sap, code, loai, emp, tier) => {
      const arr = [];
      arr[colSap] = sap;
      arr[colCode] = code;
      arr[colLoai] = loai;
      arr[colEmp] = emp;
      arr[colTier] = tier;
      return arr;
    };
    ws.addRow(mkRow(`C9${tagNum}1`, J_CODES.a, 'CHÍNH', 'NKDS03-NV Test J', 'Key'));
    ws.addRow(mkRow(`C9${tagNum}2`, J_CODES.b, 'PHỤ', 'NKDS03-NV Test J', 'Non'));
    const tagBuf = Buffer.from(await wb.xlsx.writeBuffer());

    const fd = new FormData();
    fd.append('file', new Blob([tagBuf]), 'DSKH apply-rollback.xlsx');
    const up = await fetch(`${BASE}/customer-assignments/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: fd,
      signal: AbortSignal.timeout(180000),
    });
    const upJson = await up.json();
    sessionId = upJson?.sessionId;
    assert(up.status === 201 && sessionId, `upload HTTP ${up.status}`);
    const s = upJson.summary || {};
    assert((s.create ?? 0) >= 2, `create=${s.create} — 2 khách tag phải là create (DB trống thì nhiều hơn)`);

    // 4. Tổng khách trước khi apply
    const before = await call('GET', '/customers?pageSize=1', H());

    // 5. Apply — DB trống: ~9.8k thay đổi (chục giây); DB đã seed: đúng 2 khách tag
    const ap = await fetch(`${BASE}/customer-assignments/import-sessions/${sessionId}/apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(600000),
    });
    const apJson = await ap.json();
    if (ap.status === 200 && (apJson?.applied ?? 0) >= 2) {
      ok(`Apply → 200 (applied ${apJson.applied}, bỏ qua ${apJson.skippedErrors} dòng lỗi, conflict ${apJson.conflicts?.length})`);
    } else {
      bad('Apply', `HTTP ${ap.status}, body=${JSON.stringify(apJson).slice(0, 250)}`);
    }
    const skippedErrors = apJson?.skippedErrors ?? 0;
    // Số change mang lỗi bị bỏ qua phụ thuộc khách bẩn nào đang có phân công
    // trong DB lúc apply — không cố định giữa các lần chạy, chỉ chặn khoảng hợp lệ
    if (skippedErrors > 0 && skippedErrors <= (s.errorRows ?? 15)) {
      ok(`Bỏ qua ${skippedErrors} change mang lỗi (≤ ${s.errorRows} khách bẩn trong file)`);
    } else {
      bad('Số dòng lỗi bị bỏ qua', `nhận ${skippedErrors}, kỳ vọng 1..${s.errorRows ?? 15}`);
    }

    // 6. Khách xuất hiện — 2 khách (2 SAP) × 4 phòng = 8 dòng phân công
    await expect('[J] Sau apply: khách tag A xuất hiện (≥1 dòng phân công)', 200, async () => {
      const r = await call('GET', `/customers?search=${encodeURIComponent(J_CODES.a)}&pageSize=10`, H());
      assert((r.json?.total ?? 0) >= 1, `total=${r.json?.total} — khách tag phải được apply tạo`);
      return r.status;
    });
    await expect('[J] Sau apply: CONGNGHE247 = 2 khách × 4 phòng → 8 dòng phân công, 2 SAP', 200, async () => {
      const r = await call('GET', '/customers?search=HQS_Q03_SM_CONGNGHE247&pageSize=20', H());
      assert(r.json?.total === 8, `total=${r.json?.total}`);
      const saps = [...new Set((r.json?.data || []).map((x) => x.customer?.sapCode))].sort();
      assert(JSON.stringify(saps) === JSON.stringify(['C30112', 'C30200']), `sap=${saps}`);
      return r.status;
    });
    await expect('[J] Sau apply: tổng khách ≥ 9000', 200, async () => {
      const r = await call('GET', '/customers?pageSize=1', H());
      assert((r.json?.total ?? 0) >= 9000, `total=${r.json?.total}`);
      return r.status;
    });
    await expect('[J] Apply lần 2 → 400', 400,
      async () => (await call('POST', `/customer-assignments/import-sessions/${sessionId}/apply`, H())).status);

    // 7. Rollback — hoàn tác toàn bộ
    const rb = await fetch(`${BASE}/customer-assignments/import-sessions/${sessionId}/rollback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(600000),
    });
    const rbJson = await rb.json();
    if (rb.status === 200 && (rbJson?.restored ?? 0) >= 2) {
      ok(`Rollback → 200 (restored ${rbJson.restored}, skip ${rbJson.skipped?.length})`);
    } else {
      bad('Rollback', `HTTP ${rb.status}, body=${JSON.stringify(rbJson).slice(0, 250)}`);
    }

    // 8. Dữ liệu trở về đúng trạng thái ban đầu: khách tag biến mất hoàn toàn
    //    (DB đã seed thì CONGNGHE247 vẫn còn 8 dòng từ seed — không thuộc session này)
    await expect('[J] Sau rollback: khách tag biến mất → total 0', 200, async () => {
      const r = await call('GET', `/customers?search=${encodeURIComponent(J_CODES.a)}&pageSize=10`, H());
      assert(r.json?.total === 0, `total=${r.json?.total}`);
      const r2 = await call('GET', `/customers?search=${encodeURIComponent(J_CODES.b)}&pageSize=10`, H());
      assert(r2.json?.total === 0, `total=${r2.json?.total}`);
      return r.status;
    });
    await expect('[J] Sau rollback: tổng khách về đúng số trước apply', 200, async () => {
      const r = await call('GET', '/customers?pageSize=1', H());
      assert(r.json?.total === before.json?.total, `total=${r.json?.total}, trước đó=${before.json?.total}`);
      return r.status;
    });
    await expect('[J] Rollback lần 2 → 400', 400,
      async () => (await call('POST', `/customer-assignments/import-sessions/${sessionId}/rollback`, H())).status);

    // 9. Huỷ session đã hoàn tác — dọn changes + backup
    await expect('[J] Huỷ session sau rollback → 200 (dọn changes + backup)', 200,
      async () => (await call('DELETE', `/customer-assignments/import-sessions/${sessionId}`, H())).status);
    sessionId = null;
  } catch (e) {
    bad('[J] Chuẩn bị', e.message);
  }
  // 40 nhân viên test GIỮ ACTIVE (quyết định 10/07) — lần sau restore lại role/phân công
}

// ============ K. MUC 3 — LIEN KET ZALO: SUA TAY + DANH SACH CHUA KHOP ============
console.log('\n-- K. Liên kết Zalo: sửa tay + danh sách chưa khớp (Mục 3) --');
{
  const CODE_A = 'KPI_ZALO_TEST_A';
  let assignmentId = null;
  let linkId = null;
  let existingLinks = [];
  try {
    // 1. Chuẩn bị khách test của admin — chạy lại an toàn: nếu phân công còn
    //    từ lần trước thì tái sử dụng, không tạo trùng (409)
    const search = await call('GET', `/customers?search=${encodeURIComponent(CODE_A)}&pageSize=50`, H());
    const existingRow = (search.json?.data || []).find(
      (x) => x.customer?.customerCode === CODE_A && x.departmentSlug === 'laptop',
    );
    if (existingRow?.assignmentId) {
      assignmentId = existingRow.assignmentId;
      ok(`Tái sử dụng phân công #${assignmentId} từ lần chạy trước`);
    } else {
      const cr = await call('POST', '/customers', {
        ...H(),
        body: {
          customer_code: CODE_A,
          sap_code: 'KZTA1',
          customer_name: 'Khách test Zalo A',
          department_slug: 'laptop',
          customer_tier: 'KEY',
          sale_id: 1,
        },
      });
      if (cr.status === 409) {
        // Lần chạy trước còn phân công với khách đã bị XOÁ MỀM (danh sách ẩn
        // nên pre-search không thấy): POST vừa kích hoạt lại khách → tìm lại
        // dòng phân công cũ để tái sử dụng
        const s2 = await call('GET', `/customers?search=${encodeURIComponent(CODE_A)}&pageSize=50`, H());
        const row2 = (s2.json?.data || []).find(
          (x) => x.customer?.customerCode === CODE_A && x.departmentSlug === 'laptop',
        );
        assert(row2?.assignmentId, '409 nhưng không tìm lại được phân công cũ');
        assignmentId = row2.assignmentId;
        ok(`Khách tồn tại từ lần trước — tái sử dụng phân công #${assignmentId}`);
      } else {
        assert(cr.status === 201 && cr.json?.assignmentId, `POST /customers HTTP ${cr.status} ${JSON.stringify(cr.json).slice(0, 150)}`);
        assignmentId = cr.json.assignmentId;
        ok('Tạo khách test chưa có link Zalo');
      }
    }

    // 2. Lấy ĐẦY ĐỦ link (kể cả inactive) qua endpoint zalo-accounts riêng —
    //    GET /customers/:id chỉ trả link is_active=true
    const detail = await call('GET', `/customers/${assignmentId}/zalo-accounts`, H());
    existingLinks = detail.json?.zaloAccounts || [];
    for (const z of existingLinks.filter((x) => x.isActive && x.matchMethod === 'manual')) {
      await call('PATCH', `/customers/zalo-links/${z.id}`, { ...H(), body: { is_active: false } });
    }

    // 3. unmatched: khách test phải nằm trong danh sách với lý do chi tiết
    await expect('[K] unmatched chứa khách test + reason/reasonText chi tiết', 200, async () => {
      const r = await call('GET', `/customers/unmatched?search=${encodeURIComponent(CODE_A)}&pageSize=10`, H());
      assert((r.json?.total ?? 0) >= 1, `total=${r.json?.total}`);
      const row = (r.json?.data || []).find((x) => x.assignmentId === assignmentId);
      assert(row, 'không thấy dòng phân công trong unmatched');
      const KNOWN = ['sale_chua_ket_noi_zalo', 'tai_khoan_chua_co_lien_he', 'ten_zalo_thieu_ma_khach', 'ma_khong_xac_dinh_duoc', 'chua_quet'];
      assert(KNOWN.includes(row.reason), `reason=${row.reason} (phải là 1 trong 4 lý do Mục 3)`);
      assert(!!row.reasonText && row.reasonText !== row.reason, 'thiếu reasonText mô tả tiếng Việt');
      return r.status;
    });

    // 4. Lấy 1 liên hệ Zalo thật (đọc chéo DB zalo_automation qua API có sẵn)
    const ctr = await call('GET', '/customers/zalo-contacts?limit=1', H());
    assert((ctr.json?.data || []).length >= 1, 'DB zalo_automation chưa có liên hệ nào để test');
    const contact = ctr.json.data[0];

    // 5. Gắn tay cặp khớp — chỉ admin. Chạy lại: dùng lại link đã có; nếu POST
    //    409 (link tay tồn tại từ lần trước) thì lấy lại chi tiết — tìm theo
    //    matchMethod='manual' thay vì so chuỗi contact id (tránh lệch khoảng
    //    trắng/collation giữa JS và MySQL)
    let link = existingLinks.find(
      (x) => String(x.zaloContactId).trim() === String(contact.zaloContactId).trim(),
    );
    if (!link) {
      const cr = await call('POST', '/customers/zalo-links', {
        ...H(),
        body: {
          assignment_id: assignmentId,
          zalo_contact_id: contact.zaloContactId,
          zalo_account_id: contact.accountId,
        },
      });
      if (cr.status === 409) {
        // GET /customers/:id chỉ trả link active — dùng zalo-accounts cho ĐỦ list
        const d2 = await call('GET', `/customers/${assignmentId}/zalo-accounts`, H());
        link = (d2.json?.zaloAccounts || []).find((x) => x.matchMethod === 'manual');
        assert(link, '409 nhưng không thấy link manual nào trong danh sách zalo-accounts');
      } else {
        assert(cr.status === 201, `POST /customers/zalo-links HTTP ${cr.status} ${JSON.stringify(cr.json).slice(0, 150)}`);
        link = cr.json;
      }
      assert(link.matchMethod === 'manual', `matchMethod=${link.matchMethod}`);
      ok(`Gắn tay cặp khớp #${link.id} (manual)`);
    } else {
      ok(`Dùng lại cặp khớp tay #${link.id} từ lần chạy trước`);
    }
    linkId = link.id;
    // Snapshot existingLinks có thể đã cũ (bước 2 vừa tắt link này) — bật lại
    // vô điều kiện để các case sau nhìn thấy link active
    await call('PATCH', `/customers/zalo-links/${linkId}`, { ...H(), body: { is_active: true } });

    // 6. Chi tiết phân công + chi tiết cặp khớp
    await expect('[K] GET /customers/:id thấy link manual trong zaloAccounts', 200, async () => {
      const r = await call('GET', `/customers/${assignmentId}`, H());
      const z = (r.json?.zaloAccounts || []).find((x) => x.id === linkId);
      assert(z, 'không thấy link trong zaloAccounts');
      assert(z.matchMethod === 'manual' && z.isActive === true, `z=${JSON.stringify(z)}`);
      return r.status;
    });
    await expect('[K] GET zalo-links/:id → 200 đúng cặp', 200, async () => {
      const r = await call('GET', `/customers/zalo-links/${linkId}`, H());
      assert(r.json?.id === linkId, `body=${JSON.stringify(r.json).slice(0, 100)}`);
      return r.status;
    });

    // 7. PATCH sửa tay bật/tắt — matchMethod giữ nguyên 'manual' (job không ghi đè)
    await expect('[K] PATCH zalo-links is_active=false → 200 vẫn manual', 200, async () => {
      const r = await call('PATCH', `/customers/zalo-links/${linkId}`, { ...H(), body: { is_active: false } });
      assert(r.json?.isActive === false && r.json?.matchMethod === 'manual', `body=${JSON.stringify(r.json).slice(0, 150)}`);
      return r.status;
    });
    await expect('[K] PATCH is_active=true phục hồi → 200', 200, async () => {
      const r = await call('PATCH', `/customers/zalo-links/${linkId}`, { ...H(), body: { is_active: true } });
      assert(r.json?.isActive === true, `body=${JSON.stringify(r.json).slice(0, 100)}`);
      return r.status;
    });

    // 8. Chỉ quản trị viên được sửa tay/gắn tay
    const roleId = await findRoleId('manager-khach-hang');
    assert(roleId, 'thiếu role manager-khach-hang — seed nhóm quyền đã chạy chưa?');
    await ensureTestUser('kpi_test_manager_khach_hang', [roleId]);
    const lr = await call('POST', '/auth/login', { body: { username: 'kpi_test_manager_khach_hang', password: DEFAULT_PASSWORD } });
    const managerToken = lr.json?.access_token || lr.json?.token || lr.json?.accessToken;
    assert(managerToken, `Login manager HTTP ${lr.status}`);
    await expect('[K] Manager sửa tay cặp khớp → 403 (chỉ admin)', 403,
      async () => (await call('PATCH', `/customers/zalo-links/${linkId}`, { token: managerToken, body: { is_active: false } })).status);
    await expect('[K] Manager gắn tay cặp mới → 403 (chỉ admin)', 403,
      async () => (await call('POST', '/customers/zalo-links', { token: managerToken, body: { assignment_id: assignmentId, zalo_contact_id: contact.zaloContactId } })).status);

    // 9. Dữ liệu sai → 400; cặp khớp không tồn tại → 404
    await expect('[K] POST zalo-links liên hệ không tồn tại → 400', 400,
      async () => (await call('POST', '/customers/zalo-links', { ...H(), body: { assignment_id: assignmentId, zalo_contact_id: 'khong_ton_tai_xyz' } })).status);
    await expect('[K] PATCH zalo-links id ảo → 404', 404,
      async () => (await call('PATCH', '/customers/zalo-links/99999999', { ...H(), body: { is_active: false } })).status);

    // 10. Xoá mềm khách test — không để rác trong unmatched
    await expect('[K] DELETE khách test → 200', 200,
      async () => (await call('DELETE', `/customers/${assignmentId}`, H())).status);
    assignmentId = null;
  } catch (e) {
    bad('[K] Chuẩn bị', e.message);
  }
  // User manager test GIỮ ACTIVE (quyết định 10/07)
}

// ============ L. JOB KHỚP PYTHON END-TO-END (spawn one-shot + đối chiếu DB) ============
console.log('\n-- L. Job tự khớp Python end-to-end (Mục 3 cv 1) --');
{
  const require2 = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
  const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pythonRepo = path.resolve(backendRoot, '..', 'core-python-backend');
  const parseEnvFile = (file) => {
    const env = {};
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    } catch {}
    return env;
  };

  let mysql = null;
  try { mysql = require2('mysql2/promise'); } catch {}
  const matcherFile = path.join(pythonRepo, 'src', 'services', 'common', 'customer_zalo_matcher_service.py');
  if (!mysql || !existsSync(matcherFile)) {
    console.log('  ⏭️ Bỏ qua nhóm L (thiếu mysql2 hoặc không tìm thấy core-python-backend)');
  } else {
    const backendEnv = parseEnvFile(path.join(backendRoot, '.env'));
    const pyEnv = parseEnvFile(path.join(pythonRepo, '.env'));
    const tag = Date.now().toString(36).slice(-6);
    const runMatcher = () => {
      const args = ['-m', 'src.services.common.customer_zalo_matcher_service'];
      let r = spawnSync(process.platform === 'win32' ? 'py' : 'python3', args, {
        cwd: pythonRepo, encoding: 'utf8', timeout: 120000,
      });
      if (r.error) {
        r = spawnSync('python', args, { cwd: pythonRepo, encoding: 'utf8', timeout: 120000 });
      }
      const m = (r.stdout || '').match(/summary: (\{.*\})/);
      if (!m) return null;
      try {
        return JSON.parse(m[1]);
      } catch {
        // summary in bằng dict repr của Python (nháy đơn) — đổi sang JSON
        return JSON.parse(m[1].replace(/'/g, '"'));
      }
    };

    let mainConn = null;
    let zaloConn = null;
    let saleUserId = null;
    let accountId = null;
    const assignmentIds = {};
    const contactIds = ['kpi_t1', 'kpi_t2', 'kpi_t3', 'kpi_t4'];
    const CODES = {
      mtcA: `KPI_MTC_${tag}A`,
      mtcB: `KPI_MTC_${tag}B`,
      fbc: `KPI_FBC_${tag}`,
      stl: `KPI_STL_${tag}`,
      neg: `KPI_NEG_${tag}`,
    };

    const cleanup = async () => {
      const ids = Object.values(assignmentIds);
      try { if (zaloConn && accountId) {
        await zaloConn.query('DELETE FROM zalo_contacts WHERE zalo_account_id = ?', [accountId]);
        await zaloConn.query('DELETE FROM zalo_accounts WHERE id = ?', [accountId]);
      } } catch {}
      try { if (mainConn && ids.length) {
        await mainConn.query('DELETE FROM customer_zalo WHERE assignment_id IN (?)', [ids]);
        await mainConn.query('DELETE FROM customer_zalo_scan_results WHERE assignment_id IN (?)', [ids]);
      } } catch {}
      for (const id of ids) { try { await call('DELETE', `/customers/${id}`, H()); } catch {} }
      // sale test GIỮ ACTIVE (quyết định 10/07) — tài khoản Zalo giả vẫn xoá
      for (const c of [mainConn, zaloConn]) { try { if (c) await c.end(); } catch {} }
    };

    try {
      // 1. Sale test + tài khoản Zalo giả (SQL trực tiếp DB Zalo — quyền của test, không phải NestJS)
      saleUserId = await ensureTestUser('kpi_zalo_sale_t', []);
      ok(`Chuẩn bị sale test #${saleUserId} (không role, chỉ làm chủ tài khoản Zalo)`);
      zaloConn = await mysql.createConnection({
        host: pyEnv.ZALO_DB_HOST || pyEnv.DB_HOST,
        user: pyEnv.ZALO_DB_USER || pyEnv.DB_USER,
        password: pyEnv.ZALO_DB_PASS || pyEnv.DB_PASS,
        database: pyEnv.ZALO_DB_NAME || 'zalo_automation',
      });
      mainConn = await mysql.createConnection({
        host: backendEnv.DB_HOST, port: +(backendEnv.DB_PORT || 3306),
        user: backendEnv.DB_USERNAME, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME,
      });
      // Dọn tài khoản test CŨ của user này nếu lần chạy trước bị ngắt giữa chừng
      // (user_id có UNIQUE — không tự dọn sẽ Duplicate entry)
      const [oldAccs] = await zaloConn.query('SELECT id FROM zalo_accounts WHERE user_id = ?', [saleUserId]);
      if (oldAccs.length) {
        const oldIds = oldAccs.map((a) => a.id);
        await mainConn.query('DELETE FROM customer_zalo WHERE zalo_account_id IN (?)', [oldIds]);
        await mainConn.query('DELETE FROM customer_zalo_scan_results WHERE zalo_account_id IN (?)', [oldIds]);
        for (const oid of oldIds) {
          await zaloConn.query('DELETE FROM zalo_contacts WHERE zalo_account_id = ?', [oid]);
          await zaloConn.query('DELETE FROM zalo_accounts WHERE id = ?', [oid]);
        }
        ok(`Dọn ${oldIds.length} tài khoản test cũ còn sót (lần chạy trước bị ngắt)`);
      }
      // zalo_accounts.user_id có FK về bảng users MIRROR trong DB zalo_automation
      // (không phải users của main DB) — đảm bảo dòng mirror tồn tại cho sale test
      await zaloConn.query(
        'INSERT INTO users (id, username, full_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
        [saleUserId, `kpi_zalo_sale_${saleUserId}`, 'Sale Test Khớp'],
      );
      const [ins] = await zaloConn.query(
        'INSERT INTO zalo_accounts (zalo_username, zalo_id, display_name, is_active, user_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, NOW(), NOW())',
        [`kpi_test_sale_${tag}`, `kpi_zalo_id_${tag}`, 'Sale Test Khớp', saleUserId],
      );
      accountId = Number(ins.insertId);

      // 2. 5 khách test qua API (mã có tag riêng từng lần chạy → không đụng dữ liệu cũ)
      for (const [key, code] of Object.entries(CODES)) {
        const r = await call('POST', '/customers', {
          ...H(),
          body: {
            customer_code: code, sap_code: `L${tag}${key.slice(0, 2)}`,
            customer_name: `Khách test L ${key}`, department_slug: 'laptop',
            customer_tier: 'KEY', sale_id: saleUserId,
          },
        });
        assert(r.status === 201 && r.json?.assignmentId, `POST /customers ${code} HTTP ${r.status}`);
        assignmentIds[key] = r.json.assignmentId;
      }
      ok('Tạo 5 khách test: 2 xung đột + 1 dán-liền + 1 stale + 1 không-có-mã');

      // 3. 4 liên hệ Zalo giả: xung đột / dán-liền / stale / nhiễu
      const contacts = [
        ['kpi_t1', `${CODES.mtcA} và ${CODES.mtcB} - Trịnh Văn`],
        ['kpi_t2', `${CODES.fbc}_99090 - Nguyễn B`],
        ['kpi_t3', `${CODES.stl} - Trần C`],
        ['kpi_t4', 'Liên hệ không mã khách - 0909123456'],
      ];
      for (const [cid, name] of contacts) {
        await zaloConn.query(
          'INSERT INTO zalo_contacts (zalo_account_id, display_name, zalo_contact_id, is_active, is_blocked, is_favorite, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, NOW(), NOW())',
          [accountId, name, cid],
        );
      }

      // Pre-flight: xác nhận dữ liệu nhìn thấy được từ KẾT NỐI KHÁC (đúng điều
      // kiện matcher sẽ gặp) trước khi spawn
      const freshZalo = await mysql.createConnection({
        host: pyEnv.ZALO_DB_HOST || pyEnv.DB_HOST,
        user: pyEnv.ZALO_DB_USER || pyEnv.DB_USER,
        password: pyEnv.ZALO_DB_PASS || pyEnv.DB_PASS,
        database: pyEnv.ZALO_DB_NAME || 'zalo_automation',
      });
      const [accCheck] = await freshZalo.query(
        'SELECT id, user_id, is_active FROM zalo_accounts WHERE user_id IS NOT NULL AND is_active = 1 ORDER BY id',
      );
      const [asgCheck] = await mainConn.query(
        "SELECT COUNT(*) AS n FROM customer_assignments a JOIN customers c ON c.id = a.customer_id WHERE a.sale_id = ? AND c.status <> 'deleted'",
        [saleUserId],
      );
      await freshZalo.end();
      ok(`Pre-flight: matcher sẽ thấy ${accCheck.length} tài khoản (${accCheck.map((a) => `#${a.id}/u${a.user_id}`).join(', ')}) và ${asgCheck[0].n} phân công của sale #${saleUserId}`);
      assert(accCheck.some((a) => Number(a.id) === accountId), 'tài khoản test KHÔNG nhìn thấy được từ kết nối khác');
      assert(Number(asgCheck[0].n) === 5, `phân công sale test = ${asgCheck[0].n} (kỳ vọng 5)`);

      // 4. Chạy job lần 1 — assert TRẠNG THÁI qua per_sale, KHÔNG assert số lần
      //    tạo: matcher nền (run_common_services, mỗi 5′) có thể đã khớp trước
      const s1 = runMatcher();
      assert(s1, 'job không in được summary — chạy tay: py -m src.services.common.customer_zalo_matcher_service');
      ok(`Run 1 full summary: ${JSON.stringify(s1)}`);
      const saleRow = (s1.per_sale || []).find((x) => x.sale_id === saleUserId);
      assert(saleRow && saleRow.codes === 5, `per_sale sale #${saleUserId}: codes=${saleRow?.codes} (kỳ vọng 5)`);
      assert(saleRow.contacts === 4, `contacts=${saleRow.contacts} (kỳ vọng 4 liên hệ)`);
      assert(saleRow.found === 4, `found=${saleRow.found} (kỳ vọng 4 — đủ 4 liên hệ chứa mã)`);

      // 5. Đối chiếu DB: khớp đúng vị trí, xung đột inactive, khách không mã được đánh dấu
      await expect('[L] Khớp dán-liền: auto_code + active + position start', 200, async () => {
        const [rows] = await mainConn.query('SELECT zalo_contact_id, matched_name, matched_position, match_method, is_active FROM customer_zalo WHERE assignment_id = ?', [assignmentIds.fbc]);
        assert(rows.length === 1, `rows=${rows.length}`);
        assert(rows[0].zalo_contact_id === 'kpi_t2' && rows[0].match_method === 'auto_code' && rows[0].is_active === 1, JSON.stringify(rows[0]));
        assert(rows[0].matched_position === 'start', `position=${rows[0].matched_position}`);
        assert(rows[0].matched_name.includes(`${CODES.fbc}_99090`), 'matched_name sai');
        return 200;
      });
      await expect('[L] Xung đột 2 mã hoà độ dài → cả 2 bản ghi inactive', 200, async () => {
        const [rows] = await mainConn.query('SELECT assignment_id, is_active FROM customer_zalo WHERE assignment_id IN (?)', [[assignmentIds.mtcA, assignmentIds.mtcB]]);
        assert(rows.length === 2 && rows.every((r) => r.is_active === 0), JSON.stringify(rows));
        return 200;
      });
      await expect('[L] Scan: khách có mã=1, không mã=0, đúng số liên hệ', 200, async () => {
        const [rows] = await mainConn.query('SELECT assignment_id, code_found, contacts_scanned, zalo_account_id FROM customer_zalo_scan_results WHERE assignment_id IN (?)', [Object.values(assignmentIds)]);
        assert(rows.length === 5, `scan rows=${rows.length}`);
        const byId = new Map(rows.map((r) => [Number(r.assignment_id), r]));
        assert(Number(byId.get(assignmentIds.fbc).code_found) === 1, 'FBC phải code_found=1');
        assert(Number(byId.get(assignmentIds.neg).code_found) === 0, 'NEG phải code_found=0');
        assert(Number(byId.get(assignmentIds.neg).contacts_scanned) === 4, 'NEG phải thấy 4 liên hệ');
        assert(byId.get(assignmentIds.neg).zalo_account_id === accountId, 'zalo_account_id sai');
        return 200;
      });

      // 6. Chạy lần 2 → idempotent, không ghi thêm gì
      const s2 = runMatcher();
      assert(s2 && s2.created === 0 && s2.updated === 0 && s2.scan_written === 0,
        `lần 2 phải 0/0/0, nhận created=${s2?.created} updated=${s2?.updated} scan_written=${s2?.scan_written}`);
      ok('Run 2: idempotent (created 0, updated 0, scan_written 0)');

      // 7. Tên đổi → chỉ ngừng kích hoạt bản ghi auto (giữ dòng)
      await zaloConn.query('UPDATE zalo_contacts SET display_name = ? WHERE zalo_contact_id = ?', ['Nguyễn B đổi tên rồi không còn mã', 'kpi_t2']);
      const s3 = runMatcher();
      await expect('[L] Tên đổi → bản ghi auto bị ngừng kích hoạt (is_active=0, giữ dòng)', 200, async () => {
        const [rows] = await mainConn.query('SELECT is_active FROM customer_zalo WHERE assignment_id = ?', [assignmentIds.fbc]);
        assert(rows.length === 1 && rows[0].is_active === 0, JSON.stringify(rows));
        return 200;
      });

      // 8. Sửa tay (manual) → job không đụng tới nữa
      const stlLink = await call('GET', `/customers/${assignmentIds.stl}`, H());
      const linkId = (stlLink.json?.zaloAccounts || []).find((z) => z.isActive && z.matchMethod === 'auto_code')?.id;
      assert(linkId, 'không thấy link auto của STL để sửa tay');
      await call('PATCH', `/customers/zalo-links/${linkId}`, { ...H(), body: { is_active: false } });
      const s4 = runMatcher();
      assert(s4 && s4.skipped_manual >= 1, `skipped_manual=${s4?.skipped_manual}`);
      await expect('[L] Bản ghi manual giữ nguyên — job không ghi đè, không tạo auto mới', 200, async () => {
        const [rows] = await mainConn.query('SELECT match_method, is_active FROM customer_zalo WHERE assignment_id = ?', [assignmentIds.stl]);
        assert(rows.length === 1, `phải có đúng 1 dòng, nhận ${rows.length}`);
        assert(rows[0].match_method === 'manual' && rows[0].is_active === 0, JSON.stringify(rows[0]));
        return 200;
      });

      // 9. Lý do unmatched đọc từ bảng scan (qua API backend)
      await expect('[L] unmatched khách không-có-mã → ten_zalo_thieu_ma_khach', 200, async () => {
        const r = await call('GET', `/customers/unmatched?search=${encodeURIComponent(CODES.neg)}&pageSize=10`, H());
        const row = (r.json?.data || []).find((x) => x.assignmentId === assignmentIds.neg);
        assert(row, 'không thấy NEG trong unmatched');
        assert(row.reason === 'ten_zalo_thieu_ma_khach', `reason=${row.reason}`);
        return r.status;
      });
    } catch (e) {
      bad('[L] Chuẩn bị/chạy job', e.message);
    }
    await cleanup();
  }
}

// ============ M. MỤC 4 — ROLLUP ĐÊM + ENGINE CHẤM ĐIỂM + CHỈ TIÊU + GỢI Ý + EXPORT ============
console.log('\n-- M. Mục 4: rollup Python → engine KPI → chỉ tiêu → gợi ý → export --');
{
  const require2 = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
  const backendRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pythonRepo = path.resolve(backendRoot, '..', 'core-python-backend');
  const parseEnvFile = (file) => {
    const env = {};
    try {
      for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const i = line.indexOf('=');
        if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
    } catch {}
    return env;
  };

  let mysql = null;
  try { mysql = require2('mysql2/promise'); } catch {}
  const rollupFile = path.join(pythonRepo, 'src', 'services', 'common', 'customer_kpi_rollup_service.py');
  if (!mysql || !existsSync(rollupFile)) {
    console.log('  ⏭️ Bỏ qua nhóm M (thiếu mysql2 hoặc không tìm thấy core-python-backend)');
  } else {
    const backendEnv = parseEnvFile(path.join(backendRoot, '.env'));
    const pyEnv = parseEnvFile(path.join(pythonRepo, '.env'));
    const tag = `m${Date.now().toString(36).slice(-6)}`;

    const runRollup = () => {
      const args = ['-m', 'src.services.common.customer_kpi_rollup_service'];
      let r = spawnSync(process.platform === 'win32' ? 'py' : 'python3', args, {
        cwd: pythonRepo, encoding: 'utf8', timeout: 300000,
      });
      if (r.error) {
        r = spawnSync('python', args, { cwd: pythonRepo, encoding: 'utf8', timeout: 300000 });
      }
      const m = (r.stdout || '').match(/summary: (\{.*\})/);
      if (!m) return null;
      try {
        return JSON.parse(m[1]);
      } catch {
        return JSON.parse(m[1].replace(/'/g, '"'));
      }
    };

    const dayStr = (offset) => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const TODAY = dayStr(0);
    const YESTERDAY = dayStr(-1);
    const MONTH = TODAY.slice(0, 7);

    let mainConn = null;
    let zaloConn = null;
    let saleUserId = null;
    let accountId = null;
    let oldZaloStatus = null;
    let userRid = null;
    let lowUserId = null;
    const asgIds = {};
    const customerIds = {};
    const convIds = {};
    const orderIds = [];
    const requestIds = [];
    const CONTACTS = { key: `kpi_r_${tag}_k`, non: `kpi_r_${tag}_n` };
    const CODES = { key: `KPI_RLP_${tag}K`, non: `KPI_RLP_${tag}N` };

    const cleanup = async () => {
      const ids = Object.values(asgIds);
      try {
        if (zaloConn && accountId) {
          await zaloConn.query('DELETE FROM zalo_messages WHERE conversation_id IN (?)', [Object.values(convIds)]);
          await zaloConn.query('DELETE FROM zalo_conversations WHERE zalo_account_id = ?', [accountId]);
          await zaloConn.query('DELETE FROM zalo_contacts WHERE zalo_account_id = ?', [accountId]);
          await zaloConn.query('DELETE FROM zalo_accounts WHERE id = ?', [accountId]);
        }
      } catch {}
      try {
        if (mainConn) {
          if (orderIds.length) {
            await mainConn.query('DELETE FROM order_details WHERE order_id IN (?)', [orderIds]);
            await mainConn.query('DELETE FROM orders WHERE id IN (?)', [orderIds]);
          }
          if (saleUserId) await mainConn.query('DELETE FROM sale_response_intervals WHERE user_id = ?', [saleUserId]);
          if (ids.length) {
            await mainConn.query('DELETE FROM customer_activity_daily WHERE assignment_id IN (?)', [ids]);
            await mainConn.query('DELETE FROM customer_response_daily WHERE assignment_id IN (?)', [ids]);
            await mainConn.query('DELETE FROM customer_zalo WHERE assignment_id IN (?)', [ids]);
            await mainConn.query('DELETE FROM customer_zalo_scan_results WHERE assignment_id IN (?)', [ids]);
          }
          if (saleUserId) await mainConn.query('DELETE FROM kpi_targets WHERE sale_id = ?', [saleUserId]);
          if (requestIds.length) {
            await mainConn.query('DELETE FROM approval_request_target_items WHERE request_id IN (?)', [requestIds]);
            await mainConn.query('DELETE FROM approval_requests WHERE id IN (?)', [requestIds]);
          }
          if (saleUserId && oldZaloStatus !== null) {
            await mainConn.query('UPDATE users SET zalo_link_status = ? WHERE id = ?', [oldZaloStatus, saleUserId]);
          }
        }
      } catch {}
      for (const id of ids) { try { await call('DELETE', `/customers/${id}`, H()); } catch {} }
      for (const c of [mainConn, zaloConn]) { try { if (c) await c.end(); } catch {} }
    };

    try {
      // 1. Sale test + tài khoản Zalo thật (SQL trực tiếp DB Zalo như nhóm L)
      saleUserId = await ensureTestUser('kpi_kpi_sale_t', []);
      mainConn = await mysql.createConnection({
        host: backendEnv.DB_HOST, port: +(backendEnv.DB_PORT || 3306),
        user: backendEnv.DB_USERNAME, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME,
      });
      zaloConn = await mysql.createConnection({
        host: pyEnv.ZALO_DB_HOST || pyEnv.DB_HOST,
        user: pyEnv.ZALO_DB_USER || pyEnv.DB_USER,
        password: pyEnv.ZALO_DB_PASS || pyEnv.DB_PASS,
        database: pyEnv.ZALO_DB_NAME || 'zalo_automation',
      });
      const [oldAccs] = await zaloConn.query('SELECT id FROM zalo_accounts WHERE user_id = ?', [saleUserId]);
      if (oldAccs.length) {
        const oldIds = oldAccs.map((a) => a.id);
        await mainConn.query('DELETE FROM customer_zalo WHERE zalo_account_id IN (?)', [oldIds]);
        await mainConn.query('DELETE FROM customer_zalo_scan_results WHERE zalo_account_id IN (?)', [oldIds]);
        for (const oid of oldIds) {
          await zaloConn.query('DELETE FROM zalo_messages WHERE conversation_id IN (SELECT id FROM zalo_conversations WHERE zalo_account_id = ?)', [oid]);
          await zaloConn.query('DELETE FROM zalo_conversations WHERE zalo_account_id = ?', [oid]);
          await zaloConn.query('DELETE FROM zalo_contacts WHERE zalo_account_id = ?', [oid]);
          await zaloConn.query('DELETE FROM zalo_accounts WHERE id = ?', [oid]);
        }
      }
      await zaloConn.query(
        'INSERT INTO users (id, username, full_name) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id = id',
        [saleUserId, `kpi_kpi_sale_${saleUserId}`, 'Sale Test KPI'],
      );
      const [ins] = await zaloConn.query(
        'INSERT INTO zalo_accounts (zalo_username, zalo_id, display_name, is_active, user_id, created_at, updated_at) VALUES (?, ?, ?, 1, ?, NOW(), NOW())',
        [`kpi_kpi_sale_${tag}`, `kpi_kpi_zalo_${tag}`, 'Sale Test KPI', saleUserId],
      );
      accountId = Number(ins.insertId);
      // sale phải "đang online Zalo" để rollup ghi zalo_linked = 1
      const [urows] = await mainConn.query('SELECT zalo_link_status FROM users WHERE id = ?', [saleUserId]);
      oldZaloStatus = Number(urows[0]?.zalo_link_status ?? 0);
      await mainConn.query('UPDATE users SET zalo_link_status = 1 WHERE id = ?', [saleUserId]);
      ok(`Chuẩn bị sale test #${saleUserId} + tài khoản Zalo #${accountId} (zalo_link_status=1)`);

      // 2. 2 khách test: KEY (có hội thoại) + NON (khách nhắn chưa được phản hồi)
      for (const [key, code] of Object.entries(CODES)) {
        const r = await call('POST', '/customers', {
          ...H(),
          body: {
            customer_code: code, sap_code: `L${tag}${key}`,
            customer_name: `Khách test M ${key}`, department_slug: 'laptop',
            customer_tier: key === 'key' ? 'KEY' : 'NON', sale_id: saleUserId,
          },
        });
        assert(r.status === 201 && r.json?.assignmentId, `POST /customers ${code} HTTP ${r.status}`);
        asgIds[key] = r.json.assignmentId;
      }
      const [asgRows] = await mainConn.query('SELECT id, customer_id FROM customer_assignments WHERE id IN (?)', [Object.values(asgIds)]);
      for (const row of asgRows) {
        const key = Number(row.id) === asgIds.key ? 'key' : 'non';
        customerIds[key] = Number(row.customer_id);
      }
      ok('Tạo 2 khách test (KEY + NON) qua API');

      // 3. Liên hệ + hội thoại + tin nhắn + đơn + khoảng chờ (data nguồn thật trong DB)
      const contactRowIds = {};
      for (const [key, cid] of Object.entries(CONTACTS)) {
        const [cins] = await zaloConn.query(
          'INSERT INTO zalo_contacts (zalo_account_id, display_name, zalo_contact_id, is_active, is_blocked, is_favorite, created_at, updated_at) VALUES (?, ?, ?, 1, 0, 0, NOW(), NOW())',
          [accountId, `Khách test M ${key} (${cid})`, cid],
        );
        contactRowIds[key] = Number(cins.insertId);
      }
      // sender_id có FK thật sang zalo_contacts.id (mục 4.5) — phải là số int của dòng liên hệ
      const convSrc = {
        key: {
          contactKey: 'key',
          messages: [
            // hôm nay: khách nhắn 2, sale nhắn 3 (two-way) — support + phản hồi đạt
            [0, `${TODAY} 09:01:00`, 'Khách hỏi giá'],
            [0, `${TODAY} 09:02:00`, 'Khách hỏi bảo hành'],
            [1, `${TODAY} 09:05:00`, 'Sale trả lời'],
            [1, `${TODAY} 09:06:00`, 'Sale gửi bảng giá'],
            [1, `${TODAY} 09:07:00`, 'Sale chào khách'],
          ],
        },
        non: {
          contactKey: 'non',
          messages: [
            // hôm qua: khách nhắn 2, sale CHƯA trả lời → gợi ý "chưa phản hồi"
            [0, `${YESTERDAY} 15:01:00`, 'Khách nhắn chưa được trả lời 1'],
            [0, `${YESTERDAY} 15:02:00`, 'Khách nhắn chưa được trả lời 2'],
          ],
        },
      };
      for (const [key, spec] of Object.entries(convSrc)) {
        const cid = CONTACTS[spec.contactKey];
        const [cins] = await zaloConn.query(
          "INSERT INTO zalo_conversations (zalo_conversation_id, conversation_type, zalo_account_id, conversation_name, created_at, updated_at) VALUES (?, 'private', ?, ?, NOW(), NOW())",
          [cid, accountId, `Hội thoại test ${cid}`],
        );
        convIds[cid] = Number(cins.insertId);
        for (const [outgoing, ts, content] of spec.messages) {
          await zaloConn.query(
            'INSERT INTO zalo_messages (conversation_id, sender_id, content, is_outgoing, timestamp, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            // sender_id có FK thật → zalo_contacts.id — dùng id dòng liên hệ cho cả 2 chiều
            [convIds[cid], contactRowIds[spec.contactKey], content, outgoing, ts],
          );
        }
      }
      // đơn hàng gắn với khách KEY hôm nay (revenue = completed × unit_price × quantity)
      const [oinst] = await mainConn.query(
        'INSERT INTO orders (conversation_id, sale_by, created_at, updated_at) VALUES (?, ?, ?, NOW())',
        [convIds[CONTACTS.key], saleUserId, `${TODAY} 11:00:00`],
      );
      orderIds.push(Number(oinst.insertId));
      await mainConn.query(
        "INSERT INTO order_details (order_id, metadata, unit_price, quantity, status, created_at, updated_at) VALUES (?, ?, 100000, 2, 'completed', ?, NOW())",
        [orderIds[0], JSON.stringify({ customer_id: CONTACTS.key, conversation_info: { is_group: 'false' } }), `${TODAY} 11:00:00`],
      );
      // khoảng chờ phản hồi: 2 responded (60s, 180s) hôm nay + 1 no_reply hôm qua
      const msgBase = 9100000000 + (Date.now() % 100000000);
      await mainConn.query(
        `INSERT INTO sale_response_intervals
         (conversation_id, zalo_account_id, user_id, zalo_contact_id, first_inbound_message_id, inbound_message_count, started_at, ended_at, duration_seconds, wall_duration_seconds, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, 60, 65, 'responded', NOW(), NOW()),
                (?, ?, ?, ?, ?, 1, ?, ?, 180, 200, 'responded', NOW(), NOW()),
                (?, ?, ?, ?, ?, 1, ?, NULL, NULL, 3000, 'no_reply', NOW(), NOW())`,
        [
          convIds[CONTACTS.key], accountId, saleUserId, CONTACTS.key, msgBase, `${TODAY} 09:01:00`, `${TODAY} 09:02:00`,
          convIds[CONTACTS.key], accountId, saleUserId, CONTACTS.key, msgBase + 1, `${TODAY} 09:02:30`, `${TODAY} 09:05:30`,
          convIds[CONTACTS.key], accountId, saleUserId, CONTACTS.key, msgBase + 2, `${YESTERDAY} 09:00:00`,
        ],
      );
      // lịch sử "bị bỏ bê" trước cửa sổ 7 ngày của rollup: 1 dòng zalo_linked
      // đủ để chấm goi_y_thuc_hien cho HÔM NAY (cần 7 ngày không có tin đi)
      await mainConn.query(
        'INSERT INTO customer_activity_daily (assignment_id, stat_date, inbound_count, outbound_count, order_count, revenue, zalo_linked, created_at, updated_at) VALUES (?, ?, 0, 0, 0, 0, 1, NOW(), NOW())',
        [asgIds.key, dayStr(-7)],
      );
      ok('Tạo liên hệ, hội thoại, tin nhắn, đơn hàng, khoảng chờ (data nguồn)');

      // 4. customer_zalo khớp sẵn (match_method = manual để matcher nền không đụng)
      await mainConn.query(
        `INSERT INTO customer_zalo (assignment_id, zalo_account_id, zalo_contact_id, matched_name, matched_position, match_method, is_active, last_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'only', 'manual', 1, NOW(), NOW(), NOW()), (?, ?, ?, ?, 'only', 'manual', 1, NOW(), NOW(), NOW())`,
        [asgIds.key, accountId, CONTACTS.key, `Khách test M key (${CONTACTS.key})`,
         asgIds.non, accountId, CONTACTS.non, `Khách test M non (${CONTACTS.non})`],
      );
      const s1 = runRollup();
      assert(s1, 'rollup không in được summary — chạy tay: py -m src.services.common.customer_kpi_rollup_service');
      ok(`Rollup 1: ${JSON.stringify(s1)}`);
      assert(s1.linked_assignments >= 2, `linked_assignments=${s1.linked_assignments} (kỳ vọng ≥2)`);
      assert(s1.activity_rows >= 14, `activity_rows=${s1.activity_rows} (kỳ vọng ≥14: 2 phân công × 7 ngày)`);
      assert(s1.response_rows >= 2, `response_rows=${s1.response_rows} (kỳ vọng ≥2: hôm nay + hôm qua)`);
      assert(s1.conversations >= 2, `conversations=${s1.conversations} (kỳ vọng ≥2)`);

      // 5. Đối chiếu DB: đếm đúng 2 chiều + đơn + zalo_linked
      await expect('[M] Activity khách KEY hôm nay: 2 vào/3 ra + 1 đơn 200000 + linked', 200, async () => {
        const [rows] = await mainConn.query(
          'SELECT inbound_count, outbound_count, order_count, revenue, zalo_linked FROM customer_activity_daily WHERE assignment_id = ? AND stat_date = ?',
          [asgIds.key, TODAY],
        );
        assert(rows.length === 1, `rows=${rows.length}`);
        const r = rows[0];
        assert(Number(r.inbound_count) === 2 && Number(r.outbound_count) === 3, JSON.stringify(r));
        assert(Number(r.order_count) === 1 && Number(r.revenue) === 200000, `đơn/doanh thu sai: ${r.order_count}/${r.revenue}`);
        assert(Number(r.zalo_linked) === 1, 'zalo_linked phải = 1');
        return 200;
      });
      await expect('[M] Activity khách NON hôm qua: 2 vào/0 ra (sale chưa trả lời)', 200, async () => {
        const [rows] = await mainConn.query(
          'SELECT inbound_count, outbound_count FROM customer_activity_daily WHERE assignment_id = ? AND stat_date = ?',
          [asgIds.non, YESTERDAY],
        );
        assert(rows.length === 1 && Number(rows[0].inbound_count) === 2 && Number(rows[0].outbound_count) === 0, JSON.stringify(rows));
        return 200;
      });
      await expect('[M] Response daily: hôm nay 2 responded avg 120 + hôm qua 1 no_reply', 200, async () => {
        const [rows] = await mainConn.query(
          'SELECT stat_date, total_intervals, responded_count, no_reply_count, avg_seconds FROM customer_response_daily WHERE assignment_id = ?',
          [asgIds.key],
        );
        assert(rows.length === 2, `rows=${rows.length}`);
        // mysql2 trả DATE là Date local-midnight — lấy ngày theo getFullYear/getMonth/getDate
        const localDate = (v) => {
          const d = v instanceof Date ? v : new Date(v);
          const p = (n) => String(n).padStart(2, '0');
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        };
        const byDate = new Map(rows.map((r) => [localDate(r.stat_date), r]));
        const today = byDate.get(TODAY);
        assert(today && Number(today.total_intervals) === 2 && Number(today.responded_count) === 2 && Number(today.avg_seconds) === 120, JSON.stringify(rows));
        const yest = byDate.get(YESTERDAY);
        assert(yest && Number(yest.no_reply_count) === 1, JSON.stringify(rows));
        return 200;
      });

      // 6. Engine chấm điểm lúc đọc — overview
      await expect('[M] Overview: support 50% (1/2), two-way 50%, gợi ý pass, doanh số no_data', 200, async () => {
        const r = await call('GET', `/customer-kpi-reports/overview?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const sale = (r.json?.sales || []).find((x) => x.saleId === saleUserId);
        assert(sale, 'không thấy sale test trong overview');
        const byKey = new Map(sale.criteria.map((c) => [c.key, c]));
        const support = byKey.get('support_khach');
        assert(support && support.status === 'ratio' && support.actualValue === 50, JSON.stringify(support));
        assert(support.numerator === 1 && support.denominatorValue === 2 && support.totalCriteria === 2, JSON.stringify(support));
        const reply = byKey.get('lien_lac_phan_hoi');
        assert(reply && reply.status === 'ratio' && reply.actualValue === 50, JSON.stringify(reply));
        const ack = byKey.get('goi_y_thuc_hien');
        assert(ack && ack.status === 'pass' && ack.passedCriteria === 1 && ack.totalCriteria === 2, JSON.stringify(ack));
        const rev = byKey.get('doanh_so_key');
        assert(rev && rev.status === 'no_data' && (rev.reason || '').includes('doanh thu'), JSON.stringify(rev));
        return r.status;
      });

      // 7. bySale — từng khách một hàng
      await expect('[M] bySale: 2 khách, đúng totals + trạng thái từng khách', 200, async () => {
        const r = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const sale = (r.json?.sales || []).find((x) => x.saleId === saleUserId);
        assert(sale && sale.customers.length === 2, `customers=${sale?.customers?.length}`);
        const key = sale.customers.find((c) => c.customerCode === CODES.key);
        assert(key, 'không thấy khách KEY');
        assert(key.totals.inbound === 2 && key.totals.outbound === 3 && key.totals.orders === 1 && key.totals.revenue === 200000, JSON.stringify(key.totals));
        assert(key.zaloLinked === true, 'khách KEY phải zaloLinked');
        const ackKey = key.criteria.find((c) => c.key === 'goi_y_thuc_hien');
        assert(ackKey && ackKey.status === 'pass', JSON.stringify(ackKey));
        return r.status;
      });

      // 8. Gợi ý thực hiện — khách NON nhắn chưa được trả lời phải nằm trong danh sách
      await expect('[M] Gợi ý: NON chua_phan_hoi có trong danh sách, KEY không bị gợi ý', 200, async () => {
        const r = await call('GET', `/customer-kpi-reports/suggestions?saleId=${saleUserId}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const sale = (r.json?.sales || []).find((x) => x.saleId === saleUserId);
        assert(sale, 'không thấy sale test trong gợi ý');
        const non = sale.suggestions.find((s) => s.customerCode === CODES.non);
        assert(non && non.reason === 'chua_phan_hoi', JSON.stringify(sale.suggestions));
        assert(!sale.suggestions.some((s) => s.customerCode === CODES.key), 'khách KEY vừa liên lạc không được gợi ý');
        return r.status;
      });

      // 9. Giao chỉ tiêu: admin gán theo sale + theo khách, gán lại là cập nhật
      await expect('[M] POST targets scope=sale (admin) → applied 1', [200, 201], async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'support_khach', period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 80 },
        });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        assert(r.json?.applied === 1, JSON.stringify(r.json));
        return r.status;
      });
      await expect('[M] Gán lại cùng tháng → upsert (vẫn 1 dòng, giá mới 90)', 200, async () => {
        const r2 = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'support_khach', period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 90 },
        });
        assert(r2.status === 200 || r2.status === 201, `HTTP ${r2.status}`);
        const list = await call('GET', `/customer-kpi-targets?criterion_key=support_khach&saleId=${saleUserId}&period_month=${MONTH}`, H());
        assert(list.json?.total === 1, `total=${list.json?.total} — upsert bị nhân bản`);
        assert(Number(list.json.data[0].targetValue) === 90, JSON.stringify(list.json.data));
        return list.status;
      });
      await expect('[M] POST targets scope=customer → chỉ tiêu riêng cho khách KEY', [200, 201], async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'support_khach', period_month: MONTH, scope: 'customer', sale_id: saleUserId, items: [{ customer_id: customerIds.key, target_value: 60 }] },
        });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const list = await call('GET', `/customer-kpi-targets?criterion_key=support_khach&saleId=${saleUserId}&period_month=${MONTH}`, H());
        const perCustomer = list.json.data.find((x) => x.customerId === customerIds.key);
        assert(perCustomer && Number(perCustomer.targetValue) === 60, JSON.stringify(list.json.data));
        return r.status;
      });
      await expect('[M] POST targets cho tiêu chí binary → 400', 400, async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'goi_y_thuc_hien', period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 1 },
        });
        return r.status;
      });
      await expect('[M] POST targets scope=department phòng không có người → 404', 404, async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'support_khach', period_month: MONTH, scope: 'department', department_slug: `khong-ton-tai-${tag}`, target_value: 10 },
        });
        return r.status;
      });

      // 10. Luồng duyệt chỉ tiêu: chờ duyệt → admin duyệt → ghi kpi_targets
      await expect('[M] Đề xuất chỉ tiêu → admin duyệt → ghi 55 vào kpi_targets', [200, 201], async () => {
        const [reqIns] = await mainConn.query(
          "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('kpi_target', ?, ?, 'pending', 'test', NOW(), NOW())",
          [saleUserId, saleUserId],
        );
        requestIds.push(Number(reqIns.insertId));
        await mainConn.query(
          'INSERT INTO approval_request_target_items (request_id, criterion_key, period_month, sale_id, customer_id, old_target_value, new_target_value, created_at) VALUES (?, ?, ?, ?, NULL, 90, 55, NOW())',
          [reqIns.insertId, 'support_khach', MONTH, saleUserId],
        );
        const r = await call('POST', `/approval-requests/${reqIns.insertId}/decide`, { ...H(), body: { action: 'approve' } });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const [trows] = await mainConn.query(
          'SELECT target_value FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = 0',
          ['support_khach', MONTH, saleUserId],
        );
        assert(trows.length === 1 && Number(trows[0].target_value) === 55, JSON.stringify(trows));
        return r.status;
      });
      await expect('[M] Từ chối không kèm lý do → 400', 400, async () => {
        const [reqIns] = await mainConn.query(
          "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('kpi_target', ?, ?, 'pending', 'test', NOW(), NOW())",
          [saleUserId, saleUserId],
        );
        requestIds.push(Number(reqIns.insertId));
        const r = await call('POST', `/approval-requests/${reqIns.insertId}/decide`, { ...H(), body: { action: 'reject' } });
        return r.status;
      });
      await expect('[M] Từ chối kèm lý do → rejected, kpi_targets giữ nguyên', [200, 201], async () => {
        const [reqIns] = await mainConn.query(
          "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('kpi_target', ?, ?, 'pending', 'test', NOW(), NOW())",
          [saleUserId, saleUserId],
        );
        requestIds.push(Number(reqIns.insertId));
        const r = await call('POST', `/approval-requests/${reqIns.insertId}/decide`, { ...H(), body: { action: 'reject', reject_reason: 'chưa hợp lý' } });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}`);
        const [rrows] = await mainConn.query('SELECT status, reject_reason FROM approval_requests WHERE id = ?', [reqIns.insertId]);
        assert(rrows[0].status === 'rejected' && rrows[0].reject_reason === 'chưa hợp lý', JSON.stringify(rrows));
        return r.status;
      });

      // 11. Nhân viên thường không được gán chỉ tiêu
      userRid = await findRoleId('user');
      if (userRid) {
        lowUserId = await ensureTestUser('kpi_kpi_usr_t', [userRid]);
        const lowLogin = await call('POST', '/auth/login', { body: { username: 'kpi_kpi_usr_t', password: DEFAULT_PASSWORD } });
        const lowToken = lowLogin.json?.access_token || lowLogin.json?.token || lowLogin.json?.accessToken;
        await expect('[M] user thường gán chỉ tiêu → 403', 403, async () => {
          const r = await call('POST', '/customer-kpi-targets', {
            token: lowToken,
            body: { criterion_key: 'support_khach', period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 10 },
          });
          return r.status;
        });
      }

      // 12. Export Excel
      await expect('[M] Export → file xlsx có nội dung', 200, async () => {
        const res = await fetch(`${BASE}/customer-kpi-reports/export?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(30000),
        });
        assert(res.status === 200, `HTTP ${res.status}`);
        const ctype = res.headers.get('content-type') || '';
        assert(ctype.includes('spreadsheetml'), `content-type=${ctype}`);
        const buf = Buffer.from(await res.arrayBuffer());
        assert(buf.length > 1000, `file quá nhỏ: ${buf.length} bytes`);
        return 200;
      });

      // 13. Rollup chạy lại → idempotent (upsert theo UNIQUE(assignment, date))
      const s2 = runRollup();
      assert(s2, 'rollup lần 2 không in được summary');
      assert(s2.activity_rows === s1.activity_rows && s2.response_rows === s1.response_rows,
        `lần 2 phải cùng số dòng: ${s2.activity_rows}/${s2.response_rows} vs ${s1.activity_rows}/${s1.response_rows}`);
      ok('Rollup 2: idempotent (cùng số dòng ghi — không nhân bản)');
    } catch (e) {
      bad('[M] Chuẩn bị/chạy rollup + engine', e.message);
    }
    await cleanup();
  }
}

// ============ DỌN DẸP AN TOÀN ============
if (createdId) {
  try { await call('DELETE', `/customer-kpi-definitions/${createdId}`, H()); } catch {}
}

// ============ TONG KET ============
console.log(`\n== KẾT QUẢ: ${pass} đạt / ${fail} lỗi ==`);
console.log(`⏱ Tổng thời gian: ${((Date.now() - T0) / 1000).toFixed(1)}s`);
if (failures.length) {
  console.log('Chi tiết lỗi:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log('Tất cả testcase đều đạt.');
