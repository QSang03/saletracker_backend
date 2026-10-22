/**
 * Test script cho module activity-logs.
 * Chạy: node scripts/test-activity-log.mjs [baseUrl]
 */
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const BASE = process.argv[2] || 'http://127.0.0.1:4001';
const JWT_SECRET = process.env.JWT_SECRET;

let passed = 0;
let failed = 0;

function check(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${extra}`);
  }
}

async function db() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
}

function makeToken(user, roleName) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      fullName: user.full_name,
      email: user.email,
      status: 'active',
      isBlock: false,
      employeeCode: user.employee_code,
      isAdmin: roleName === 'admin',
      roles: [{ id: 1, name: roleName }],
      departments: [],
      permissions: [],
    },
    JWT_SECRET,
    { expiresIn: '1d' },
  );
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, body: json };
}

async function main() {
  const conn = await db();

  const [users] = await conn.query(
    `SELECT u.id, u.username, u.full_name, u.email, u.employee_code
     FROM users u
     LEFT JOIN users_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'admin' AND u.deleted_at IS NULL LIMIT 1`,
  );
  const [normalUsers] = await conn.query(
    `SELECT u.id, u.username, u.full_name FROM users u
     LEFT JOIN users_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE r.name <> 'admin' AND u.deleted_at IS NULL LIMIT 1`,
  );

  if (!users.length) throw new Error('Không tìm thấy user admin');
  const admin = users[0];
  const normal = normalUsers[0] || admin;

  const adminToken = makeToken(admin, 'admin');
  const userToken = makeToken(normal, normal === admin ? 'admin' : 'user');

  console.log(`\n▶ Testing activity-logs @ ${BASE}`);
  console.log(`   admin: ${admin.username} (#${admin.id})\n`);

  // ---------------------------------------------------------------- 1
  console.log('1) Ghi log đơn lẻ (POST /activity-logs)');
  const createRes = await api(adminToken, 'POST', '/activity-logs', {
    menu_path: '/dashboard/manager-order',
    menu_title: 'Quản lý đơn hàng',
    menu_group: 'Giao dịch',
    action: 'update',
    entity: 'orders',
    entity_id: '4521',
    changed_fields: ['status', 'note'],
    old_values: { status: 'pending', note: 'cũ', password: 'secret123' },
    new_values: { status: 'done', note: 'mới' },
    description: 'Cập nhật trạng thái đơn hàng #4521',
  });
  check('trả về 201', createRes.status === 201, `-> ${createRes.status}`);
  check('body success = true', createRes.body?.success === true);

  const [rows1] = await conn.query(
    `SELECT id, user_id, username_snapshot, menu_path, menu_title, action, entity, entity_id,
            changed_fields, old_values, new_values, description, ip_address, occurred_at
     FROM user_activity_logs WHERE description = ? ORDER BY id DESC LIMIT 1`,
    ['Cập nhật trạng thái đơn hàng #4521'],
  );
  const saved = rows1[0];
  check('bản ghi đã lưu vào DB', !!saved);
  check('user_id lấy từ JWT', saved?.user_id === admin.id, `-> ${saved?.user_id}`);
  check('username_snapshot đúng', saved?.username_snapshot === admin.username);
  check('menu_title lưu đúng', saved?.menu_title === 'Quản lý đơn hàng');
  check('action lưu đúng', saved?.action === 'update');
  check('changed_fields lưu đúng JSON', Array.isArray(saved?.changed_fields) && saved.changed_fields.length === 2);
  check('field nhạy cảm bị redact', saved?.old_values?.password === '***', `-> ${saved?.old_values?.password}`);
  check('field thường không bị đổi', saved?.old_values?.status === 'pending');
  check('ip_address được ghi', !!saved?.ip_address);
  check('occurred_at có giá trị', !!saved?.occurred_at);

  // ---------------------------------------------------------------- 2
  console.log('\n2) Không cho giả mạo userId từ body');
  await api(adminToken, 'POST', '/activity-logs', {
    user_id: 999999,
    userId: 999999,
    menu_path: '/dashboard/roles',
    action: 'view',
    description: 'SPOOF-TEST-abc',
  });
  const [rows2] = await conn.query(
    `SELECT user_id FROM user_activity_logs WHERE description = 'SPOOF-TEST-abc'`,
  );
  check('user_id trong body bị bỏ qua', rows2[0]?.user_id === admin.id, `-> ${rows2[0]?.user_id}`);
  await conn.query(`DELETE FROM user_activity_logs WHERE description = 'SPOOF-TEST-abc'`);

  // ---------------------------------------------------------------- 3
  console.log('\n3) Ghi log theo batch (POST /activity-logs/batch)');
  const batchRes = await api(adminToken, 'POST', '/activity-logs/batch', {
    items: [
      { menu_path: '/dashboard/customers', menu_title: 'Khách hàng', action: 'view', description: 'BATCH-TEST-1' },
      { menu_path: '/dashboard/debts', menu_title: 'Công nợ', action: 'delete', entity: 'debts', entity_id: '88', description: 'BATCH-TEST-2' },
      { menu_path: '/dashboard/products', menu_title: 'Sản phẩm', action: 'create', entity: 'products', description: 'BATCH-TEST-3' },
    ],
  });
  check('trả về 201', batchRes.status === 201, `-> ${batchRes.status}`);
  check('count = 3', batchRes.body?.count === 3, `-> ${batchRes.body?.count}`);
  const [rows3] = await conn.query(
    `SELECT COUNT(*) AS c FROM user_activity_logs WHERE description LIKE 'BATCH-TEST-%'`,
  );
  check('3 bản ghi được lưu', Number(rows3[0].c) === 3, `-> ${rows3[0].c}`);

  // batch vượt giới hạn 50 phải bị từ chối
  const tooMany = await api(adminToken, 'POST', '/activity-logs/batch', {
    items: Array.from({ length: 51 }, () => ({ menu_path: '/x', action: 'view' })),
  });
  check('batch > 50 bị chặn (400)', tooMany.status === 400, `-> ${tooMany.status}`);

  // ---------------------------------------------------------------- 4
  console.log('\n4) Danh sách + lọc (GET /activity-logs)');
  const listRes = await api(adminToken, 'GET', '/activity-logs?page=1&pageSize=50');
  check('trả về 200', listRes.status === 200, `-> ${listRes.status}`);
  check('có data + total', Array.isArray(listRes.body?.data) && typeof listRes.body?.total === 'number');
  check('total > 0', (listRes.body?.total ?? 0) > 0);
  const first = listRes.body?.data?.[0];
  check('bản ghi có menu_title', !!first?.menu_title);
  check('bản ghi join được user', first?.user?.id === admin.id || first?.user_id === admin.id);
  check('occurred_at định dạng YYYY-MM-DD HH:mm:ss', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(first?.occurred_at), `-> ${first?.occurred_at}`);

  const filterAction = await api(adminToken, 'GET', '/activity-logs?action=delete');
  check('lọc theo action', listRes.status === 200 && filterAction.body.data.every((r) => r.action === 'delete'));

  const filterUser = await api(adminToken, 'GET', `/activity-logs?user_id=${admin.id}`);
  check('lọc theo user_id', filterUser.body.data.every((r) => r.user_id === admin.id));

  const filterMenu = await api(adminToken, 'GET', '/activity-logs?menu_path=/dashboard/manager-order');
  check('lọc theo menu_path', filterMenu.body.data.every((r) => r.menu_path === '/dashboard/manager-order'));

  const filterSearch = await api(adminToken, 'GET', '/activity-logs?search=BATCH-TEST');
  check('lọc theo search', filterSearch.body.total >= 3, `-> ${filterSearch.body.total}`);

  // lọc theo ngày (giờ VN)
  const todayVN = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const filterDate = await api(adminToken, 'GET', `/activity-logs?from=${todayVN}&to=${todayVN}`);
  check('lọc theo ngày (giờ VN) trả về dữ liệu hôm nay', filterDate.body.total > 0, `-> ${filterDate.body.total}`);

  const filterPast = await api(adminToken, 'GET', '/activity-logs?from=2000-01-01&to=2000-01-02');
  check('lọc ngày không có dữ liệu -> total 0', filterPast.body.total === 0, `-> ${filterPast.body.total}`);

  // ---------------------------------------------------------------- 5
  console.log('\n5) Chi tiết (GET /activity-logs/:id)');
  const detailRes = await api(adminToken, 'GET', `/activity-logs/${saved.id}`);
  check('trả về 200', detailRes.status === 200, `-> ${detailRes.status}`);
  check('trả đúng bản ghi', detailRes.body?.id === saved.id);
  const notFound = await api(adminToken, 'GET', '/activity-logs/999999999');
  check('id không tồn tại -> 404', notFound.status === 404, `-> ${notFound.status}`);

  // ---------------------------------------------------------------- 6
  console.log('\n6) Thống kê (GET /activity-logs/stats)');
  const statsRes = await api(adminToken, 'GET', '/activity-logs/stats');
  check('trả về 200', statsRes.status === 200, `-> ${statsRes.status}`);
  check('có total', typeof statsRes.body?.total === 'number');
  check('byMenu là mảng', Array.isArray(statsRes.body?.byMenu));
  check('byAction là mảng', Array.isArray(statsRes.body?.byAction));
  check('byUser là mảng', Array.isArray(statsRes.body?.byUser));
  check('byMenu có phần tử', (statsRes.body?.byMenu?.length ?? 0) > 0);
  check('byAction có phần tử', (statsRes.body?.byAction?.length ?? 0) > 0);

  // ---------------------------------------------------------------- 7
  console.log('\n7) Danh sách user để chọn (GET /activity-logs/users)');
  const usersRes = await api(adminToken, 'GET', '/activity-logs/users');
  check('trả về 200', usersRes.status === 200, `-> ${usersRes.status}`);
  check('trả về danh sách user', Array.isArray(usersRes.body) && usersRes.body.length > 0);
  check('user có fullName', usersRes.body?.[0]?.fullName !== undefined);
  const usersSearch = await api(adminToken, 'GET', `/activity-logs/users?search=${admin.username}`);
  check('tìm kiếm user hoạt động', usersSearch.body.some((u) => u.id === admin.id));

  // ---------------------------------------------------------------- 8
  console.log('\n8) Phân quyền');
  const noAuth = await api(null, 'GET', '/activity-logs');
  check('không token -> 401', noAuth.status === 401, `-> ${noAuth.status}`);

  if (normal !== admin) {
    const userList = await api(userToken, 'GET', '/activity-logs');
    check('user thường không xem được danh sách -> 403', userList.status === 403, `-> ${userList.status}`);
    const userPost = await api(userToken, 'POST', '/activity-logs', {
      menu_path: '/dashboard/orders',
      action: 'view',
      description: 'USER-POST-TEST',
    });
    check('user thường vẫn ghi được log của mình -> 201', userPost.status === 201, `-> ${userPost.status}`);
    const userDetail = await api(userToken, 'GET', `/activity-logs/${saved.id}`);
    check('user thường xem chi tiết của người khác -> 403', userDetail.status === 403, `-> ${userDetail.status}`);
    await conn.query(`DELETE FROM user_activity_logs WHERE description = 'USER-POST-TEST'`);
  } else {
    console.log('  ⚠️  Không tìm thấy user thường — bỏ qua test phân quyền user');
  }

  // ---------------------------------------------------------------- 9
  console.log('\n9) Dọn dữ liệu test');
  await conn.query(`DELETE FROM user_activity_logs WHERE description LIKE 'BATCH-TEST-%' OR description = 'Cập nhật trạng thái đơn hàng #4521'`);
  const [remain] = await conn.query(`SELECT COUNT(*) AS c FROM user_activity_logs`);
  console.log(`  ℹ️  Còn lại ${remain[0].c} bản ghi trong DB`);

  await conn.end();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`KẾT QUẢ: ${passed} pass, ${failed} fail`);
  console.log(`${'='.repeat(50)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('TEST CRASH:', e);
  process.exit(1);
});
