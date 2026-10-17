#!/usr/bin/env node
/**
 * Sửa bảng `typeorm_metadata` cho các cột GENERATED COLUMN của TypeORM.
 *
 * Vì sao cần: TypeORM so biểu thức cột generated giữa entity (asExpression) và
 * giá trị nó tự lưu ở `typeorm_metadata` (không so với MySQL vì MySQL chuẩn hoá
 * chuỗi khác đi). Nếu dòng metadata thiếu / giá trị lệch / cột `schema` trỏ sai
 * database (hay gặp sau khi copy dữ liệu giữa các schema), mỗi lần boot backend
 * sẽ: DROP các index phụ thuộc -> ALTER TABLE CHANGE COLUMN (bảng STORED bị
 * rebuild) -> CREATE INDEX lại. Nhánh code của TypeORM chỉ UPDATE, không INSERT,
 * nên thiếu dòng thì không bao giờ tự hết.
 *
 * Script này đọc asExpression ĐÚNG từ code (dist/*.entity.js) rồi ghi lại dòng
 * metadata cho khớp -> lần boot sau không còn churn. Chạy lại nhiều lần vô hại.
 *
 * Cách dùng (đứng ở thư mục backend, backend nên đang DỪNG):
 *   npm run build                                   # để dist khớp code
 *   node scripts/fix-typeorm-metadata.mjs           # xem trước (mặc định dry-run)
 *   node scripts/fix-typeorm-metadata.mjs --apply   # ghi thật
 *
 * Đọc cấu hình DB từ .env (DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME).
 * Muốn trỏ sang DB khác thì truyền biến môi trường, ví dụ:
 *   DB_NAME=nguyenkim_autozalo_v2 node scripts/fix-typeorm-metadata.mjs --apply
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(scriptDir, '..');
const distDir = path.join(backendRoot, 'dist');
const APPLY = process.argv.includes('--apply');

// ---- .env (không override biến môi trường đã có sẵn trên dòng lệnh) --------
const envPath = path.join(backendRoot, '.env');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const { default: mysql } = await import(
  pathToFileURL(path.join(backendRoot, 'node_modules', 'mysql2', 'promise.js')).href
);
const typeorm = await import(
  pathToFileURL(path.join(backendRoot, 'node_modules', 'typeorm', 'index.js')).href
);
const { CustomNamingStrategy } = await import(
  pathToFileURL(path.join(distDir, 'config', 'custom-naming.strategy.js')).href
);

if (!existsSync(distDir)) {
  console.error(`❌ Chưa có ${distDir} — chạy "npm run build" trước.`);
  process.exit(1);
}

// ---- 1. lấy danh sách cột generated từ metadata trong dist ----------------
const ds = new typeorm.DataSource({
  type: 'mysql',
  host: 'localhost',
  database: 'metadata-only',
  entities: [distDir.replace(/\\/g, '/') + '/**/*.entity.js'],
  namingStrategy: new CustomNamingStrategy(),
});
await ds.buildMetadatas();

const expected = new Map(); // table -> [{ column, value }]
for (const m of ds.entityMetadatas) {
  const cols = m.columns.filter((c) => c.generatedType && c.asExpression);
  if (!cols.length) continue;
  expected.set(
    m.tableName,
    cols.map((c) => ({ column: c.databaseName, value: c.asExpression })),
  );
}
console.log(
  `Cột generated theo entity: ${[...expected.entries()]
    .map(([t, c]) => `${t}(${c.length})`)
    .join(', ') || '(không có)'}`,
);

// ---- 2. đối chiếu với DB --------------------------------------------------
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 3306),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectTimeout: 15000,
});
const [[{ db }]] = await conn.query('SELECT DATABASE() AS db');
console.log(`DB đích: ${db}@${process.env.DB_HOST}  |  chế độ: ${APPLY ? 'GHI THẬT (--apply)' : 'dry-run'}\n`);

const actions = [];
for (const [table, cols] of expected) {
  const [[cnt]] = await conn.query(
    'SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    [table],
  );
  if (!cnt.c) {
    console.log(`- ${table}: bảng chưa tồn tại trong DB, bỏ qua`);
    continue;
  }
  for (const { column, value } of cols) {
    const [rows] = await conn.query(
      "SELECT `schema`, `value` FROM `typeorm_metadata` WHERE `type` = 'GENERATED_COLUMN' AND `table` = ? AND `name` = ?",
      [table, column],
    );
    const ok =
      rows.length === 1 && rows[0].schema === db && rows[0].value === value;
    if (ok) {
      console.log(`- ${table}.${column}: OK (giá trị khớp, schema đúng)`);
      continue;
    }
    const why = !rows.length
      ? 'thiếu dòng metadata'
      : rows.length > 1
        ? `có ${rows.length} dòng trùng`
        : rows[0].schema !== db
          ? `schema sai ("${rows[0].schema}" != "${db}")`
          : 'giá trị biểu thức lệch với code';
    console.log(`- ${table}.${column}: CẦN SỬA (${why})`);
    actions.push({ table, column, value, rows: rows.length });
  }
}

if (!actions.length) {
  console.log('\n✅ Không có gì phải sửa — metadata đã khớp code.');
  await conn.end();
  process.exit(0);
}

console.log(`\n${actions.length} mục cần sửa.`);
if (!APPLY) {
  console.log('(dry-run) Chạy lại kèm --apply để ghi, ví dụ:');
  console.log('  node scripts/fix-typeorm-metadata.mjs --apply');
  await conn.end();
  process.exit(0);
}

for (const a of actions) {
  await conn.query(
    "DELETE FROM `typeorm_metadata` WHERE `type` = 'GENERATED_COLUMN' AND `table` = ? AND `name` = ?",
    [a.table, a.column],
  );
  await conn.query(
    "INSERT INTO `typeorm_metadata` (`type`, `schema`, `table`, `name`, `value`) VALUES ('GENERATED_COLUMN', DATABASE(), ?, ?, ?)",
    [a.table, a.column, a.value],
  );
  console.log(`  ✔ đã ghi lại ${a.table}.${a.column}`);
}

console.log('\n✅ Xong. Kiểm tra lại bằng: node scripts/fix-typeorm-metadata.mjs');
console.log('   (Boot backend sau đó sẽ không còn DROP/ALTER các cột này.)');
await conn.end();
