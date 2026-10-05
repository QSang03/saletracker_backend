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

// ============ D. HOP DONG 501 (phan cho Muc 2-4) ============
console.log('\n-- D. Hợp đồng 501 (chờ Mục 2-4) --');
await expect('PATCH /customers/1 (sửa + duyệt) → 501', 501,
  async () => (await call('PATCH', '/customers/1', { ...H(), body: { customer_tier: 'KEY' } })).status);
await expect('PATCH /customers/zalo-links/1 (sửa tay khớp) → 501', 501,
  async () => (await call('PATCH', '/customers/zalo-links/1', { ...H(), body: { is_active: false } })).status);
await expect('POST /customer-assignments/import thiếu file → 400', 400,
  async () => (await call('POST', '/customer-assignments/import', H())).status);
await expect('POST import-sessions/1/apply → 501', 501,
  async () => (await call('POST', '/customer-assignments/import-sessions/1/apply', H())).status);
await expect('POST import-sessions/1/rollback → 501', 501,
  async () => (await call('POST', '/customer-assignments/import-sessions/1/rollback', H())).status);
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
await expect('POST /approval-requests/1/decide → 501', 501,
  async () => (await call('POST', '/approval-requests/1/decide', { ...H(), body: { action: 'approve' } })).status);

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
    expectUpdate: 501, // guard cho qua (update bật) → chạm stub 501
    expectDecide: 501, // approve bật → stub 501
  },
  {
    role: 'user-khach-hang',
    label: 'Nhân viên',
    expectUpdate: 501, // update bật (đề xuất qua luồng duyệt ở Mục 2) → stub 501
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
      await T(`POST /approval-requests/1/decide (approve) → ${expectDecide}`, expectDecide,
        async () => (await call('POST', '/approval-requests/1/decide', { ...U, body: { action: 'approve' } })).status);
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
    await expect('Danh sách sau xoá không còn khách đó', 200, async () => {
      const r = await call('GET', `/customers?search=${gCode}`, H());
      assert((r.json?.total ?? 1) === 0, `vẫn còn ${r.json?.total} dòng`);
      return r.status;
    });
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
