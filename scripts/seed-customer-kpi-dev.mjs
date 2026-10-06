#!/usr/bin/env node
/**
 * SEED dữ liệu DEV cho module khách-hang (KPI) — dữ liệu hoạt động tính ĐẾN HÔM NAY.
 *
 * Cach dung (giống test-customer-kpi.mjs — cần server đang chạy):
 *   npm run seed:customer-kpi-dev
 *   hoac: node scripts/seed-customer-kpi-dev.mjs [BASE_URL] [ADMIN_USER] [ADMIN_PASS]
 *
 * Flag (dạng --tên=giá-trị, có thể dùng nhiều lần):
 *   --days=30              số ngày dữ liệu hoạt động, tính lùi từ hôm nay (mặc định 30)
 *   --skip-import          bỏ qua nạp file demo (chỉ sinh lại dữ liệu hoạt động)
 *   --skip-zalo-links      không sinh cặp khớp customer_zalo
 *   --skip-targets         không sinh chỉ tiêu tháng hiện tại
 *   --zalo-links-ratio=0.75 tỉ lệ phân công được gắn cặp khớp (mặc định 0.75)
 *   --reset-activity       XOÁ dữ liệu activity/response của các sale kpi_emp trước khi sinh lại
 *
 * Nguyen tac "dong bo voi test":
 *   - Dùng đúng file demo  test-fixtures/DSKH KDS_CHÍNH PHỤ_KEY NON.xlsx
 *   - Tạo đúng 40 user nhóm J của test-customer-kpi.mjs tạo (username
 *     kpi_emp_<mã thường>, employeeCode NKDS**) — test chạy sau sẽ tái sử dụng,
 *     không nhân bản user.
 *   - Nạp khách + phân công qua đúng luồng import/apply của hệ thống (như nhóm J).
 *   - Bảng customer_activity_daily / customer_response_daily là bảng cron Python
 *     (Mục 4) sẽ ghi — script ghi trực tiếp để báo cáo có số ngay hôm nay.
 *
 * Chay lai an toàn: user/phan cong tái sử dụng; activity/response upsert theo
 * UNIQUE(assignment_id, stat_date) với PRNG cố định theo assignment_id nên
 * chay lại cho cùng kết quả; customer_zalo + kpi_targets dùng INSERT IGNORE
 * (không đè cặp khớp manual người dùng đã sửa tay).
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, '..');

// ---------- tham số ----------
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = {};
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const [k, ...rest] = a.slice(2).split('=');
  flags[k] = rest.length ? rest.join('=') : true;
}

const BASE = (positional[0] || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_USER = positional[1] || process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = positional[2] || process.env.ADMIN_PASS || 'admin';

const DAYS = Math.max(1, parseInt(flags.days ?? '30', 10) || 30);
const ZALO_LINKS_RATIO = flags['zalo-links-ratio'] != null
  ? Math.min(1, Math.max(0, parseFloat(flags['zalo-links-ratio'])))
  : 0.75;
const SKIP_IMPORT = !!flags['skip-import'];
const SKIP_ZALO = !!flags['skip-zalo-links'];
const SKIP_TARGETS = !!flags['skip-targets'];
const RESET_ACTIVITY = !!flags['reset-activity'];

const FIXTURE_PATH = path.join(backendRoot, 'test-fixtures', 'DSKH KDS_CHÍNH PHỤ_KEY NON.xlsx');

let adminToken = null;
let pass = 0;

function ok(msg) { pass++; console.log(`  ✓ ${msg}`); }
function assert(cond, msg) { if (!cond) throw new Error(msg); }
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function call(method, urlPath, { token, body } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(600000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

/** PRNG xác định theo seed — chạy lại cùng assignment cho cùng số liệu. */
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function fmtDate(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

function parseEnvFile(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch {}
  return env;
}

console.log(`\n== SEED DEV MODULE KHÁCH-HÀNG (KPI) ==\n   Server: ${BASE}\n   Admin: ${ADMIN_USER}\n   Số ngày hoạt động: ${DAYS} (tới hôm nay)\n`);

// ============ 1. Đăng nhập admin ============
{
  const r = await call('POST', '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASS } });
  adminToken = r.json?.access_token || r.json?.token || r.json?.accessToken;
  assert(adminToken, `Đăng nhập admin HTTP ${r.status} — kiểm tra user/pass hoặc truyền: node scripts/seed-customer-kpi-dev.mjs <BASE> <user> <pass>`);
  ok(`Đăng nhập admin`);
}
const H = () => ({ token: adminToken });

// ============ 2. Trích mã NV NKDS** + phòng ban từ file demo ============
// Phòng ban của từng NV xác định theo cột S1-* chứa mã đó (bảng ánh xạ A.4 của doc).
assert(existsSync(FIXTURE_PATH), `Không tìm thấy file demo: ${FIXTURE_PATH}`);
const requireBackend = createRequire(path.join(backendRoot, 'package.json'));
const ExcelJS = requireBackend('exceljs');

// Chuẩn hoá header để khớp tên cột bất chấp Unicode (Đ không tách được bằng NFD)
function normHeader(v) {
  return String(v ?? '')
    .replace(/[Đđ]/g, 'd')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** [header trong file, department_slug, tên phòng hiển thị] */
const DEPT_HEADERS = [
  ['S1-MÁY IN, MỰC IN', 'may-in', 'Kinh doanh - Máy In, Mực In'],
  ['S1-PC, LCD', 'pc', 'Kinh doanh - PC, Server'],
  ['S1-PTTT', 'linh-kien', 'Kinh doanh - Linh Kiện'],
  ['S1-LAPTOP', 'laptop', 'Kinh doanh - Laptop'],
  ['S1-PTKH1', 'ptkh1', 'Kinh doanh - PTKH1'],
  ['S1-PTKH2', 'ptkh2', 'Kinh doanh - PTKH2'],
];

const parsedDemo = await (async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE_PATH);
  const ws = wb.getWorksheet('File Chi Tiết');

  // Dòng header: dòng đầu tiên trong 10 dòng đầu có ô bắt đầu bằng "S1-"
  let headerRowIdx = 0;
  outer: for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    for (let c = 1; c <= ws.columnCount; c++) {
      if (normHeader(ws.getRow(r).getCell(c).value).startsWith('S1-')) {
        headerRowIdx = r;
        break outer;
      }
    }
  }
  assert(headerRowIdx > 0, 'không tìm thấy dòng header cột S1-* trong file demo');

  const colBySlug = new Map();
  for (const [header, slug] of DEPT_HEADERS) {
    let col = null;
    for (let c = 1; c <= ws.columnCount; c++) {
      if (normHeader(ws.getRow(headerRowIdx).getCell(c).value) === normHeader(header)) {
        col = c;
        break;
      }
    }
    assert(col, `không tìm thấy cột "${header}" trong file demo`);
    colBySlug.set(slug, col);
  }

  const codes = new Set();
  const empDept = new Map(); // employee_code -> department_slug (phòng đầu tiên gặp)
  for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    if (!String(row.getCell(3).value ?? '').trim()) continue;
    for (const [slug, col] of colBySlug) {
      const raw = String(row.getCell(col).value ?? '').trim();
      if (!raw) continue;
      const code = raw.split('-')[0].trim().toUpperCase();
      codes.add(code);
      if (!empDept.has(code)) empDept.set(code, slug);
    }
  }
  return { codes: [...codes].sort(), empDept };
})();

const NKDS_CODES = parsedDemo.codes;
const EMP_DEPT = parsedDemo.empDept;
assert(NKDS_CODES.length >= 30, `chỉ trích được ${NKDS_CODES.length} mã NV từ file demo`);
assert(EMP_DEPT.size === NKDS_CODES.length, 'có mã NV chưa xác định được phòng ban');
ok(`Trích ${NKDS_CODES.length} mã NV từ file demo (NKDS**) kèm phòng ban theo cột S1-*`);

// ============ 3. Đảm bảo user tồn tại — CÙNG QUY ƯỚC nhóm J của test ============
// username = kpi_emp_<mã thường>, employeeCode = mã NKDS → test chạy sau tìm thấy
// bằng search username và tái sử dụng, không nhân bản.
async function ensureUser(body) {
  const r = await call('POST', '/users', { ...H(), body });
  if (r.status === 201) return r.json?.id;
  if (r.status === 409 && r.json?.code === 'SOFT_DELETED_DUPLICATE') {
    const id = r.json?.userId;
    await call('PATCH', `/users/${id}/restore`, H());
    return id;
  }
  if (r.status === 409) {
    const s = await call('GET', `/users?search=${encodeURIComponent(body.username)}&limit=10`, H());
    const list = Array.isArray(s.json) ? s.json : s.json?.data || [];
    const u = list.find((x) => x.username === body.username);
    assert(u?.id, `user ${body.username} tồn tại nhưng tìm không thấy`);
    return u.id;
  }
  throw new Error(`Không tạo được user ${body.username}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
}

const saleUserIds = [];
for (const code of NKDS_CODES) {
  const id = await ensureUser({
    username: `kpi_emp_${code.toLowerCase()}`,
    fullName: `NV demo ${code}`,
    employeeCode: code,
  });
  saleUserIds.push(id);
}
ok(`Đảm bảo ${saleUserIds.length} user sale (kpi_emp_*, employeeCode NKDS**)`);

// ============ 3b. Phòng ban + vai trò — chia theo đúng phân bổ trong file demo ============
// 6 phòng kinh doanh (slug cố định của module), 40 sale chia theo cột S1-* của file,
// mỗi phòng 1 trưởng phòng (manager-khach-hang) + 1 PM xem toàn công ty.
const backendEnv = parseEnvFile(path.join(backendRoot, '.env'));
let mysql;
try { mysql = requireBackend('mysql2/promise'); } catch {
  throw new Error('Thiếu mysql2 — chạy: npm install trong saletracker_backend');
}
const now = new Date();
const stamp = `${fmtDate(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

const conn = await mysql.createConnection({
  host: backendEnv.DB_HOST,
  port: +(backendEnv.DB_PORT || 3306),
  user: backendEnv.DB_USERNAME,
  password: backendEnv.DB_PASSWORD,
  database: backendEnv.DB_NAME,
});

// Phòng ban: thiếu thì thêm, có rồi thì giữ nguyên (slug UNIQUE)
for (const [, slug, name] of DEPT_HEADERS) {
  await conn.query(
    "INSERT IGNORE INTO departments (name, slug, server_ip, created_at, updated_at) VALUES (?, ?, '', ?, ?)",
    [name, slug, stamp, stamp],
  );
}
const [deptRows] = await conn.query(
  'SELECT id, slug FROM departments WHERE slug IN (?)',
  [DEPT_HEADERS.map(([, slug]) => slug)],
);
const deptIdBySlug = new Map(deptRows.map((d) => [d.slug, Number(d.id)]));
assert(deptIdBySlug.size === DEPT_HEADERS.length, 'thiếu phòng ban sau khi seed departments');
ok(`Đảm bảo ${DEPT_HEADERS.length} phòng kinh doanh trong bảng departments`);

// Vai trò của module — seeder khởi động đã tạo từ trước
const [roleRows] = await conn.query(
  "SELECT id, name FROM roles WHERE name IN ('manager-khach-hang','user-khach-hang','pm-khach-hang')",
);
const roleIdByName = new Map(roleRows.map((r) => [r.name, Number(r.id)]));
assert(roleIdByName.size === 3, 'thiếu role khach-hang — seed nhóm quyền khi khởi động đã chạy chưa?');

async function ensureUserRoles(userId, roleIds) {
  for (const rid of roleIds) {
    await conn.query('INSERT IGNORE INTO users_roles (user_id, role_id) VALUES (?, ?)', [userId, rid]);
  }
}
async function ensureUserDepts(userId, deptIds) {
  for (const did of deptIds) {
    await conn.query('INSERT IGNORE INTO users_departments (user_id, department_id) VALUES (?, ?)', [userId, did]);
  }
}

// Sale: role user-khach-hang + đúng phòng theo cột S1-* chứa mã trong file
let assignedDept = 0;
for (let i = 0; i < NKDS_CODES.length; i++) {
  await ensureUserRoles(saleUserIds[i], [roleIdByName.get('user-khach-hang')]);
  const slug = EMP_DEPT.get(NKDS_CODES[i]);
  if (slug && deptIdBySlug.has(slug)) {
    await ensureUserDepts(saleUserIds[i], [deptIdBySlug.get(slug)]);
    assignedDept++;
  }
}
ok(`Gán role user-khach-hang + phòng ban cho ${assignedDept}/${NKDS_CODES.length} sale`);

// Trưởng phòng mỗi phòng: kpi_mgr_<slug>
for (const [, slug, name] of DEPT_HEADERS) {
  const id = await ensureUser({ username: `kpi_mgr_${slug}`, fullName: `Trưởng phòng ${name}` });
  await ensureUserRoles(id, [roleIdByName.get('manager-khach-hang')]);
  await ensureUserDepts(id, [deptIdBySlug.get(slug)]);
}
ok(`Đảm bảo ${DEPT_HEADERS.length} trưởng phòng (kpi_mgr_<phòng>, role manager-khach-hang)`);

// PM xem toàn công ty
const pmId = await ensureUser({ username: 'kpi_pm_demo', fullName: 'Quản lý dự án Kinh doanh' });
await ensureUserRoles(pmId, [roleIdByName.get('pm-khach-hang')]);
ok('Đảm bảo 1 PM (kpi_pm_demo, role pm-khach-hang)');

// Phân bổ thực tế sau khi gán
const [dist] = await conn.query(
  `SELECT d.slug, COUNT(*) n FROM users_departments ud
     JOIN departments d ON d.id = ud.department_id
     JOIN users u ON u.id = ud.user_id
    WHERE u.username LIKE 'kpi\\_emp\\_%' GROUP BY d.slug ORDER BY d.slug`,
);
console.log(`  • Sale theo phòng: ${dist.map((r) => `${r.slug}=${r.n}`).join(', ')}`);

// ============ 4. Nạp file demo qua đúng luồng import + apply của hệ thống ============
if (!SKIP_IMPORT) {
  const buf = readFileSync(FIXTURE_PATH);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), 'DSKH seed dev.xlsx');
  const up = await fetch(`${BASE}/customer-assignments/import`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    body: fd,
    signal: AbortSignal.timeout(180000),
  });
  const upJson = await up.json();
  assert(up.status === 201 && upJson?.sessionId, `Upload file demo HTTP ${up.status}: ${JSON.stringify(upJson).slice(0, 250)}`);
  const s = upJson.summary || {};
  ok(`Tạo session import #${upJson.sessionId} — ${JSON.stringify(s)}`);

  const ap = await fetch(`${BASE}/customer-assignments/import-sessions/${upJson.sessionId}/apply`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}` },
    signal: AbortSignal.timeout(600000),
  });
  const apJson = await ap.json();
  assert(ap.status === 200, `Apply HTTP ${ap.status}: ${JSON.stringify(apJson).slice(0, 250)}`);
  ok(`Apply session — applied ${apJson.applied}, bỏ qua lỗi ${apJson.skippedErrors}, conflict ${apJson.conflicts?.length ?? 0}`);
} else {
  console.log('  ⏭️ Bỏ qua nạp file demo (--skip-import)');
}

// ============ 5. Phần DB — sinh dữ liệu hoạt động tới hôm nay ============
// (kết nối `conn` đã mở từ mục 3b)

// 5a. Sale thuộc phạm vi seed = user kpi_emp_* (không đụng user thật khác)
const [saleRows] = await conn.query(
  "SELECT id FROM users WHERE username LIKE 'kpi\\_emp\\_%' AND deleted_at IS NULL",
);
const saleIds = saleRows.map((r) => Number(r.id));
assert(saleIds.length >= NKDS_CODES.length, `chỉ thấy ${saleIds.length} sale kpi_emp — còn thiếu user?`);
console.log(`  • Phạm vi seed: ${saleIds.length} sale kpi_emp (không đụng user thật)`);

// Sale demo "đã kết nối Zalo" để UI không hiện badge chưa kết nối cho toàn bộ,
// và cron Mục 4 sau này nhìn users.zaloLinkStatus cũng coi là đã liên kết.
await conn.query(
  "UPDATE users SET zalo_link_status = 1, zalo_name = username WHERE username LIKE 'kpi\\_emp\\_%' AND zalo_link_status <> 1",
);

// 5b. Danh sách phân công của các sale đó (khách đang hoạt động)
const [assignments] = await conn.query(
  `SELECT a.id, a.sale_id, a.customer_tier, c.customer_code, c.customer_name
     FROM customer_assignments a
     JOIN customers c ON c.id = a.customer_id AND c.status <> 'deleted'
    WHERE a.sale_id IN (?)`,
  [saleIds],
);
const asgList = assignments.map((r) => ({
  id: Number(r.id),
  tier: r.customer_tier,
  code: r.customer_code,
  name: r.customer_name,
}));
console.log(`  • Phân công sẽ có dữ liệu: ${asgList.length} dòng`);

if (RESET_ACTIVITY) {
  for (const ids of chunk(saleIds, 1000)) {
    await conn.query(
      `DELETE cad FROM customer_assignments a
         JOIN customer_activity_daily cad ON cad.assignment_id = a.id
        WHERE a.sale_id IN (?)`,
      [ids],
    );
    await conn.query(
      `DELETE crd FROM customer_assignments a
         JOIN customer_response_daily crd ON crd.assignment_id = a.id
        WHERE a.sale_id IN (?)`,
      [ids],
    );
  }
  ok(`--reset-activity: đã xoá dữ liệu hoạt động cũ của sale kpi_emp`);
}

// 5c. Sinh + upsert customer_activity_daily & customer_response_daily
const today = new Date();
const dates = [];
for (let i = DAYS - 1; i >= 0; i--) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
  dates.push({ date: d, key: fmtDate(d), dow: d.getDay() }); // 0 CN, 7? -> 0=CN, 6=Th7
}

const activityRows = [];
const responseRows = [];
for (const asg of asgList) {
  const rng = mulberry32(asg.id * 7919 + 17);
  // "tính cách" quan hệ Sale–khách, cố định theo assignment
  const level = rng();                    // 0 = lười liên lạc, 1 = chăm
  const keyBias = asg.tier === 'KEY' ? 1.35 : 0.7;  // Key được chăm nhiều hơn Non
  const startIdx = Math.floor(rng() * Math.min(DAYS, 10)); // khách vào danh sách muộn hơn
  const hasOffline = rng() < 0.12;        // một phần sale/quanthe có giai đoạn offline
  const offStart = hasOffline ? DAYS - 1 - Math.floor(rng() * Math.max(1, Math.floor(DAYS / 3))) : -1;
  const offLen = 1 + Math.floor(rng() * 4);

  for (let di = 0; di < dates.length; di++) {
    if (di < startIdx) continue; // chưa có dữ liệu trước khi vào danh sách
    const { key, dow } = dates[di];
    const weekend = dow === 0 || dow === 6;
    const offline = hasOffline && di >= offStart && di < offStart + offLen;

    let inbound = 0;
    let outbound = 0;
    let orderCount = 0;
    let revenue = 0;
    const zaloLinked = offline ? 0 : 1;

    if (!offline) {
      const chance = (0.2 + level * 0.65) * keyBias * (weekend ? 0.12 : 1);
      if (rng() < chance) {
        inbound = Math.floor(rng() * (1 + level * 5));
        outbound = 1 + Math.floor(rng() * (2 + level * 10));
        if (!weekend && rng() < 0.05) {
          orderCount = 1;
          revenue = Math.round((2 + rng() * 55) * 1e6); // 2–57 triệu
        }
      }
    }
    activityRows.push([asg.id, key, inbound, outbound, orderCount, revenue, zaloLinked]);

    // response_daily chỉ có khi khách nhắn trước trong giờ làm việc (thiết kế 4.7)
    if (inbound > 0 && !weekend && !offline) {
      const total = inbound;
      const responded = Math.floor(total * (0.45 + rng() * 0.55));
      const avg = Math.round(45 + rng() * 3500);
      responseRows.push([asg.id, key, total, responded, total - responded, avg]);
    }
  }
}

const ACT_UPSERT = `INSERT INTO customer_activity_daily
  (assignment_id, stat_date, inbound_count, outbound_count, order_count, revenue, zalo_linked, created_at, updated_at)
  VALUES ? ON DUPLICATE KEY UPDATE
  inbound_count = VALUES(inbound_count), outbound_count = VALUES(outbound_count),
  order_count = VALUES(order_count), revenue = VALUES(revenue),
  zalo_linked = VALUES(zalo_linked), updated_at = VALUES(updated_at)`;
const RESP_UPSERT = `INSERT INTO customer_response_daily
  (assignment_id, stat_date, total_intervals, responded_count, no_reply_count, avg_seconds, created_at, updated_at)
  VALUES ? ON DUPLICATE KEY UPDATE
  total_intervals = VALUES(total_intervals), responded_count = VALUES(responded_count),
  no_reply_count = VALUES(no_reply_count), avg_seconds = VALUES(avg_seconds), updated_at = VALUES(updated_at)`;

for (const rows of chunk(activityRows, 1000)) {
  await conn.query(ACT_UPSERT, [rows.map((r) => [...r, stamp, stamp])]);
}
for (const rows of chunk(responseRows, 1000)) {
  await conn.query(RESP_UPSERT, [rows.map((r) => [...r, stamp, stamp])]);
}
ok(`customer_activity_daily: ${activityRows.length} dòng (${DAYS} ngày × ${asgList.length} phân công)`);
ok(`customer_response_daily: ${responseRows.length} dòng`);

// 5d. Cặp khớp customer_zalo — chỉ thêm cho phân công CHƯA có link nào,
//     để không đè cặp manual người dùng đã sửa tay (job cũng không đụng).
if (!SKIP_ZALO) {
  const [existing] = await conn.query(
    'SELECT DISTINCT assignment_id FROM customer_zalo WHERE assignment_id IN (?)',
    [asgList.length ? asgList.map((a) => a.id) : [0]],
  );
  const hasLink = new Set(existing.map((r) => Number(r.assignment_id)));
  const POSITIONS = ['start', 'middle', 'end', 'only'];
  const linkRows = [];
  for (const asg of asgList) {
    if (hasLink.has(asg.id)) continue;
    if (mulberry32(asg.id * 104729 + 5)() > ZALO_LINKS_RATIO) continue;
    const pos = POSITIONS[Math.floor(mulberry32(asg.id * 31 + 7)() * POSITIONS.length)];
    const displayName = asg.name ? `${asg.name} (QH-${asg.id})` : `Liên hệ khách ${asg.code} (QH-${asg.id})`;
    const matchedName = pos === 'start' || pos === 'only'
      ? `${asg.code} - ${displayName}`
      : pos === 'middle'
        ? `Cty - ${asg.code} - ${displayName}`
        : `${displayName} ${asg.code}`;
    linkRows.push([asg.id, null, `devlink_${asg.id}`, matchedName, pos, 'auto_code', 1, stamp, stamp, stamp]);
  }
  if (linkRows.length) {
    for (const rows of chunk(linkRows, 1000)) {
      await conn.query(
        `INSERT IGNORE INTO customer_zalo
           (assignment_id, zalo_account_id, zalo_contact_id, matched_name, matched_position, match_method, is_active, last_verified_at, created_at, updated_at)
         VALUES ?`,
        [rows],
      );
    }
  }
  ok(`customer_zalo: thêm ${linkRows.length} cặp khớp auto_code (bỏ qua phân công đã có link)`);
} else {
  console.log('  ⏭️ Bỏ qua customer_zalo (--skip-zalo-links)');
}

// 5e. Chỉ tiêu tháng hiện tại cho 2 tiêu chí doanh số — gán cấp nhân viên
//     (customer_id = 0) cho từng sale kpi_emp. INSERT IGNORE để giữ số đã sửa tay.
if (!SKIP_TARGETS) {
  const month = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
  const [defs] = await conn.query(
    "SELECT criterion_key FROM kpi_definitions WHERE criterion_key IN ('doanh_so_key','doanh_so_non') AND is_active = 1",
  );
  const keys = defs.map((d) => d.criterion_key);
  if (keys.length) {
    const [adminRow] = await conn.query('SELECT id FROM users WHERE username = ? LIMIT 1', [ADMIN_USER]);
    const adminId = adminRow[0]?.id ?? null;
    const targetRows = [];
    for (const saleId of saleIds) {
      for (const k of keys) {
        const rng = mulberry32(saleId * 6007 + (k === 'doanh_so_key' ? 11 : 23));
        const base = k === 'doanh_so_key' ? 300 + rng() * 1700 : 150 + rng() * 850; // triệu
        targetRows.push([k, month, saleId, 0, Math.round(base) * 1e6, adminId, stamp]);
      }
    }
    for (const rows of chunk(targetRows, 1000)) {
      await conn.query(
        `INSERT IGNORE INTO kpi_targets
           (criterion_key, period_month, sale_id, customer_id, target_value, created_by, created_at)
         VALUES ?`,
        [rows],
      );
    }
    ok(`kpi_targets: ${targetRows.length} dòng chỉ tiêu tháng ${month} (${keys.join(', ')})`);
  } else {
    console.log('  ⏭️ Bỏ qua kpi_targets — chưa có tiêu chí doanh_so_key/doanh_so_non trong kpi_definitions');
  }
} else {
  console.log('  ⏭️ Bỏ qua kpi_targets (--skip-targets)');
}

await conn.end();

// ============ Tổng kết ============
console.log(`\n== SEED XONG: ${pass} bước đạt ==`);
console.log(`   Mẫu xem nhanh:
   - GET /customers?saleId=<id sale kpi_emp_*>  — danh sách + lọc zaloStatus
   - GET /customer-kpi-reports/customers/<assignmentId>?from=<${dates[0].key}>&to=${dates[dates.length - 1].key}
   - GET /customers/unmatched  — phần khách chưa gắn Zalo (${Math.round((1 - ZALO_LINKS_RATIO) * 100)}%)
   Báo cáo tổng quan/by-sale/suggestions là 501 cho đến khi xong Mục 4.`);
