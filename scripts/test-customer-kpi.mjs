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
  if (msg.trimStart().startsWith('--')) {
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
await expect('GET /customer-kpi-reports/by-sale thiếu saleId → 400 (hợp đồng mới, nhóm M test nội dung)', 400,
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

  // Nhân viên bulk-update → ĐỀ XUẤT chờ duyệt (bỏ 501 — khớp hợp đồng mục 2.7)
  try {
    const empUsername = 'kpi_test_user_khach_hang';
    const empId = await ensureTestUser(empUsername, [roleIdByName['user-khach-hang']]);
    const lr = await call('POST', '/auth/login', {
      body: { username: empUsername, password: DEFAULT_PASSWORD },
    });
    const empToken = lr.json?.access_token || lr.json?.token || lr.json?.accessToken;
    assert(empToken, 'login nhân viên test thất bại');

    let bulkAssignmentId = null;
    await expect('POST /customers (tạo phân công cho nhân viên test) → 201', 201, async () => {
      const r = await call('POST', '/customers', { ...H(), body: {
        customer_code: `TEST_AUTO_BULK_${Date.now()}`,
        customer_name: 'Khách test bulk đề xuất',
        department_slug: 'laptop',
        sale_id: empId,
        customer_tier: 'KEY',
      } });
      bulkAssignmentId = r.json?.assignmentId;
      assert(bulkAssignmentId, 'thiếu assignmentId');
      return r.status;
    });

    let bulkRequestId = null;
    await expect('[NV] bulk-update → 200 tạo ĐỀ XUẤT (không còn 501)', 200, async () => {
      const r = await call('POST', '/customers/bulk-update', {
        token: empToken,
        body: { assignmentIds: [bulkAssignmentId], customer_tier: 'NON' },
      });
      assert(r.json?.proposal === true, `proposal=true expected: ${JSON.stringify(r.json).slice(0, 150)}`);
      bulkRequestId = r.json?.requestId;
      assert(bulkRequestId, 'thiếu requestId');
      return r.status;
    });
    await expect('[NV] tier CHƯA đổi khi đề xuất chưa được duyệt', 200, async () => {
      const r = await call('GET', `/customers/${bulkAssignmentId}`, H());
      assert(r.json?.customerTier === 'KEY', `tier phải còn KEY: ${r.json?.customerTier}`);
      return r.status;
    });
    await expect('[Admin] duyệt đề xuất bulk → approved', 200, async () => {
      const r = await call('POST', `/approval-requests/${bulkRequestId}/decide`, {
        ...H(), body: { action: 'approve' },
      });
      assert(r.json?.status === 'approved', `status: ${JSON.stringify(r.json).slice(0, 150)}`);
      return r.status;
    });
    await expect('[Admin] tier đã đổi thành NON sau khi duyệt', 200, async () => {
      const r = await call('GET', `/customers/${bulkAssignmentId}`, H());
      assert(r.json?.customerTier === 'NON', `tier phải là NON: ${r.json?.customerTier}`);
      return r.status;
    });
    await expect('[Admin] dọn khách test bulk → 200', 200,
      async () => (await call('DELETE', `/customers/${bulkAssignmentId}`, H())).status);
  } catch (e) {
    bad('Luồng bulk-update nhân viên → đề xuất', e.message);
  }
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
  await expect('zalo-contacts page=2 → 200 (phân trang truyền xuống Python)', 200, async () => {
    const r = await call('GET', '/customers/zalo-contacts?limit=5&page=2', H());
    assert(Array.isArray(r.json?.data), 'data không phải mảng');
    return r.status;
  });
  await expect('zalo-contacts page=0 → 400', 400,
    async () => (await call('GET', '/customers/zalo-contacts?page=0', H())).status);
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

// ============ J2. XOÁ PHÂN CÔNG BỊ FK CHẶN (CÒN DỮ LIỆU KPI) + TÊN FILE TIẾNG VIỆT Ở LỊCH SỬ NẠP ============
// Tái hiện đúng lỗi thật: khách có phân công đang bị customer_zalo /
// customer_activity_daily / customer_response_daily tham chiếu → xoá cứng bị
// FK chặn. Hệ thống phải: giữ nguyên dòng phân công (không mất KPI), ẩn khách
// (status=deleted) khi hết phân công, báo conflict RÕ RÀNG (không bỏ qua im
// lặng), và rollback trả lại status cho khách. File nạp tên tiếng Việt đồng
// thời kiểm tra tên lưu ở tab Lịch sử nạp không bị lỗi dấu (mojibake).
console.log('\n-- J2. Xoá phân công bị FK chặn (KPI) + tên file tiếng Việt ở Lịch sử nạp --');
{
  const FK_DB = '2026-10-09';
  const tag = Date.now().toString(36).slice(-6);
  const tagNum = Date.now() % 100000;
  const FK_CODE = `KPI_FK_${tag}`;
  const FK_SAP = `CFK${tagNum}`;
  const FILE_NAME = 'DSKH KDS_CHÍNH PHỤ_KEY NON.xlsx';
  let sessionId = null;
  let assignmentId = null;
  let customerId = null;
  let conn = null;
  try {
    // 0. Kết nối DB dev — chỉ để chèn dòng KPI giả + đọc dữ liệu thật
    const envRaw = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8');
    const env = Object.fromEntries(
      envRaw
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
        .filter((m) => m && m[2] !== undefined)
        .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
    const backendRequire = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
    const mysql = backendRequire('mysql2/promise');
    conn = await mysql.createConnection({
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
      user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME,
    });

    // 1. Khách tag + 1 phân công Laptop (chạy lại: tái sử dụng nếu còn)
    const search = await call('GET',
      `/customers?search=${encodeURIComponent(FK_CODE)}&pageSize=10`, H());
    const existingRow = (search.json?.data || []).find(
      (x) => x.customer?.customerCode === FK_CODE && x.departmentSlug === 'laptop');
    if (existingRow?.assignmentId) {
      assignmentId = existingRow.assignmentId;
      customerId = existingRow.customer?.id ?? null;
      ok(`Tái sử dụng phân công #${assignmentId} từ lần chạy trước`);
    } else {
      const cr = await call('POST', '/customers', {
        ...H(),
        body: {
          customer_code: FK_CODE, sap_code: FK_SAP, customer_name: `Khách test FK ${tag}`,
          department_slug: 'laptop', customer_tier: 'KEY', sale_id: 1,
        },
      });
      assert(cr.status === 200 || cr.status === 201,
        `tạo khách tag HTTP ${cr.status}: ${JSON.stringify(cr.json).slice(0, 150)}`);
      assignmentId = cr.json?.assignmentId;
      customerId = cr.json?.customer?.id ?? null;
      assert(assignmentId, `POST /customers không trả assignmentId: ${JSON.stringify(cr.json).slice(0, 150)}`);
      ok(`Tạo khách tag ${FK_CODE} + phân công #${assignmentId}`);
    }

    // 2. Chèn dòng KPI giả → xoá cứng phân công chắc chắn bị FK chặn
    await conn.query(
      'INSERT IGNORE INTO customer_activity_daily (assignment_id, stat_date, inbound_count, outbound_count, zalo_linked) VALUES (?, ?, 1, 1, 1)',
      [assignmentId, FK_DB]);
    const [act] = await conn.query(
      'SELECT COUNT(*) cnt FROM customer_activity_daily WHERE assignment_id = ?', [assignmentId]);
    assert(act[0].cnt >= 1, `không chèn được dòng KPI cho assignment ${assignmentId}`);
    ok(`Chèn dòng KPI giả (customer_activity_daily) cho phân công #${assignmentId}`);

    // 3. Nạp file demo KHÔNG chứa khách tag → so khớp phải sinh lệnh xoá
    const fixturePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures', FILE_NAME);
    const buf = readFileSync(fixturePath);
    const fd = new FormData();
    fd.append('file', new Blob([buf]), FILE_NAME);
    const up = await fetch(`${BASE}/customer-assignments/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      body: fd, signal: AbortSignal.timeout(180000),
    });
    const upJson = await up.json();
    sessionId = upJson?.sessionId;
    assert(up.status === 201 && sessionId, `upload HTTP ${up.status}: ${JSON.stringify(upJson).slice(0, 200)}`);
    assert((upJson.summary?.delete ?? 0) >= 1,
      `delete=${upJson.summary?.delete} — file thiếu khách tag phải sinh lệnh xoá`);
    ok(`Upload → session ${sessionId}, sinh ${upJson.summary.delete} lệnh xoá`);

    // 4. Lịch sử nạp phải lưu TÊN FILE ĐÚNG DẤU — không mojibake
    await expect('[J2] Lịch sử nạp lưu tên file tiếng Việt đúng dấu', 200, async () => {
      const r = await call('GET', '/customer-assignments/import-sessions?pageSize=20', H());
      const mine = (r.json?.data || []).find((s) => s.id === sessionId);
      assert(mine, `không thấy session ${sessionId} trong danh sách`);
      assert(mine.file_name === FILE_NAME,
        `file_name="${mine.file_name}" — kỳ vọng "${FILE_NAME}" (lỗi dấu khi upload?)`);
      return r.status;
    });

    // 5. Có change xoá đúng cho khách tag (phòng laptop)
    let deleteChangeId = null;
    for (let page = 1; page <= 20 && !deleteChangeId; page++) {
      const pv = await call('GET',
        `/customer-assignments/import-sessions/${sessionId}/preview?action=delete&page=${page}&pageSize=100`, H());
      const found = (pv.json?.data || []).find(
        (c) => c.customer_code === FK_CODE && c.department_slug === 'laptop');
      if (found) deleteChangeId = found.id;
      else if ((pv.json?.data || []).length < 100) break;
    }
    if (deleteChangeId) ok(`Change xoá phân công ${FK_CODE}/laptop tồn tại (#${deleteChangeId})`);
    else bad('Change xoá cho khách tag', 'không tìm thấy trong preview (action=delete)');

    // 6. Apply — dòng KPI tham chiếu → KHÔNG xoá cứng được, phải báo conflict rõ ràng
    const ap = await fetch(`${BASE}/customer-assignments/import-sessions/${sessionId}/apply`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(600000),
    });
    const apJson = await ap.json();
    if (ap.status !== 200) {
      bad('Apply session J2', `HTTP ${ap.status}: ${JSON.stringify(apJson).slice(0, 200)}`);
    } else {
      const fkConflict = (apJson.conflicts || []).find((c) => c.reason?.includes(FK_CODE));
      if (fkConflict) {
        ok(`Apply báo conflict rõ ràng cho dòng bị FK chặn: "${fkConflict.reason}"`);
        assert(fkConflict.reason.includes('KPI/Zalo'),
          'lý do conflict phải nói rõ còn dữ liệu KPI/Zalo tham chiếu');
      } else {
        bad('Apply FK-block',
          `conflicts không nhắc khách ${FK_CODE}: ${JSON.stringify(apJson.conflicts).slice(0, 300)}`);
      }
    }

    // 7. Sau apply: dòng phân công CÒN NGUYÊN + khách được ẨN
    const [assignRow] = await conn.query('SELECT id FROM customer_assignments WHERE id = ?', [assignmentId]);
    assert(assignRow.length === 1,
      `dòng phân công #${assignmentId} phải được giữ (xoá tay = mất dữ liệu KPI)`);
    if (customerId) {
      const [cRow] = await conn.query('SELECT status FROM customers WHERE id = ?', [customerId]);
      assert(cRow[0]?.status === 'deleted',
        `khách phải bị ẩn (status=deleted) khi hết phân công — nhận ${cRow[0]?.status}`);
    }
    ok('Sau apply: dòng phân công còn nguyên + khách bị ẩn (status=deleted)');
    await expect('[J2] Sau apply: khách tag ẩn khỏi danh sách (total 0)', 200, async () => {
      const r = await call('GET', `/customers?search=${encodeURIComponent(FK_CODE)}&pageSize=10`, H());
      assert((r.json?.total ?? -1) === 0, `total=${r.json?.total} — khách bị ẩn phải biến khỏi danh sách`);
      return r.status;
    });

    // 8. Rollback — trả khách về ACTIVE, dòng phân công vẫn còn
    const rb = await fetch(`${BASE}/customer-assignments/import-sessions/${sessionId}/rollback`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(600000),
    });
    const rbJson = await rb.json();
    if (rb.status === 200) {
      ok(`Rollback → 200 (restored ${rbJson.restored}, skip ${rbJson.skipped?.length})`);
    } else {
      bad('Rollback session J2', `HTTP ${rb.status}: ${JSON.stringify(rbJson).slice(0, 200)}`);
    }
    if (customerId) {
      const [cRow] = await conn.query('SELECT status FROM customers WHERE id = ?', [customerId]);
      assert(cRow[0]?.status === 'active',
        `sau rollback status phải là active — nhận ${cRow[0]?.status} (rollback phải trả lại status)`);
    }
    await expect('[J2] Sau rollback: khách tag hiện lại (total 1)', 200, async () => {
      const r = await call('GET', `/customers?search=${encodeURIComponent(FK_CODE)}&pageSize=10`, H());
      assert((r.json?.total ?? 0) === 1, `total=${r.json?.total} — rollback phải trả khách về danh sách`);
      return r.status;
    });

    // 9. Dọn dẹp: xoá dòng KPI giả + ẩn khách tag + huỷ session
    await conn.query('DELETE FROM customer_activity_daily WHERE assignment_id = ?', [assignmentId]);
    await expect('[J2] Dọn: xoá mềm khách tag → 200', 200,
      async () => (await call('DELETE', `/customers/${assignmentId}`, H())).status);
    await expect('[J2] Dọn: huỷ session → 200', 200,
      async () => (await call('DELETE', `/customer-assignments/import-sessions/${sessionId}`, H())).status);
    sessionId = null;
  } catch (e) {
    bad('[J2] Chuẩn bị', e.message);
    if (sessionId) { try { await call('DELETE', `/customer-assignments/import-sessions/${sessionId}`, H()); } catch {} }
  } finally {
    if (conn) { try { await conn.end(); } catch {} }
  }
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
      // lỗi P3: interceptor từng biến Date ngoài whitelist thành {} → FE
      // "Kiểm tra: Invalid Date". lastVerifiedAt phải là chuỗi ngày parse được.
      assert(
        z.lastVerifiedAt == null || !isNaN(new Date(z.lastVerifiedAt).getTime()),
        `lastVerifiedAt=${JSON.stringify(z.lastVerifiedAt)} — không phải ngày hợp lệ`,
      );
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
    let lowToken = null;
    let overviewSaleName = null;
    const asgIds = {};
    const customerIds = {};
    const convIds = {};
    const orderIds = [];
    const requestIds = [];
    // v1.6: tiêu chí tạm dựng cho luồng chỉ tiêu (doanh_so_* không nhập tay được)
    const tempDefinitionKeys = [];
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
          if (saleUserId) {
            await mainConn.query('DELETE FROM kpi_criterion_overrides WHERE sale_id = ?', [saleUserId]);
            await mainConn.query('DELETE FROM customer_movement_reports WHERE user_id = ?', [saleUserId]);
            await mainConn.query('DELETE FROM kpi_targets WHERE sale_id = ?', [saleUserId]);
          }
          if (requestIds.length) {
            await mainConn.query('DELETE FROM approval_request_target_items WHERE request_id IN (?)', [requestIds]);
            await mainConn.query('DELETE FROM approval_requests WHERE id IN (?)', [requestIds]);
          }
          for (const key of tempDefinitionKeys) {
            try { await mainConn.query('DELETE FROM kpi_definitions WHERE criterion_key = ? AND team_group = ?', [key, 'kinh-doanh']); } catch {}
          }
          if (saleUserId) {
            try { await mainConn.query('DELETE FROM kpi_targets WHERE sale_id = ?', [saleUserId]); } catch {}
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
      // 3b. Sự kiện báo cáo di chuyển (tiêu chí 3): job Python ghi bảng này,
      // test giả lập 1 tin khớp cú pháp cho KEY hôm nay + 1 tin của NON hôm
      // qua (ngoài cửa sổ TODAY — kiểm tra lọc theo ngày).
      const mvBase = 9500000000 + (Date.now() % 100000000);
      await mainConn.query(
        'INSERT INTO customer_movement_reports (user_id, customer_code, sent_at, source_type, raw_text, source_message_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW()), (?, ?, ?, ?, ?, ?, NOW())',
        [saleUserId, CODES.key, `${TODAY} 10:00:00`, 'group', `ĐI GAP KHACH ${CODES.key}`, mvBase,
         saleUserId, CODES.non, `${YESTERDAY} 10:00:00`, 'personal', `di gap khach ${CODES.non}`, mvBase + 1],
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
      await expect('[M] Overview: TC3 support 1/2 (có báo cáo), TC4 tương tác 1/2, gợi ý pass, doanh số no_data', 200, async () => {
        const r = await call('GET', `/customer-kpi-reports/overview?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const sale = (r.json?.sales || []).find((x) => x.saleId === saleUserId);
        assert(sale, 'không thấy sale test trong overview');
        const byKey = new Map(sale.criteria.map((c) => [c.key, c]));
        // TC3 binary: KEY có báo cáo di chuyển trong cửa sổ → 1/2 khách đạt
        const support = byKey.get('support_khach');
        assert(support && support.status === 'pass' && support.actualValue === 1, JSON.stringify(support));
        assert(support.numerator === 1 && support.denominatorValue === 2 && support.totalCriteria === 2, JSON.stringify(support));
        assert(support.passedCriteria === 1, JSON.stringify(support));
        // TC4 binary: KEY có tin sale nhắn đi, NON không → 1/2
        const reply = byKey.get('lien_lac_phan_hoi');
        assert(reply && reply.status === 'pass' && reply.numerator === 1 && reply.denominatorValue === 2, JSON.stringify(reply));
        const ack = byKey.get('goi_y_thuc_hien');
        assert(ack && ack.status === 'pass' && ack.passedCriteria === 1 && ack.totalCriteria === 2, JSON.stringify(ack));
        // v1.6: tiêu chí doanh số đọc API NKM. Sale test chưa có employee_code
        // khớp bảng tra mã → no_data kèm lý do rõ ràng (chứ không phải "trượt").
        const rev = byKey.get('doanh_so_key');
        assert(rev && rev.status === 'no_data', JSON.stringify(rev));
        assert(
          /bảng tra mã|doanh thu/.test(rev.reason || ''),
          `reason doanh số không đúng: ${rev.reason}`,
        );
        // Dòng phân phối trên sale vẫn đủ cột dù thiếu nguồn
        assert(sale.revenue && sale.revenue.verdict === null, JSON.stringify(sale.revenue));
        assert(
          (sale.revenue.keyCustomers.total >= 1 && sale.revenue.nonCustomers.total >= 1) ||
            sale.revenue.keyCustomers.total + sale.revenue.nonCustomers.total >= 2,
          JSON.stringify(sale.revenue),
        );
        overviewSaleName = sale.saleName; // dùng cho test search ở dưới
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
        const non = sale.customers.find((c) => c.customerCode === CODES.non);
        assert(non, 'không thấy khách NON');
        assert(key.totals.inbound === 2 && key.totals.outbound === 3 && key.totals.orders === 1 && key.totals.revenue === 200000, JSON.stringify(key.totals));
        assert(key.zaloLinked === true, 'khách KEY phải zaloLinked');
        const ackKey = key.criteria.find((c) => c.key === 'goi_y_thuc_hien');
        assert(ackKey && ackKey.status === 'pass', JSON.stringify(ackKey));
        // TC3/TC4 binary cấp khách: KEY đạt cả 2; NON không có báo cáo + không
        // có tin sale nhắn đi → chưa đạt cả 2
        const keyTc3 = key.criteria.find((c) => c.key === 'support_khach');
        assert(keyTc3 && keyTc3.status === 'pass', JSON.stringify(keyTc3));
        const keyTc4 = key.criteria.find((c) => c.key === 'lien_lac_phan_hoi');
        assert(keyTc4 && keyTc4.status === 'pass', JSON.stringify(keyTc4));
        const nonTc3 = non.criteria.find((c) => c.key === 'support_khach');
        assert(nonTc3 && nonTc3.status === 'fail', JSON.stringify(nonTc3));
        const nonTc4 = non.criteria.find((c) => c.key === 'lien_lac_phan_hoi');
        assert(nonTc4 && nonTc4.status === 'fail', JSON.stringify(nonTc4));
        return r.status;
      });

      // 7b. search + phân trang (yêu cầu FE cho bảng khách hàng / xếp hạng sale)
      await expect('[M] by-sale thiếu saleId → 400 (chặn quét toàn công ty)', 400, async () => {
        const r = await call('GET', `/customer-kpi-reports/by-sale?from=${TODAY}&to=${TODAY}`, H());
        return r.status;
      });
      await expect('[M] by-sale search theo mã khách → đúng 1 dòng, total=1', 200, async () => {
        const r = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}&search=${encodeURIComponent(CODES.key)}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        assert(r.json?.total === 1, `total=${r.json?.total}`);
        const first = r.json?.sales?.[0]?.customers?.[0];
        assert(first && first.customerCode === CODES.key && first.assignmentId, JSON.stringify(first));
        return r.status;
      });

      // 7c. Cách B (v1.8): totals.orders (đơn Zalo) và totals.nkmQuantity
      // (phiếu NKM) là HAI nguồn độc lập — khách chỉ mua qua SAP có doanh số
      // nhưng orders = 0; seed nkm_sale_map + customer_revenue_daily để dựng
      // đúng tình huống FE từng báo "có doanh số mà đơn vẫn 0".
      await expect('[M] totals.nkmQuantity tách khỏi orders (đơn Zalo vs phiếu NKM)', 200, async () => {
        const nkmTag = `KPML${tag}`;
        const SLP = 900000000 + (Date.now() % 100000000); // slp_code test, không đụng bảng tra thật
        const [[oldEmp]] = await mainConn.query('SELECT employee_code FROM users WHERE id = ?', [saleUserId]);
        try {
          await mainConn.query('UPDATE users SET employee_code = ? WHERE id = ?', [nkmTag, saleUserId]);
          await mainConn.query(
            'INSERT INTO nkm_sale_map (slp_code, sale_label, employee_code, sale_name, dept_slug, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [SLP, `${nkmTag}-NV TEST`, nkmTag, 'NV TEST', 'laptop'],
          );
          // Khách NON không có đơn Zalo — chỉ mua SAP: 2 phiếu, 500.000
          await mainConn.query(
            'INSERT INTO customer_revenue_daily (customer_code, slp_code, stat_date, quantity, line_total, card_code, is_provisional) VALUES (?, ?, ?, 2, 500000, ?, 0)',
            [CODES.non, SLP, TODAY, CODES.non],
          );
          const r = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
          assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
          const sale = (r.json?.sales || []).find((x) => x.saleId === saleUserId);
          const non = (sale?.customers || []).find((c) => c.customerCode === CODES.non);
          assert(non, 'không thấy khách NON');
          assert(non.totals.orders === 0, `khách chỉ mua SAP phải có orders = 0: ${JSON.stringify(non.totals)}`);
          assert(non.totals.nkmQuantity === 2, `nkmQuantity phải = 2 phiếu NKM: ${JSON.stringify(non.totals)}`);
          assert(non.totals.revenue === 500000, `revenue phải = 500000: ${JSON.stringify(non.totals)}`);
          assert(non.revenueStatus === 'has_revenue', `revenueStatus phải has_revenue: ${non.revenueStatus}`);
          // Khách KEY ngược lại: có đơn Zalo, không có phiếu NKM
          const key = (sale?.customers || []).find((c) => c.customerCode === CODES.key);
          assert(key && key.totals.orders === 1 && key.totals.nkmQuantity === 0,
            `khách KEY phải orders=1, nkmQuantity=0: ${JSON.stringify(key?.totals)}`);
          return r.status;
        } finally {
          try { await mainConn.query('DELETE FROM customer_revenue_daily WHERE slp_code = ?', [SLP]); } catch {}
          try { await mainConn.query('DELETE FROM nkm_sale_map WHERE slp_code = ?', [SLP]); } catch {}
          try { await mainConn.query('UPDATE users SET employee_code = ? WHERE id = ?', [oldEmp?.employee_code ?? null, saleUserId]); } catch {}
        }
      });
      await expect('[M] by-sale phân trang pageSize=1 → 2 trang không trùng khách', 200, async () => {
        const p1 = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}&page=1&pageSize=1`, H());
        assert(p1.status === 200 && p1.json?.total === 2 && p1.json?.sales?.[0]?.customers?.length === 1, JSON.stringify({ total: p1.json?.total, n: p1.json?.sales?.[0]?.customers?.length }));
        const p2 = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}&page=2&pageSize=1`, H());
        assert(p2.status === 200 && p2.json?.sales?.[0]?.customers?.length === 1, JSON.stringify(p2.json?.sales?.[0]?.customers));
        assert(p1.json.sales[0].customers[0].assignmentId !== p2.json.sales[0].customers[0].assignmentId, '2 trang trả cùng 1 khách');
        return p1.status;
      });
      await expect('[M] overview search theo tên sale → chỉ còn sale test', 200, async () => {
        assert(overviewSaleName, 'không có tên sale để search');
        const r = await call('GET', `/customer-kpi-reports/overview?from=${TODAY}&to=${TODAY}&search=${encodeURIComponent(overviewSaleName)}`, H());
        assert(r.status === 200, `HTTP ${r.status}`);
        assert(r.json?.sales?.length === 1 && r.json.sales[0].saleId === saleUserId, JSON.stringify(r.json?.sales?.map((s) => s.saleId)));
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
      // v1.6: doanh_so_key/doanh_so_non KHÔNG nhập tay được nữa (nguồn API NKM)
      // nên luồng gán chỉ tiêu chuyển sang một tiêu chí ratio tạm.
      const TARGET_CRITERION = 'kpi_test_target';
      tempDefinitionKeys.push(TARGET_CRITERION);
      await expect('[M] Chuẩn bị: tiêu chí ratio tạm cho luồng gán chỉ tiêu', 201, async () => {
        const r = await call('POST', '/customer-kpi-definitions', {
          ...H(),
          body: {
            key: TARGET_CRITERION, name: 'Tiêu chí tạm cho luồng chỉ tiêu',
            metric: 'contacted_customers', scoring_mode: 'ratio',
            denominator: 'target_value', period: 'month',
          },
        });
        assert(r.json?.id || r.status === 409, `không có id: ${r.text?.slice(0, 150)}`);
        return r.status;
      });
      await expect('[M] POST targets tiêu chí doanh số → 400 (API NKM là nguồn chân lý)', 400, async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: 'doanh_so_key', period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 80 },
        });
        assert(/API NKM/.test(r.json?.message || ''), `message: ${r.json?.message}`);
        return r.status;
      });
      await expect('[M] POST targets scope=sale (admin) → applied 1', [200, 201], async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: TARGET_CRITERION, period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 80 },
        });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        assert(r.json?.applied === 1, JSON.stringify(r.json));
        return r.status;
      });
      await expect('[M] Gán lại cùng tháng → upsert (vẫn 1 dòng, giá mới 90)', 200, async () => {
        const r2 = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: TARGET_CRITERION, period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 90 },
        });
        assert(r2.status === 200 || r2.status === 201, `HTTP ${r2.status}`);
        const list = await call('GET', `/customer-kpi-targets?criterion_key=${TARGET_CRITERION}&saleId=${saleUserId}&period_month=${MONTH}`, H());
        assert(list.json?.total === 1, `total=${list.json?.total} — upsert bị nhân bản`);
        assert(Number(list.json.data[0].targetValue) === 90, JSON.stringify(list.json.data));
        return list.status;
      });
      await expect('[M] POST targets scope=customer → chỉ tiêu riêng cho khách KEY', [200, 201], async () => {
        const r = await call('POST', '/customer-kpi-targets', {
          ...H(),
          body: { criterion_key: TARGET_CRITERION, period_month: MONTH, scope: 'customer', sale_id: saleUserId, items: [{ customer_id: customerIds.key, target_value: 60 }] },
        });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const list = await call('GET', `/customer-kpi-targets?criterion_key=${TARGET_CRITERION}&saleId=${saleUserId}&period_month=${MONTH}`, H());
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
          body: { criterion_key: TARGET_CRITERION, period_month: MONTH, scope: 'department', department_slug: `khong-ton-tai-${tag}`, target_value: 10 },
        });
        return r.status;
      });
      // v1.6: đề xuất cũ (tạo trước khi chặn) vẫn bị chặn lúc DUYỆT — "đề xuất
      // trước rồi duyệt sau" không được thủng luật API NKM là nguồn chân lý.
      await expect('[M] Duyệt đề xuất chứa tiêu chí doanh số → 400 (chặn cả đề xuất cũ)', 400, async () => {
        const [reqIns] = await mainConn.query(
          "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('kpi_target', ?, ?, 'pending', 'test', NOW(), NOW())",
          [saleUserId, saleUserId],
        );
        requestIds.push(Number(reqIns.insertId));
        await mainConn.query(
          'INSERT INTO approval_request_target_items (request_id, criterion_key, period_month, sale_id, customer_id, old_target_value, new_target_value, created_at) VALUES (?, ?, ?, ?, NULL, 90, 55, NOW())',
          [reqIns.insertId, 'doanh_so_key', MONTH, saleUserId],
        );
        const r = await call('POST', `/approval-requests/${reqIns.insertId}/decide`, { ...H(), body: { action: 'approve' } });
        assert(/API NKM/.test(r.json?.message || ''), `message: ${r.json?.message}`);
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
          [reqIns.insertId, TARGET_CRITERION, MONTH, saleUserId],
        );
        const r = await call('POST', `/approval-requests/${reqIns.insertId}/decide`, { ...H(), body: { action: 'approve' } });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const [trows] = await mainConn.query(
          'SELECT target_value FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = 0',
          [TARGET_CRITERION, MONTH, saleUserId],
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
        lowToken = lowLogin.json?.access_token || lowLogin.json?.token || lowLogin.json?.accessToken;
        await expect('[M] user thường gán chỉ tiêu → 403', 403, async () => {
          const r = await call('POST', '/customer-kpi-targets', {
            token: lowToken,
            body: { criterion_key: TARGET_CRITERION, period_month: MONTH, scope: 'sale', sale_ids: [saleUserId], target_value: 10 },
          });
          return r.status;
        });
      }

      // 11b. Ghi đè thủ công tiêu chí 3 — quản lý tự ghi, không qua duyệt
      await expect('[M] Ghi đè 1 khách → ô fail + đầu bảng x giảm; ghi đè cả sale → mạnh nhất', [200, 201], async () => {
        // Cấp khách: KEY đang đạt TC3 → ép chưa đạt
        const r = await call('POST', '/customer-kpi-overrides', {
          ...H(),
          body: {
            sale_id: saleUserId, criterion_key: 'support_khach', period_month: MONTH,
            customer_id: customerIds.key, reason: 'test: khách báo cáo xấu',
          },
        });
        assert(r.status === 200 || r.status === 201, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const bs = await call('GET', `/customer-kpi-reports/by-sale?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        assert(bs.status === 200, `HTTP ${bs.status}`);
        const saleBs = bs.json?.sales?.[0];
        const keyRow = saleBs?.customers?.find((c) => c.customerId === customerIds.key);
        const keyTc3 = keyRow?.criteria?.find((c) => c.key === 'support_khach');
        assert(keyTc3 && keyTc3.status === 'fail' && keyTc3.overridden === true, JSON.stringify(keyTc3));
        // Đầu bảng cấp sale: x từ 1 → 0 (ghi đè trừ vào tổng)
        const saleTc3 = saleBs?.criteria?.find((c) => c.key === 'support_khach');
        assert(saleTc3 && saleTc3.status === 'fail' && saleTc3.passedCriteria === 0, JSON.stringify(saleTc3));
        // Cấp sale: mạnh nhất — cả tiêu chí không đạt cho mọi khách
        const r2 = await call('POST', '/customer-kpi-overrides', {
          ...H(),
          body: { sale_id: saleUserId, criterion_key: 'support_khach', period_month: MONTH, customer_id: 0, reason: 'test: không công nhận cả tháng' },
        });
        assert(r2.status === 200 || r2.status === 201, `HTTP ${r2.status}`);
        const ov = await call('GET', `/customer-kpi-reports/overview?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        const saleOv = ov.json?.sales?.find((x) => x.saleId === saleUserId);
        const ovTc3 = saleOv?.criteria?.find((c) => c.key === 'support_khach');
        assert(ovTc3 && ovTc3.status === 'fail' && ovTc3.overridden === true && ovTc3.passedCriteria === 0, JSON.stringify(ovTc3));
        return r.status;
      });
      if (lowToken) {
        await expect('[M] user thường ghi đè tiêu chí → 403 (không tự hạ KPI)', 403, async () => {
          const r = await call('POST', '/customer-kpi-overrides', {
            token: lowToken,
            body: { sale_id: saleUserId, criterion_key: 'support_khach', period_month: MONTH, customer_id: customerIds.key, reason: 'tự hạ KPI' },
          });
          return r.status;
        });
      }
      await expect('[M] Ghi đè sai tiêu chí (doanh số) → 400', 400, async () => {
        const r = await call('POST', '/customer-kpi-overrides', {
          ...H(),
          body: { sale_id: saleUserId, criterion_key: 'doanh_so_key', period_month: MONTH, customer_id: 0, reason: 'sai tiêu chí' },
        });
        return r.status;
      });
      await expect('[M] Ghi đè khách không thuộc sale → 400', 400, async () => {
        const r = await call('POST', '/customer-kpi-overrides', {
          ...H(),
          body: { sale_id: saleUserId, criterion_key: 'support_khach', period_month: MONTH, customer_id: 999999999, reason: 'khách lạ' },
        });
        return r.status;
      });
      await expect('[M] Xoá override → kết quả engine hiện lại', 200, async () => {
        const list = await call('GET', `/customer-kpi-overrides?saleId=${saleUserId}`, H());
        assert(list.status === 200 && (list.json?.total ?? 0) >= 2, JSON.stringify(list.json));
        for (const row of list.json.data) {
          const del = await call('DELETE', `/customer-kpi-overrides/${row.id}`, H());
          assert(del.status === 200 || del.status === 201, `DELETE HTTP ${del.status}`);
        }
        const ov = await call('GET', `/customer-kpi-reports/overview?saleId=${saleUserId}&from=${TODAY}&to=${TODAY}`, H());
        const sale = ov.json?.sales?.find((x) => x.saleId === saleUserId);
        const tc3 = sale?.criteria?.find((c) => c.key === 'support_khach');
        assert(tc3 && tc3.status === 'pass' && tc3.overridden !== true, JSON.stringify(tc3));
        return 200;
      });

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

// ============ O. HOÀN TÁC ĐỀ XUẤT CHỈ TIÊU (DUYỆT NHẦM) + OLD_DATA TRONG CHI TIẾT ============
// Lỗi P2: đề xuất giao chỉ tiêu duyệt nhầm thì không hoàn tác được bằng luồng
// đề xuất — import có backup rollback, đề xuất không có gì. Giờ BE trả old_data
// trong chi tiết đề xuất + có POST :id/undo trả chỉ tiêu về giá trị cũ.
console.log('\n-- O. Hoàn tác đề xuất chỉ tiêu (duyệt nhầm) + old_data trong chi tiết --');
{
  let conn = null;
  const requestIds = [];
  const CRITERION = 'kpi_test_undo';
  let tempDefId = null;
  try {
    const envRaw = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8');
    const env = Object.fromEntries(
      envRaw
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
        .filter((m) => m && m[2] !== undefined)
        .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
    const backendRequire = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
    const mysql = backendRequire('mysql2/promise');
    conn = await mysql.createConnection({
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
      user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME,
    });

    const MONTH = new Date().toISOString().slice(0, 7);
    const SALE_ID = 1; // admin — đã tồn tại, thoả FK sale_id
    const targetWhere = [CRITERION, MONTH, SALE_ID, 0];
    // v1.6: tiêu chí doanh số không nhập tay được nên dùng tiêu chí ratio tạm
    if (CRITERION !== 'doanh_so_key') {
      const def = await call('POST', '/customer-kpi-definitions', {
        ...H(),
        body: {
          key: CRITERION, name: 'Tiêu chí tạm kiểm thử hoàn tác',
          metric: 'contacted_customers', scoring_mode: 'ratio',
          denominator: 'target_value', period: 'month',
        },
      });
      assert(def.status === 201 || def.status === 409, `dựng tiêu chí tạm HTTP ${def.status}: ${def.text?.slice(0, 150)}`);
      tempDefId = def.json?.id ?? null;
    }

    // Dựng đề xuất pending + dòng chỉ tiêu (giống cách trưởng phòng đề xuất)
    const mkProposal = async (oldVal, newVal, note) => {
      const [ins] = await conn.query(
        "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('kpi_target', ?, ?, 'pending', ?, NOW(), NOW())",
        [SALE_ID, SALE_ID, note]);
      requestIds.push(Number(ins.insertId));
      await conn.query(
        'INSERT INTO approval_request_target_items (request_id, criterion_key, period_month, sale_id, customer_id, old_target_value, new_target_value, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?, NOW())',
        [ins.insertId, CRITERION, MONTH, SALE_ID, oldVal, newVal]);
      return Number(ins.insertId);
    };
    const getTarget = async () => {
      const [rows] = await conn.query(
        'SELECT target_value FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = ?',
        targetWhere);
      return rows.length ? Number(rows[0].target_value) : null;
    };
    await conn.query(
      'DELETE FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = ?',
      targetWhere);
    try {
      // 1. Chỉ tiêu CÓ SẴN (giá trị cũ 90) + đề xuất đổi sang 55
      await conn.query(
        'INSERT INTO kpi_targets (criterion_key, period_month, sale_id, customer_id, target_value, created_by, created_at) VALUES (?, ?, ?, 0, 90, 1, NOW())',
        [CRITERION, MONTH, SALE_ID]);
      const req1 = await mkProposal(90, 55, 'test undo cập nhật');
      ok(`Dựng đề xuất #${req1} (cập nhật 90 → 55) + chỉ tiêu có sẵn 90`);

      // 2. Chi tiết đề xuất phải trả OLD_DATA — lỗi P2: FE đọc old_data nhưng rỗng
      await expect('[O] Chi tiết đề xuất trả old_data/new_data/action', 200, async () => {
        const r = await call('GET', `/approval-requests/${req1}`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
        const item = r.json?.items?.[0];
        assert(item, 'detail không có items');
        assert(item.action === 'update', `action="${item.action}" — kỳ vọng update (có giá trị cũ)`);
        assert(Number(item.old_data?.target_value) === 90,
          `old_data.target_value=${JSON.stringify(item.old_data)} — kỳ vọng 90 (giá trị cũ lúc đề xuất)`);
        assert(Number(item.new_data?.target_value) === 55,
          `new_data.target_value=${JSON.stringify(item.new_data)} — kỳ vọng 55`);
        return r.status;
      });

      // 3. Duyệt → ghi 55
      await expect('[O] Duyệt đề xuất → ghi 55 vào kpi_targets', 200, async () => {
        const r = await call('POST', `/approval-requests/${req1}/decide`, { ...H(), body: { action: 'approve' } });
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
        return r.status;
      });
      assert(await getTarget() === 55, `sau duyệt target=${await getTarget()} — kỳ vọng 55`);

      // 4. Duyệt nhầm → hoàn tác → trả về 90
      await expect('[O] Hoàn tác đề xuất đã duyệt → trả chỉ tiêu về giá trị cũ', 200, async () => {
        const r = await call('POST', `/approval-requests/${req1}/undo`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        assert(r.json?.restored >= 1, `restored=${r.json?.restored}`);
        const now = await getTarget();
        assert(now === 90, `sau hoàn tác target=${now} — kỳ vọng 90 (giá trị trước khi duyệt)`);
        return r.status;
      });
      const [stRows] = await conn.query('SELECT status, undone_by FROM approval_requests WHERE id = ?', [req1]);
      assert(stRows[0].status === 'undone', `status="${stRows[0].status}" — kỳ vọng undone`);
      ok(`Đề xuất chuyển trạng thái undone (hoàn tác bởi user #${stRows[0].undone_by})`);

      await expect('[O] Hoàn tác lần 2 → 400 (đề xuất không còn ở trạng thái đã duyệt)', 400,
        async () => (await call('POST', `/approval-requests/${req1}/undo`, H())).status);
      await expect('[O] Đề xuất đã hoàn tác → duyệt lại → 400', 400,
        async () => (await call('POST', `/approval-requests/${req1}/decide`, { ...H(), body: { action: 'approve' } })).status);

      // 5. Chỉ tiêu bị GÁN LẠI sau khi duyệt → từ chối hoàn tác, không ghi đè
      const req2 = await mkProposal(90, 55, 'test undo xung đột');
      await call('POST', `/approval-requests/${req2}/decide`, { ...H(), body: { action: 'approve' } });
      await conn.query(
        'UPDATE kpi_targets SET target_value = 77 WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = ?',
        targetWhere);
      await expect('[O] Có người gán lại sau khi duyệt → hoàn tác bị từ chối + báo xung đột', 400, async () => {
        const r = await call('POST', `/approval-requests/${req2}/undo`, H());
        assert(r.status === 400, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const conflicts = r.json?.conflicts || [];
        assert(conflicts.some((c) => c.saleId === SALE_ID), `conflicts=${JSON.stringify(conflicts)}`);
        return r.status;
      });
      assert(await getTarget() === 77, `giá trị mới hơn (77) phải được giữ — nhận ${await getTarget()}`);

      // 6. Đề xuất TẠO MỚI (old rỗng) → duyệt → hoàn tác thì dòng bị xoá đi
      await conn.query(
        'DELETE FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = ?',
        targetWhere);
      const req3 = await mkProposal(null, 42, 'test undo tạo mới');
      await call('POST', `/approval-requests/${req3}/decide`, { ...H(), body: { action: 'approve' } });
      assert(await getTarget() === 42, `sau duyệt tạo mới target=${await getTarget()} — kỳ vọng 42`);
      await expect('[O] Hoàn tác đề xuất tạo mới → dòng chỉ tiêu bị xoá (về như trước khi duyệt)', 200, async () => {
        const r = await call('POST', `/approval-requests/${req3}/undo`, H());
        assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
        const now = await getTarget();
        assert(now === null, `sau hoàn tác target=${now} — kỳ vọng null (dòng đã bị xoá)`);
        return r.status;
      });

      // 7. Đề xuất KHÁC LOẠI (customer_list) → undo → 400 rõ ràng
      const [clIns] = await conn.query(
        "INSERT INTO approval_requests (request_type, requested_by, target_user_id, status, note, created_at, updated_at) VALUES ('customer_list', ?, 1, 'approved', 'test undo sai loại', NOW(), NOW())",
        [SALE_ID]);
      requestIds.push(Number(clIns.insertId));
      await expect('[O] Hoàn tác đề xuất sửa danh sách khách → 400 (chỉ hỗ trợ đề xuất chỉ tiêu)', 400,
        async () => (await call('POST', `/approval-requests/${clIns.insertId}/undo`, H())).status);
    } finally {
      // Dọn: chỉ tiêu test + đề xuất (xoá request → items theo CASCADE)
      await conn.query(
        'DELETE FROM kpi_targets WHERE criterion_key = ? AND period_month = ? AND sale_id = ? AND customer_id = ?',
        targetWhere).catch(() => {});
      if (requestIds.length) {
        await conn.query('DELETE FROM approval_requests WHERE id IN (?)', [requestIds]).catch(() => {});
      }
      // Tiêu chí tạm dựng cho luồng hoàn tác — xoá cho khỏi nhiễu báo cáo
      try { await call('DELETE', `/customer-kpi-definitions/${tempDefId}`, H()); } catch {}
    }
  } catch (e) {
    bad('[O] Chuẩn bị', e.message);
  } finally {
    if (conn) { try { await conn.end(); } catch {} }
  }
}

// ============ N. HỒI QUY SO KHỚP (2 lỗi đã phát hiện) ============
// Lỗi 1: khách vắng mặt trong file bị gắn cờ error → apply bỏ qua → "xoá" không bao giờ xảy ra.
// Lỗi 2: ô phân loại sai → phân công DB đang tốt bị sinh lệnh XOÁ không cảnh báo.
// Lỗi 3: dòng ví dụ 2 của template lệch cột (tier nằm sai phòng) → nạp file mẫu báo lỗi rỗng.
console.log('\n-- N. Hồi quy so khớp: vắng mặt / tier sai / template --');
{
  const tag = Date.now().toString(36).slice(-6).toUpperCase();
  const CODE = `KPIN_${tag}`;
  const sessionIds = [];
  let conn = null;

  try {
    const require2 = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    );
    const parseEnv = (file) => {
      const out = {};
      try {
        for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
          const i = line.indexOf('=');
          if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
        }
      } catch {}
      return out;
    };
    const backendEnv = parseEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
    let mysql = null;
    try { mysql = require2('mysql2/promise'); } catch {}
    const ExcelJS = require2('exceljs');

    const HEADERS = [
      'STT', 'MA DOI TAC SAP', 'MA KH', 'S1-MAY IN, MUC IN', 'S1-PC, LCD', 'S1-PTTT',
      'S1-LAPTOP', 'S1-PTKH1', 'S1-PTKH2', 'LOAI MA', 'LAPTOP', 'LINH KIEN', 'MAY IN',
      'PC - SERVER', 'PTKH1', 'PTKH2', 'han muc', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09',
      'DIEM', 'tong ds',
    ];
    // Workbook tối thiểu đủ điều kiện parse: sheet TIEU CHI (5 dòng) + đủ 12 cột bắt buộc
    const makeWorkbook = (rows) => {
      const wb = new ExcelJS.Workbook();
      const tc = wb.addWorksheet('TIÊU CHÍ');
      for (const line of ['Tiêu  Chí', '1/ a', '2/ b', '3/ c', '4/ d', '5/ e']) tc.addRow([line]);
      const ws = wb.addWorksheet('File Chi Tiết');
      ws.addRow(HEADERS);
      for (const row of rows) ws.addRow(row);
      ws.columns.forEach((c) => (c.width = 20));
      return wb;
    };
    const upload = async (rows) => {
      const fd = new FormData();
      fd.append('file', new Blob([await makeWorkbook(rows).xlsx.writeBuffer()]), 'DSKH hồi-quy.xlsx');
      const res = await fetch(`${BASE}/customer-assignments/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: fd,
        signal: AbortSignal.timeout(180000),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    // Đọc thẳng dòng thay đổi của MỘT khách — nếu dùng preview (phân trang) thì
    // khách test chìm trong ~10k dòng xoá của cả DB nên không kiểm được.
    const changesOf = async (sessionId, code) => {
      if (!conn) return [];
      const [rows] = await conn.query(
        'SELECT customer_code, department_slug, action, error FROM customer_import_changes WHERE session_id = ? AND customer_code = ?',
        [sessionId, code],
      );
      return rows;
    };

    if (mysql) {
      conn = await mysql.createConnection({
        host: backendEnv.DB_HOST, port: +(backendEnv.DB_PORT || 3306),
        user: backendEnv.DB_USERNAME, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME,
      });
    }

    // Khách mẫu: 2 phân công (may-in KEY, pc NON) — dùng cho cả hai lỗi.
    // Sale test tạo kèm employeeCode để file có dòng khớp thật → sinh được dòng "không đổi".
    const EMP = `KRG${tag}`;
    const userRoleId = await findRoleId('user');
    const newUser = await call('POST', '/users', {
      ...H(),
      body: { username: `kpi_regress_${tag}`, fullName: 'NV hồi quy', employeeCode: EMP },
    });
    let saleId = newUser.json?.id;
    if (!saleId && newUser.status === 409) {
      // user còn tồn tại từ lần chạy trước bị gãy — gặp lại mã NV cho nó
      const s = await call('GET', `/users?search=${encodeURIComponent(`kpi_regress_${tag}`)}&limit=5`, H());
      saleId = (s.json?.data || []).find((u) => u.username === `kpi_regress_${tag}`)?.id;
    }
    assert(saleId, `không chuẩn bị được sale test: HTTP ${newUser.status} ${JSON.stringify(newUser.json).slice(0, 200)}`);
    if (userRoleId) await call('POST', `/users/${saleId}/roles`, { ...H(), body: [userRoleId] });
    // Cặp test: A gắn may-in, B gắn pc. `customerCode`/`sapCode` gửi API,
    // `code`/`sap` dùng cho workbook (tên field của file).
    const A = { code: CODE, customerCode: CODE, sap: `S${tag}A`, sapCode: `S${tag}A`, department_slug: 'may-in', customer_tier: 'KEY' };
    const B = { code: `${CODE}B`, customerCode: `${CODE}B`, sap: `S${tag}B`, sapCode: `S${tag}B`, department_slug: 'pc', customer_tier: 'NON' };
    for (const c of [A, B]) {
      const r = await call('POST', '/customers', {
        ...H(),
        body: {
          customer_code: c.customerCode,
          sap_code: c.sapCode,
          department_slug: c.department_slug,
          sale_id: saleId,
          customer_tier: c.customer_tier,
          customer_name: 'KH hồi quy',
        },
      });
      assert(r.status === 201, `POST /customers → HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    }

    // --- Lỗi 2: tier sai ở đúng phòng may-in → KHÔNG được sinh lệnh xoá ---
    const upTier = await upload([
      [1, A.sap, A.code, `NKX99-NHAN VIEN TAM`, '', '', '', '', '', 'CHINH', '', 'KEYY', '', '', '', '', 0],
    ]);
    assert(upTier.status === 201, `upload tier sai → HTTP ${upTier.status}: ${JSON.stringify(upTier.json).slice(0, 200)}`);
    sessionIds.push(upTier.json?.sessionId);
    assert(
      (upTier.json?.errors || []).some((e) => (e.errors || []).some((m) => m.includes('phải là KEY hoặc NON'))),
      `dòng tier sai không báo lỗi phân loại: ${JSON.stringify(upTier.json?.errors)}`,
    );
    ok('Tier sai vẫn báo lỗi đúng dòng');

    assert(
      (upTier.json?.warnings || []).some((w) => w.includes('giữ nguyên phân công hiện có')),
      `thiếu cảnh báo giữ nguyên phân công: ${JSON.stringify(upTier.json?.warnings)}`,
    );
    ok('Tier sai → có cảnh báo giữ nguyên phân công');

    const tierDeletes = await changesOf(upTier.json?.sessionId, A.code);
    assert(
      tierDeletes.filter((c) => c.action === 'delete' && c.department_slug === 'may-in').length === 0,
      `tier sai ở may-in nhưng vẫn sinh lệnh XOÁ phân công: ${JSON.stringify(tierDeletes)}`,
    );
    ok('Tier sai → KHÔNG xoá phân công đang có');

    // Phòng để trống THẬT (pc không có trong file) → vẫn xoá, không chặn nhầm
    const bDeletes = await changesOf(upTier.json?.sessionId, B.code);
    const pcDelete = bDeletes.find((c) => c.action === 'delete' && c.department_slug === 'pc');
    assert(pcDelete, `phòng để trống thật phải sinh lệnh xoá: ${JSON.stringify(bDeletes)}`);
    assert(pcDelete.error == null, `lệnh xoá phòng trống phải không lỗi: ${JSON.stringify(pcDelete)}`);
    ok('Phòng để trống thật → vẫn sinh lệnh xoá không lỗi');

    // --- Lỗi 1: khách vắng mặt hoàn toàn trong file → delete phải ghi được ---
    const upEmpty = await upload([]); // file không có dòng khách nào
    assert(upEmpty.status === 201, `upload rỗng → HTTP ${upEmpty.status}`);
    sessionIds.push(upEmpty.json?.sessionId);
    const vangMat = (await changesOf(upEmpty.json?.sessionId, A.code))
      .find((c) => c.action === 'delete' && c.department_slug === 'may-in');
    assert(vangMat, 'khách vắng mặt trong file không sinh lệnh xoá');
    assert(
      vangMat.error == null,
      `lệnh xoá khách vắng mặt bị gắn error → apply sẽ bỏ qua âm thầm: ${JSON.stringify(vangMat)}`,
    );
    ok('Khách vắng mặt trong file → lệnh xoá KHÔNG lỗi (apply ghi được)');

    // Dòng "không đổi" phải được lưu để màn hình so khớp đếm đủ 4 trạng thái
    // (file có dòng khớp nguyên DB: cùng phòng, cùng sale, cùng tier)
    const upSame = await upload([
      [1, A.sap, A.code, `${EMP}-NV TEST`, '', '', '', '', '', 'CHÍNH', '', '', 'KEY', '', '', '', '', 0],
    ]);
    assert(upSame.status === 201, `upload dòng khớp → HTTP ${upSame.status}`);
    sessionIds.push(upSame.json?.sessionId);
    assert(
      (upSame.json?.summary?.unchanged ?? 0) >= 1,
      `file có dòng khớp nguyên phải sinh dòng "không đổi": ${JSON.stringify(upSame.json?.summary)}`,
    );
    const sameRows = await changesOf(upSame.json?.sessionId, A.code);
    assert(
      sameRows.some((c) => c.action === 'unchanged' && c.department_slug === 'may-in'),
      `dòng "không đổi" phải được lưu: ${JSON.stringify(sameRows)}`,
    );
    ok('Dòng không đổi được lưu (diff đủ 4 trạng thái)');

    // --- Lỗi 3: template hệ thống tự tạo phải parse được, không lỗi phân loại ---
    const tplRes = await fetch(`${BASE}/customer-assignments/template`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(30000),
    });
    assert(tplRes.status === 200, `GET template → HTTP ${tplRes.status}`);
    const tplBuf = Buffer.from(await tplRes.arrayBuffer());
    const tplWb = new ExcelJS.Workbook();
    await tplWb.xlsx.load(tplBuf);
    assert(tplWb.getWorksheet('TIÊU CHÍ'), 'template thiếu sheet TIÊU CHÍ');
    assert(tplWb.getWorksheet('File Chi Tiết'), 'template thiếu sheet File Chi Tiết');

    const tplFd = new FormData();
    tplFd.append('file', new Blob([tplBuf]), 'mau-nap-khach-hang.xlsx');
    const tplUp = await fetch(`${BASE}/customer-assignments/import`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: tplFd,
      signal: AbortSignal.timeout(120000),
    });
    const tplJson = await tplUp.json().catch(() => null);
    assert(tplUp.status === 201, `nạp template → HTTP ${tplUp.status}: ${JSON.stringify(tplJson).slice(0, 200)}`);
    sessionIds.push(tplJson?.sessionId);
    assert(
      (tplJson?.summary?.customersParsed ?? 0) === 2,
      `template phải parse đúng 2 khách: ${JSON.stringify(tplJson?.summary)}`,
    );
    const tplErrText = JSON.stringify(tplJson?.errors || []);
    assert(
      !tplErrText.includes('phải là KEY hoặc NON'),
      `template sinh lỗi phân loại (lệch cột): ${tplErrText.slice(0, 300)}`,
    );
    ok('Template 2 dòng ví dụ nạp vào được, không lỗi phân loại');
  } catch (e) {
    bad('[N] Hồi quy so khớp', e.message);
  } finally {
    // Khách hồi quy xoá qua đúng luồng hệ thống (mềm) — không đụng DB trực tiếp
    if (conn) {
      try {
        for (const code of [CODE, `${CODE}B`]) {
          const [rows] = await conn.query(
            'SELECT a.id FROM customer_assignments a JOIN customers c ON c.id = a.customer_id WHERE c.customer_code = ?',
            [code],
          );
          for (const r of rows) { try { await call('DELETE', `/customers/${r.id}`, H()); } catch {} }
        }
      } catch {}
      try { await conn.end(); } catch {}
    }
    for (const sid of sessionIds) {
      try { await call('DELETE', `/customer-assignments/import-sessions/${sid}`, H()); } catch {}
    }
  }
}

// ============ P. Nhật ký đồng bộ NKM — ngày đã chạy (kể cả 0 dòng) khỏi bị gọi lại ============
{
  // Ngày cố ý chọn không có dữ liệu: 15/08/2026 (thứ Bảy, ngoài khoảng đã đồng bộ)
  const DAY = '2026-08-15';
  const RANGE = `?from=${DAY}&to=${DAY}`;
  let conn = null;
  try {
    const backendRequire = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
    const mysql = backendRequire('mysql2/promise');
    const envRaw = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), 'utf8');
    const env = Object.fromEntries(
      envRaw
        .split(/\r?\n/)
        .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
        .filter((m) => m && m[2] !== undefined)
        .map((m) => [m[1], m[2].trim().replace(/^["']|["']$/g, '')]));
    conn = await mysql.createConnection({
      host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
      user: env.DB_USERNAME, password: env.DB_PASSWORD, database: env.DB_NAME,
    });
    // Chắc trước: ngày này chưa có dữ liệu và chưa có nhật ký
    await conn.query('DELETE FROM nkm_sync_log WHERE stat_date = ?', [DAY]);

    await expect('[P] missing-days: ngày chưa chạy bị coi là hụt', 200, async () => {
      const r = await call('GET', `/nkm-mapping/missing-days${RANGE}`, H());
      assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
      assert(r.json?.includes(DAY), `kỳ vọng thấy ${DAY} trong danh sách hụt: ${JSON.stringify(r.json)}`);
      return r.status;
    });

    // Ghi nhật ký "đã chạy, hôm đó cả công ty không bán gì" (rows = 0)
    await conn.query(
      'INSERT INTO nkm_sync_log (stat_date, sales, `rows`, failed, provisional, created_at) VALUES (?, 72, 0, 0, 0, NOW())',
      [DAY]);

    await expect('[P] missing-days: ngày đã chạy dù 0 dòng cũng KHÔNG bị gọi lại', 200, async () => {
      const r = await call('GET', `/nkm-mapping/missing-days${RANGE}`, H());
      assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
      assert(!r.json?.includes(DAY), `ngày đã chạy vẫn bị coi là hụt: ${JSON.stringify(r.json)}`);
      return r.status;
    });

    // Ngày chạy BỊ LỖI thì vẫn phải bị coi là hụt để thử lại
    await conn.query('UPDATE nkm_sync_log SET failed = 3 WHERE stat_date = ?', [DAY]);
    await expect('[P] missing-days: ngày chạy bị lỗi vẫn bị coi là hụt (để thử lại)', 200, async () => {
      const r = await call('GET', `/nkm-mapping/missing-days${RANGE}`, H());
      assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
      assert(r.json?.includes(DAY), `ngày chạy lỗi phải nằm trong danh sách hụt: ${JSON.stringify(r.json)}`);
      return r.status;
    });
  } catch (e) {
    bad('[P] Chuẩn bị', e.message);
  } finally {
    if (conn) {
      try { await conn.query('DELETE FROM nkm_sync_log WHERE stat_date = ?', [DAY]); } catch {}
      try { await conn.end(); } catch {}
    }
  }
}
// ============ Q. Tiêu chí doanh số API NKM (v1.6) ============
// Hợp đồng mới: khoảng xem theo QUÝ TÀI CHÍNH, cột phân phối trên từng sale,
// tierSummary theo loại khách, chặn nhập tay, xuất file có sheet PHAN PHOI.
{
  const backendRequire = createRequire(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'));
  const qOf = (date) => {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const fiscalYear = month >= 4 ? d.getFullYear() : d.getFullYear() - 1;
    const quarter = month >= 4 ? Math.ceil((month - 3) / 3) : 4;
    return { fiscalYear, quarter, label: `Q${quarter}/${fiscalYear}` };
  };

  // 1. Không truyền gì → mặc định quý tài chính HIỆN TẠI
  await expect('[Q] overview không truyền tham số → mặc định quý tài chính hiện tại', 200, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview', H());
    assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    const expected = qOf(new Date());
    assert(r.json?.quarter, 'thiếu quarter');
    assert(r.json.quarter.label === expected.label, `quarter=${r.json.quarter.label}, kỳ vọng ${expected.label}`);
    assert(r.json.isWholeQuarter === true, `isWholeQuarter=${r.json.isWholeQuarter}`);
    // Khoảng ngày phải là đúng quý đó
    assert(/^\d{4}-\d{2}-\d{2}$/.test(r.json.from) && /^\d{4}-\d{2}-\d{2}$/.test(r.json.to), 'from/to sai định dạng');
    return r.status;
  });

  // 2. Hai tham số phải đi cùng nhau
  await expect('[Q] truyền fiscal_year không quarter → 400', 400, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026', H());
    assert(r.status === 400, `HTTP ${r.status}`);
    return r.status;
  });
  await expect('[Q] truyền quarter không fiscal_year → 400', 400, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview?quarter=3', H());
    assert(r.status === 400, `HTTP ${r.status}`);
    return r.status;
  });
  await expect('[Q] quarter ngoài 1..4 → 400 (validation pipe)', 400, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=9', H());
    assert(r.status === 400, `HTTP ${r.status}`);
    return r.status;
  });

  // 3. Hợp lệ → đủ 3 cấp báo cáo
  await expect('[Q] overview quý 3/2026 → sales[].revenue + groups[] + company', 200, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    assert(r.json.from === '2026-10-01' && r.json.to === '2026-12-31', `from/to=${r.json.from}..${r.json.to}`);
    assert(Array.isArray(r.json.sales) && r.json.sales.length > 0, 'thiếu sales');
    // Cột phân phối trên từng dòng sale
    for (const sale of r.json.sales.slice(0, 5)) {
      const rev = sale.revenue;
      assert(rev, `sale ${sale.saleId} thiếu revenue`);
      for (const field of ['keyCustomers', 'nonCustomers', 'dsoKey', 'dsoNon', 'keyShareRatio', 'quarterTarget', 'achievedRatio', 'achievedPct', 'verdict', 'keyFullyPassed', 'nonCriteria']) {
        assert(field in rev, `sale ${sale.saleId} thiếu trường revenue.${field}`);
      }
      assert('reached' in rev.keyCustomers && 'total' in rev.keyCustomers, 'keyCustomers sai hình dạng');
      assert('passed' in rev.nonCriteria && 'applicable' in rev.nonCriteria, 'nonCriteria sai hình dạng');
    }
    assert(Array.isArray(r.json.groups) && r.json.groups.length > 0, 'thiếu groups');
    assert(r.json.company && 'dsoKey' in r.json.company && 'verdict' in r.json.company, 'company sai hình dạng');
    // Tổng công ty = tổng các nhóm (theo cách làm: cộng dồn, không trùng doanh thu)
    return r.status;
  });

  // 4. Lọc theo tiêu chí doanh số (met/minRatio đọc % ĐẠT, không đọc tỷ lệ Key/Non)
  await expect('[Q] lọc criterionKey=doanh_so_key&met=false → 200', 200, async () => {
    const all = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    const filtered = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3&criterionKey=doanh_so_key&met=false', H());
    assert(filtered.status === 200, `HTTP ${filtered.status}: ${filtered.text?.slice(0, 200)}`);
    assert(filtered.json.sales.length <= all.json.sales.length, 'lọc met=false trả nhiều sale hơn tổng');
    for (const sale of filtered.json.sales) {
      const criterion = sale.criteria.find((c) => c.key === 'doanh_so_key');
      assert(criterion && (criterion.revenue?.verdict === 'fail'), `sale ${sale.saleId} không đạt nhưng vẫn lọt lọc`);
    }
    return filtered.status;
  });
  await expect('[Q] lọc criterionKey=doanh_so_key&minRatio=100 → 200', 200, async () => {
    const r = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3&criterionKey=doanh_so_key&minRatio=100', H());
    assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    for (const sale of r.json.sales) {
      const criterion = sale.criteria.find((c) => c.key === 'doanh_so_key');
      assert(criterion && (criterion.revenue?.achievedPct ?? 0) >= 100, `sale ${sale.saleId} % đạt ${criterion?.revenue?.achievedPct} < 100`);
    }
    return r.status;
  });
  await expect('[Q] lọc chéo: summary vẫn đếm trên tập đầy đủ, không nhảy số khi bật lọc', 200, async () => {
    const plain = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    const filtered = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3&criterionKey=doanh_so_key&met=false', H());
    const keyOf = (json, key) => json.summary.find((s) => s.key === key);
    const a = keyOf(plain.json, 'doanh_so_key');
    const b = keyOf(filtered.json, 'doanh_so_key');
    assert(a && b, `thiếu summary doanh_so_key (${JSON.stringify(plain.json.summary?.map((s) => s.key))})`);
    assert(a.totalSales === b.totalSales, `totalSales đổi: ${a.totalSales} → ${b.totalSales}`);
    assert(a.notMetSales === b.notMetSales, `notMetSales đổi: ${a.notMetSales} → ${b.notMetSales}`);
    return filtered.status;
  });

  // 5. by-sale: tierSummary + chỉ chấm đúng loại khách
  await expect('[Q] by-sale: mỗi khách có tierSummary, cột doanh số đúng loại khách', 200, async () => {
    const overview = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    const withCustomers = overview.json.sales.find((s) => s.revenue.nonCriteria.customers + s.revenue.keyFullyPassed.total > 0);
    assert(withCustomers, 'không có sale nào có khách để kiểm tra');
    const r = await call('GET', `/customer-kpi-reports/by-sale?saleId=${withCustomers.saleId}&fiscal_year=2026&quarter=3&pageSize=200`, H());
    assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    assert(r.json.quarter?.label === 'Q3/2026', `quarter=${JSON.stringify(r.json.quarter)}`);
    const sale = (r.json.sales || [])[0];
    assert(sale && sale.customers?.length > 0, 'by-sale không có khách');
    assert(sale.revenue && 'achievedPct' in sale.revenue, 'by-sale thiếu revenue');
    const byKey = new Map(sale.criteria.map((c) => [c.key, c]));
    for (const customer of sale.customers) {
      const tier = (customer.customerTier || '').toUpperCase();
      const summary = customer.tierSummary;
      assert(summary && summary.tier === (tier || null), `khách ${customer.customerCode} thiếu tierSummary đúng loại`);
      const keyCell = customer.criteria.find((c) => c.key === 'doanh_so_key');
      const nonCell = customer.criteria.find((c) => c.key === 'doanh_so_non');
      if (tier === 'KEY') {
        assert(keyCell && keyCell.notApplicable !== true, `khách KEY bị bỏ qua ô doanh_so_key: ${JSON.stringify(keyCell)}`);
        assert(nonCell && nonCell.notApplicable === true, `khách KEY KHÔNG được chấm doanh_so_non: ${JSON.stringify(nonCell)}`);
        assert(summary.verdict === 'pass' || summary.verdict === 'fail', `khách KEY phải có kết luận: ${JSON.stringify(summary)}`);
        assert(summary.applicable === 4, `khách KEY phải chấm 4 tiêu chí: ${JSON.stringify(summary)}`);
      } else if (tier === 'NON') {
        assert(nonCell && nonCell.notApplicable !== true, `khách NON bị bỏ qua ô doanh_so_non: ${JSON.stringify(nonCell)}`);
        assert(keyCell && keyCell.notApplicable === true, `khách NON KHÔNG được chấm doanh_so_key: ${JSON.stringify(keyCell)}`);
        assert(summary.verdict === null, `khách NON không được kết luận: ${JSON.stringify(summary)}`);
        assert(summary.applicable === 4, `khách NON phải chấm 4 tiêu chí: ${JSON.stringify(summary)}`);
      }
      // Ô đúng loại phải có số phiếu/doanh số (kể cả 0)
      const cell = tier === 'KEY' ? keyCell : nonCell;
      if (cell && cell.notApplicable !== true) {
        assert(typeof cell.quantity === 'number' && typeof cell.lineTotal === 'number', `thiếu quantity/lineTotal: ${JSON.stringify(cell)}`);
      }
    }
    return r.status;
  });

  // 6. Khoảng không trọn quý → không so chỉ tiêu
  await expect('[Q] by-sale theo TUẦN → chỉ doanh thu thực, không kết luận', 200, async () => {
    const overview = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    // Chọn sale ĐÃ tra được mã NKM (dsoKey/quarterTarget không null) — sale chưa
    // nạp bảng tra mã trả no_data, không có object revenue để kiểm tra.
    const mapped = overview.json.sales.find(
      (x) => x.revenue.dsoKey !== null || x.revenue.quarterTarget !== null,
    );
    assert(mapped, 'không có sale nào tra được mã NKM — bỏ qua kiểm tra xem tuần');
    const r = await call('GET', `/customer-kpi-reports/by-sale?saleId=${mapped.saleId}&from=2026-10-05&to=2026-10-11`, H());
    assert(r.status === 200, `HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
    assert(r.json.quarter === null, `khoảng tuần không được coi là trọn quý: ${JSON.stringify(r.json.quarter)}`);
    assert(r.json.isWholeQuarter === false, 'isWholeQuarter phải false');
    const sale = (r.json.sales || [])[0];
    for (const criterion of sale.criteria.filter((c) => c.key.startsWith('doanh_so'))) {
      assert(criterion.revenue.verdict === null, `${criterion.key} không được kết luận khi xem tuần`);
      assert(criterion.revenue.achievedRatio === null, `${criterion.key} không được tính % đạt khi xem tuần`);
      assert(criterion.status === 'ratio', `${criterion.key} phải trả ratio khi xem tuần, nhận ${criterion.status}`);
    }
    return r.status;
  });

  // 7. Chặn nhập tay tiêu chí doanh số
  await expect('[Q] POST /customer-kpi-overrides tiêu chí doanh số → 400', 400, async () => {
    const overview = await call('GET', '/customer-kpi-reports/overview?fiscal_year=2026&quarter=3', H());
    const saleId = overview.json.sales[0]?.saleId;
    const r = await call('POST', '/customer-kpi-overrides', {
      ...H(),
      body: { sale_id: saleId, customer_id: 0, criterion_key: 'doanh_so_key', period_month: '2026-10', reason: 'thử chặn' },
    });
    assert(r.status === 400, `HTTP ${r.status}: ${r.text?.slice(0, 150)}`);
    return r.status;
  });

  // 8. Xuất file phải có sheet PHAN PHOI
  await expect('[Q] export quý 3/2026 → file có 3 sheet, có PHAN PHOI', 200, async () => {
    const res = await fetch(
      `${BASE}/customer-kpi-reports/export?fiscal_year=2026&quarter=3`,
      { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(120000) },
    );
    assert(res.status === 200, `HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('spreadsheetml'), `content-type=${contentType}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const ExcelJS = backendRequire('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const names = wb.worksheets.map((w) => w.name);
    assert(names.length === 3, `kỳ vọng 3 sheet, nhận ${names.join(', ')}`);
    assert(names.some((n) => n.includes('PHAN PHOI')), `thiếu sheet PHAN PHOI: ${names.join(', ')}`);
    // Sheet phân phối phải có hàng CÔNG TY
    const sheet = wb.worksheets.find((w) => w.name.includes('PHAN PHOI'));
    const values = [];
    sheet.eachRow((row) => values.push(row.values.map((v) => String(v ?? ''))));
    assert(values.some((cells) => cells.some((v) => v.includes('CÔNG TY'))), 'thiếu hàng tổng công ty');
    assert(values.some((cells) => cells.some((v) => v.includes('Tỷ lệ'))), 'thiếu cột Tỷ lệ (DS Key)');
    return res.status;
  });

  // 9. Nhóm /nkm-mapping đọc được
  await expect('[Q] GET /nkm-mapping/sales + groups → 200, data là mảng', 200, async () => {
    const sales = await call('GET', '/nkm-mapping/sales', H());
    const groups = await call('GET', '/nkm-mapping/groups', H());
    assert(sales.status === 200 && Array.isArray(sales.json?.data), `sales HTTP ${sales.status}`);
    assert(groups.status === 200 && Array.isArray(groups.json?.data), `groups HTTP ${groups.status}`);
    if (sales.json.data.length > 0) {
      const row = sales.json.data[0];
      for (const field of ['slp_code', 'sale_label', 'employee_code', 'dept_slug']) {
        assert(field in row, `nkm_sale_map thiếu trường ${field}`);
      }
    }
    return sales.status;
  });
}

// ============ R. XUẤT DANH SÁCH PHÂN CÔNG RA EXCEL ĐÚNG BẢN NẠP ============
// File xuất ra phải nạp ngược lại được qua import và (khi không lọc) không
// sinh bất kỳ thay đổi nào — đó mới là "xuất đúng bản để sửa bằng Excel".
console.log('\n-- R. Xuất danh sách phân công ra Excel đúng bản nạp --');
{
  const tag = Date.now().toString(36).slice(-6).toUpperCase();
  const CODE = `KPIR_${tag}`;
  const SAP = `S${tag}R`;
  const EMP = `KEX${tag}`;
  const sessionIds = [];
  const assignmentIds = [];
  let saleId = null;
  let conn = null;

  try {
    const require2 = createRequire(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'),
    );
    const ExcelJS = require2('exceljs');
    // Cần đọc thẳng customer_import_changes — khách test chìm trong ~10k dòng
    // xoá của các khách vắng mặt trong file LỌC (cùng cách nhóm N đọc).
    try {
      const mysql = require2('mysql2/promise');
      const parseEnv = (file) => {
        const out = {};
        try {
          for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
            const i = line.indexOf('=');
            if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
          }
        } catch {}
        return out;
      };
      const backendEnv = parseEnv(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'));
      conn = await mysql.createConnection({
        host: backendEnv.DB_HOST, port: +(backendEnv.DB_PORT || 3306),
        user: backendEnv.DB_USERNAME, password: backendEnv.DB_PASSWORD, database: backendEnv.DB_NAME,
      });
    } catch {}
    const readWorkbook = async (buffer) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      return wb;
    };
    const uploadWorkbook = async (buffer, name) => {
      const fd = new FormData();
      fd.append('file', new Blob([buffer]), name);
      const res = await fetch(`${BASE}/customer-assignments/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: fd,
        signal: AbortSignal.timeout(180000),
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    };
    // cells của một dòng, cắt theo số cột yêu cầu (exceljs: values[0] là nil)
    const cellsOf = (row, width) => {
      const cells = (row.values || []).slice(1);
      for (let i = cells.length; i < width; i++) cells.push('');
      return cells.map((v) => String(v ?? ''));
    };

    // Chuẩn bị: 1 sale test + 1 khách 2 phòng (may-in KEY, pc NON, khách CHÍNH)
    const userRoleId = await findRoleId('user');
    const newUser = await call('POST', '/users', {
      ...H(),
      body: { username: `kpi_export_${tag}`, fullName: 'NV xuất file', employeeCode: EMP },
    });
    saleId = newUser.json?.id;
    if (!saleId && newUser.status === 409) {
      const s = await call('GET', `/users?search=${encodeURIComponent(`kpi_export_${tag}`)}&limit=5`, H());
      saleId = (s.json?.data || []).find((u) => u.username === `kpi_export_${tag}`)?.id;
    }
    assert(saleId, `không chuẩn bị được sale test: HTTP ${newUser.status} ${JSON.stringify(newUser.json).slice(0, 200)}`);
    if (userRoleId) await call('POST', `/users/${saleId}/roles`, { ...H(), body: [userRoleId] });
    for (const c of [
      { department_slug: 'may-in', customer_tier: 'KEY' },
      { department_slug: 'pc', customer_tier: 'NON' },
    ]) {
      const r = await call('POST', '/customers', {
        ...H(),
        body: {
          customer_code: CODE, sap_code: SAP, customer_role: 'CHINH',
          department_slug: c.department_slug, sale_id: saleId,
          customer_tier: c.customer_tier, customer_name: 'KH xuất file',
        },
      });
      assert(r.status === 201, `POST /customers (${c.department_slug}) → HTTP ${r.status}: ${r.text?.slice(0, 200)}`);
      if (r.json?.assignmentId) assignmentIds.push(r.json.assignmentId);
    }
    ok('Chuẩn bị 1 khách 2 phân công (may-in KEY + pc NON)');

    // 1) Không token → 401
    await expect('[R] export không token → 401', 401, async () =>
      (await fetch(`${BASE}/customer-assignments/export`)).status);

    // 2) Bộ lọc sai → 400
    await expect('[R] export tier=KEYY → 400', 400, async () =>
      (await call('GET', '/customer-assignments/export?tier=KEYY', H())).status);

    // 3) Export chỉ khách test → đúng content-type, tên file, 2 sheet, đủ cột
    const expRes = await fetch(
      `${BASE}/customer-assignments/export?search=${encodeURIComponent(CODE)}`,
      { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(120000) },
    );
    assert(expRes.status === 200, `export → HTTP ${expRes.status}`);
    const ct = expRes.headers.get('content-type') || '';
    assert(ct.includes('spreadsheetml'), `content-type=${ct}`);
    const cd = expRes.headers.get('content-disposition') || '';
    assert(cd.includes('phan-bo-khach-hang_'), `content-disposition=${cd}`);
    ok('Xuất file → 200, content-type + tên file đúng');
    const buf = Buffer.from(await expRes.arrayBuffer());
    const wb = await readWorkbook(buf);
    assert(wb.getWorksheet('TIÊU CHÍ'), 'thiếu sheet TIÊU CHÍ');
    const ws = wb.getWorksheet('File Chi Tiết');
    assert(ws, 'thiếu sheet File Chi Tiết');
    const header = cellsOf(ws.getRow(1), 1);
    for (const col of ['MÃ KH', 'LOẠI MÃ', 'MÃ ĐỐI TÁC SAP', 'S1-MÁY IN, MỰC IN', 'S1-PC, LCD',
      'LAPTOP', 'LINH KIỆN', 'MÁY IN', 'PC - SERVER', 'PTKH1', 'PTKH2', 'hạn mức', 'T04', 'ĐIỂM', 'tổng ds']) {
      assert(header.includes(col), `thiếu cột ${col} trong header`);
    }
    ok('Đủ 2 sheet + header giống bản mẫu import');

    // 4) Dòng dữ liệu: đúng khách, 2 phòng trên CÙNG dòng, đúng nhân viên/tier
    const dataRows = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const cells = cellsOf(row, header.length);
      if (cells.some((v) => v !== '')) dataRows.push(cells);
    });
    assert(dataRows.length === 1, `search khách test phải ra đúng 1 dòng, nhận ${dataRows.length}`);
    const R = dataRows[0];
    const idx = (name) => header.indexOf(name);
    assert(R[idx('MÃ KH')] === CODE, `cột MÃ KH = ${R[idx('MÃ KH')]}, kỳ vọng ${CODE}`);
    assert(R[idx('MÃ ĐỐI TÁC SAP')] === SAP, `cột MÃ ĐỐI TÁC SAP = ${R[idx('MÃ ĐỐI TÁC SAP')]}`);
    assert(R[idx('LOẠI MÃ')] === 'CHÍNH', `cột LOẠI MÃ = ${R[idx('LOẠI MÃ')]}, kỳ vọng CHÍNH`);
    assert(R[idx('S1-MÁY IN, MỰC IN')] === `${EMP}-NV xuất file`, `cột S1-MÁY IN = ${R[idx('S1-MÁY IN, MỰC IN')]}`);
    assert(R[idx('S1-PC, LCD')] === `${EMP}-NV xuất file`, `cột S1-PC = ${R[idx('S1-PC, LCD')]}`);
    assert(R[idx('MÁY IN')] === 'Key', `cột MÁY IN = ${R[idx('MÁY IN')]} — tiếng Việt không dấu đúng chuẩn parser`);
    assert(R[idx('PC - SERVER')] === 'NON', `cột PC - SERVER = ${R[idx('PC - SERVER')]}`);
    // Phòng không có phân công phải để trống — nạp lại không hiểu là bỏ phòng
    for (const col of ['S1-PTTT', 'S1-LAPTOP', 'S1-PTKH1', 'S1-PTKH2', 'LAPTOP', 'LINH KIỆN', 'PTKH1', 'PTKH2']) {
      assert(R[idx(col)] === '', `cột ${col} phải trống, nhận ${R[idx(col)]}`);
    }
    ok('Dòng dữ liệu đúng: 2 phòng trên cùng dòng, nhân viên + KEY/NON đúng');

    // 5) Nạp NGƯỢC LẠI file vừa xuất (lọc theo khách test) → KHÁCH TEST không
    // được sinh bất kỳ thay đổi nào. Các khách khác vắng mặt trong file lọc sẽ
    // sinh lệnh xoá — đó là thiết kế có chủ đích của import, không kiểm ở đây.
    const back = await uploadWorkbook(buf, 'phan-bo-khach-hang.xlsx');
    assert(back.status === 201, `nạp lại file xuất → HTTP ${back.status}: ${JSON.stringify(back.json).slice(0, 200)}`);
    sessionIds.push(back.json?.sessionId);
    const s = back.json?.summary || {};
    assert((s.errorRows ?? 0) === 0, `file xuất nạp lại phải KHÔNG có dòng lỗi: ${JSON.stringify(back.json?.errors || [])}`);
    assert((s.unchanged ?? 0) >= 2, `2 phân công phải nhận diện là "không đổi": ${JSON.stringify(s)}`);
    // Đọc thẳng dòng thay đổi CỦA KHÁCH TEST (không dùng preview: khách test
    // chìm trong ~10k dòng xoá của các khách vắng mặt trong file lọc).
    if (conn) {
      const [mine] = await conn.query(
        'SELECT action, department_slug, error FROM customer_import_changes WHERE session_id = ? AND customer_code = ?',
        [back.json?.sessionId, CODE],
      );
      assert(mine.length === 2, `khách test phải có đúng 2 dòng thay đổi, nhận ${mine.length}: ${JSON.stringify(mine)}`);
      assert(mine.every((r) => r.action === 'unchanged'), `cả 2 dòng phải là "không đổi": ${JSON.stringify(mine)}`);
      assert(mine.every((r) => !r.error), `khách test không được có dòng lỗi: ${JSON.stringify(mine)}`);
      const depts = mine.map((r) => r.department_slug).sort();
      assert(depts.join(',') === 'may-in,pc', `phòng ban không đúng: ${depts.join(',')}`);
    }
    ok('Nạp ngược lại file xuất → 2 dòng "không đổi", khách test 0 thay đổi');

    // 5b) Xuất file KHÔNG lọc (toàn bộ DB) → vẫn parse được, có dữ liệu
    const fullRes = await fetch(
      `${BASE}/customer-assignments/export`,
      { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(300000) },
    );
    assert(fullRes.status === 200, `export toàn bộ → HTTP ${fullRes.status}`);
    const fullWb = await readWorkbook(Buffer.from(await fullRes.arrayBuffer()));
    const fullWs = fullWb.getWorksheet('File Chi Tiết');
    const fullHeader = cellsOf(fullWs.getRow(1), 1);
    let fullRows = 0;
    fullWs.eachRow((row, n) => { if (n > 1) { const c = cellsOf(row, fullHeader.length); if (c.some((v) => v !== '')) fullRows++; } });
    assert(fullRows >= 1, `DB dev có dữ liệu phải cho ≥1 dòng, nhận ${fullRows}`);
    ok(`Xuất toàn bộ (không lọc) → ${fullRows} dòng khách`);

    // 6) Lọc theo phòng: chỉ còn phân công phòng đó trên dòng xuất
    const pcRes = await fetch(
      `${BASE}/customer-assignments/export?search=${encodeURIComponent(CODE)}&department=pc`,
      { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(120000) },
    );
    assert(pcRes.status === 200, `export lọc phòng → HTTP ${pcRes.status}`);
    const pcWb = await readWorkbook(Buffer.from(await pcRes.arrayBuffer()));
    const pcWs = pcWb.getWorksheet('File Chi Tiết');
    const pcHeader = cellsOf(pcWs.getRow(1), 1);
    const pcCells = [];
    pcWs.eachRow((row, n) => { if (n > 1) { const c = cellsOf(row, pcHeader.length); if (c.some((v) => v !== '')) pcCells.push(c); } });
    assert(pcCells.length === 1, `lọc department=pc phải còn 1 dòng, nhận ${pcCells.length}`);
    const pcIdx = (name) => pcHeader.indexOf(name);
    assert(pcCells[0][pcIdx('S1-PC, LCD')] === `${EMP}-NV xuất file`, 'phải còn phân công pc');
    assert(pcCells[0][pcIdx('S1-MÁY IN, MỰC IN')] === '', 'phân công may-in phải bị lọc bỏ');
    ok('Lọc department=pc → dòng xuất chỉ còn phân công phòng pc');

    // 7) Lọc phòng không có dữ liệu → file chỉ còn header
    const lapRes = await fetch(
      `${BASE}/customer-assignments/export?search=${encodeURIComponent(CODE)}&department=laptop`,
      { headers: { Authorization: `Bearer ${adminToken}` }, signal: AbortSignal.timeout(120000) },
    );
    assert(lapRes.status === 200, `export lọc laptop → HTTP ${lapRes.status}`);
    const lapWb = await readWorkbook(Buffer.from(await lapRes.arrayBuffer()));
    const lapWs = lapWb.getWorksheet('File Chi Tiết');
    let lapRows = 0;
    lapWs.eachRow((row, n) => { if (n > 1 && (row.values || []).slice(1).some((v) => v !== '' && v != null)) lapRows++; });
    assert(lapRows === 0, `không có phân công laptop phải cho 0 dòng dữ liệu, nhận ${lapRows}`);
    ok('Lọc department=laptop → 0 dòng dữ liệu (file chỉ có header)');
  } catch (e) {
    bad('[R] Xuất danh sách phân công', e.message);
  } finally {
    // Khách test xoá mềm qua đúng luồng hệ thống; session import huỷ sạch
    for (const aid of assignmentIds) {
      try { await call('DELETE', `/customers/${aid}`, H()); } catch {}
    }
    for (const sid of sessionIds) {
      try { await call('DELETE', `/customer-assignments/import-sessions/${sid}`, H()); } catch {}
    }
    if (saleId) {
      try { await call('DELETE', `/users/${saleId}`, H()); } catch {}
    }
    if (conn) { try { await conn.end(); } catch {} }
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
