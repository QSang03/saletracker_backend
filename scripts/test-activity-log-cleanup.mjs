/**
 * Test cronjob dọn lịch sử thao tác: giữ N tháng theo env ACTIVITY_RETENTION_MONTHS.
 * Chạy: node scripts/test-activity-log-cleanup.mjs
 */
import { createRequire } from 'node:module';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const { DataSource } = require('typeorm');
const { typeOrmConfig } = require('../dist/config/typeorm.config.js');
const { ActivityLog } = require('../dist/activity-logs/activity-log.entity.js');
const {
  ActivityLogCleanupCronjobService,
} = require('../dist/cronjobs/activity-log-cleanup.cronjob.service.js');

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

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const ds = new DataSource(typeOrmConfig);
  await ds.initialize();
  const repo = ds.getRepository(ActivityLog);
  const service = new ActivityLogCleanupCronjobService(repo);

  console.log('\n▶ Test cronjob dọn lịch sử thao tác');
  console.log(`   ACTIVITY_RETENTION_MONTHS = ${process.env.ACTIVITY_RETENTION_MONTHS}`);
  console.log(`   CRON_ACTIVITY_CLEANUP_TIME = ${process.env.CRON_ACTIVITY_CLEANUP_TIME}\n`);

  const marker = `CLEANUP-TEST-${Date.now()}`;

  // Dọn sạch dữ liệu test cũ nếu có
  await conn.query(`DELETE FROM user_activity_logs WHERE description LIKE ?`, [`${marker}%`]);

  // Chèn 3 bản ghi: 5 tháng trước (quá hạn), 45 ngày (trong hạn 3 tháng), 2 ngày (mới)
  const cases = [
    { label: 'cũ 5 tháng', at: monthsAgo(5), shouldRemain: false },
    { label: '45 ngày', at: new Date(Date.now() - 45 * 86400000), shouldRemain: true },
    { label: 'mới 2 ngày', at: new Date(Date.now() - 2 * 86400000), shouldRemain: true },
  ];

  for (const c of cases) {
    await conn.query(
      `INSERT INTO user_activity_logs
        (user_id, menu_path, menu_title, action, description, occurred_at, created_at, updated_at)
       VALUES (1, '/dashboard/test', 'Test', 'view', ?, ?, NOW(3), NOW(3))`,
      [`${marker}-${c.label}`, c.at],
    );
  }

  const [before] = await conn.query(
    `SELECT description, occurred_at FROM user_activity_logs WHERE description LIKE ? ORDER BY id`,
    [`${marker}%`],
  );
  check('đã chèn 3 bản ghi test', before.length === 3, `-> ${before.length}`);

  // Chạy cron
  await service.clearOldActivityLogs();

  const [after] = await conn.query(
    `SELECT description FROM user_activity_logs WHERE description LIKE ? ORDER BY id`,
    [`${marker}%`],
  );
  const remainDesc = after.map((r) => r.description);

  check(
    'bản ghi cũ 5 tháng đã bị xóa',
    !remainDesc.includes(`${marker}-cũ 5 tháng`),
    `-> còn: ${remainDesc.join(', ')}`,
  );
  check('bản ghi 45 ngày được giữ lại', remainDesc.includes(`${marker}-45 ngày`));
  check('bản ghi mới 2 ngày được giữ lại', remainDesc.includes(`${marker}-mới 2 ngày`));

  // ---- Đổi retention sang 1 tháng: bản ghi 45 ngày phải bị xóa ----
  console.log('\n  → Đổi ACTIVITY_RETENTION_MONTHS=1 và chạy lại');
  const originalRetention = process.env.ACTIVITY_RETENTION_MONTHS;
  process.env.ACTIVITY_RETENTION_MONTHS = '1';

  await conn.query(
    `INSERT INTO user_activity_logs
      (user_id, menu_path, menu_title, action, description, occurred_at, created_at, updated_at)
     VALUES (1, '/dashboard/test', 'Test', 'view', ?, ?, NOW(3), NOW(3))`,
    [`${marker}-45 ngày-lần-2`, new Date(Date.now() - 45 * 86400000)],
  );

  await service.clearOldActivityLogs();

  const [after2] = await conn.query(
    `SELECT description FROM user_activity_logs WHERE description LIKE ? ORDER BY id`,
    [`${marker}%`],
  );
  const remainDesc2 = after2.map((r) => r.description);
  check(
    'với retention = 1 tháng, bản ghi 45 ngày bị xóa',
    !remainDesc2.includes(`${marker}-45 ngày-lần-2`),
    `-> còn: ${remainDesc2.join(', ')}`,
  );
  check('bản ghi mới 2 ngày vẫn còn', remainDesc2.includes(`${marker}-mới 2 ngày`));

  process.env.ACTIVITY_RETENTION_MONTHS = originalRetention;

  // Dọn dẹp
  await conn.query(`DELETE FROM user_activity_logs WHERE description LIKE ?`, [`${marker}%`]);
  const [leftover] = await conn.query(
    `SELECT COUNT(*) AS c FROM user_activity_logs WHERE description LIKE ?`,
    [`${marker}%`],
  );
  check('dọn dẹp dữ liệu test', Number(leftover[0].c) === 0, `-> ${leftover[0].c}`);

  await ds.destroy();
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
