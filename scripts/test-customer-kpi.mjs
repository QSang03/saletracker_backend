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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_USER = process.argv[3] || process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.argv[4] || process.env.ADMIN_PASS || 'admin';
const TEST_USER = process.env.TEST_USER;
const TEST_PASS = process.env.TEST_PASS;

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

// ============ D. HOP DONG 501 (phan cho Muc 3-4) ============
console.log('\n-- D. Hợp đồng 501 (chờ Mục 3-4) --');
await expect('PATCH /customers/zalo-links/1 (sửa tay khớp) → 501', 501,
  async () => (await call('PATCH', '/customers/zalo-links/1', { ...H(), body: { is_active: false } })).status);
await expect('POST /customer-assignments/import thiếu file → 400', 400,
  async () => (await call('POST', '/customer-assignments/import', H())).status);
  // duyệt (decide) đã hiện thực cho customer_list — nhóm H test hành vi thật
  await expect('GET /customer-kpi-reports/overview → 501', 501,
  async () => (await call('GET', '/customer-kpi-reports/overview?from=2026-10-01&to=2026-10-05', H())).status);
await expect('GET /customer-kpi-reports/by-sale → 501', 501,
  async () => (await call('GET', '/customer-kpi-reports/by-sale?from=2026-10-01&to=2026-10-05', H())).status);
await expect('GET /customer-kpi-reports/suggestions → 501', 501,
  async () => (await call('GET', '/customer-kpi-reports/suggestions', H())).status);
await expect('POST /customer-kpi-targets (gán chỉ tiêu) → 501', 501,
  async () => (await call('POST', '/customer-kpi-targets', {
    ...H(),
    body: { criterion_key: 'doanh_so_key', period_month: '2026-10', scope: 'sale', sale_ids: [1], target_value: 1000000 },
  })).status);

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

  // Dọn user test (xoá mềm — lần sau restore lại được)
  for (const id of createdTestUserIds) {
    try { await call('DELETE', `/users/${id}`, H()); } catch {}
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
  await expect('GET /customer-kpi-reports/export → 501', 501,
    async () => (await call('GET', '/customer-kpi-reports/export?from=2026-10-01&to=2026-10-05', H())).status);

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
  // 4. Dọn: xoá mềm khách + user + phòng ban (lần sau restore lại, không phình dữ liệu)
  if (createdCustomerAid) {
    try { await call('DELETE', `/customers/${createdCustomerAid}`, H()); } catch {}
  }
  for (const username of ['kpi_test_manager_khach_hang', 'kpi_test_user_khach_hang', 'kpi_test_pm_khach_hang']) {
    try {
      const s = await call('GET', `/users?search=${encodeURIComponent(username)}&limit=10`, H());
      const list = Array.isArray(s.json) ? s.json : s.json?.data || [];
      const u = list.find((x) => x.username === username);
      if (u?.id) await call('DELETE', `/users/${u.id}`, H());
    } catch {}
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
      if (s.create >= 9000) ok(`Số thay đổi tạo mới hợp lý (${s.create})`);
      else bad('Số thay đổi tạo mới', `nhận ${s.create}, kỳ vọng ≥9000 (mỗi khách tối đa 6 phòng)`);

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
// DB dev không có user bán hàng theo mã NKDS → nhóm này tự tạo user với đúng
// mã NV trích từ file demo, rồi apply/rollback trên quy mô thật. Dọn sạch sau.
console.log('\n-- J. Apply + Rollback (file demo thật + nhân viên test) --');
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

    // 3. Upload file demo (session riêng cho nhóm J)
    const buf = readFileSync(fixturePath);
    const fd = new FormData();
    fd.append('file', new Blob([buf]), 'DSKH apply-rollback.xlsx');
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

    // 4. Tổng khách trước khi apply
    const before = await call('GET', '/customers?pageSize=1', H());

    // 5. Apply — ~9.8k thay đổi, mất chục giây
    const ap = await fetch(`${BASE}/customer-assignments/import-sessions/${sessionId}/apply`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(600000),
    });
    const apJson = await ap.json();
    if (ap.status === 200 && (apJson?.applied ?? 0) >= 9000) {
      ok(`Apply → 200 (applied ${apJson.applied}, bỏ qua ${apJson.skippedErrors} dòng lỗi, conflict ${apJson.conflicts?.length})`);
    } else {
      bad('Apply', `HTTP ${ap.status}, body=${JSON.stringify(apJson).slice(0, 250)}`);
    }
    if ((apJson?.skippedErrors ?? 0) === 13) {
      ok(`Bỏ qua đúng 13 change mang lỗi (15 khách bẩn, 2 khách không có phân công nào)`);
    } else {
      bad('Số dòng lỗi bị bỏ qua', `nhận ${apJson?.skippedErrors}, kỳ vọng 13`);
    }

    // 6. Khách xuất hiện — 2 khách (2 SAP) × 4 phòng = 8 dòng phân công
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
    if (rb.status === 200 && (rbJson?.restored ?? 0) >= 9000) {
      ok(`Rollback → 200 (restored ${rbJson.restored}, skip ${rbJson.skipped?.length})`);
    } else {
      bad('Rollback', `HTTP ${rb.status}, body=${JSON.stringify(rbJson).slice(0, 250)}`);
    }

    // 8. Dữ liệu trở về đúng trạng thái ban đầu
    await expect('[J] Sau rollback: khách demo biến mất → total 0', 200, async () => {
      const r = await call('GET', '/customers?search=HQS_Q03_SM_CONGNGHE247&pageSize=10', H());
      assert(r.json?.total === 0, `total=${r.json?.total}`);
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
  // 10. Dọn user nhân viên test (xoá mềm — lần sau restore)
  for (const id of createdEmpIds) {
    try { await call('DELETE', `/users/${id}`, H()); } catch {}
  }
}

// ============ DỌN DẸP AN TOÀN ============
if (createdId) {
  try { await call('DELETE', `/customer-kpi-definitions/${createdId}`, H()); } catch {}
}

// ============ TONG KET ============
console.log(`\n== KẾT QUẢ: ${pass} đạt / ${fail} lỗi ==`);
if (failures.length) {
  console.log('Chi tiết lỗi:');
  for (const f of failures) console.log(`  - ${f.name}: ${f.detail}`);
  process.exit(1);
}
console.log('Tất cả testcase đều đạt.');
