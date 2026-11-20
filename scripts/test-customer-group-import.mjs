#!/usr/bin/env node
/**
 * Test end-to-end khách gộp qua API thật (server + DB dev):
 * upload file có STT merge → preview thấy tier kế thừa → apply tạo link MẸ/CON
 * → GET /customers trả group → export merge STT + blank tier → rollback sạch.
 *
 * Chạy:
 *   ADMIN_PASS=<mật khẩu admin> npm run test:customer-group-import
 * hoặc:
 *   node scripts/test-customer-group-import.mjs [BASE_URL] [ADMIN_USER] [ADMIN_PASS]
 *
 * Script dùng 1 sale có sẵn (qua /customers/filter-sales), tạo khách test mã
 * riêng rồi rollback + huỷ session — không để lại khách hoạt động.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guardOrExit, inspectTarget, readEnvKey } from './dev-guard.mjs';

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const BASE = (positional[0] || process.env.BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const ADMIN_USER = positional[1] || process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = positional[2] || process.env.ADMIN_PASS || 'admin';
const backendRootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
guardOrExit(
  inspectTarget({
    baseUrl: BASE,
    extraUrls: [readEnvKey(path.join(backendRootDir, '.env'), 'PYTHON_API_URL')],
    envFiles: [
      { label: 'backend .env', file: path.join(backendRootDir, '.env'), keys: ['DB_NAME'] },
    ],
  }),
  { scriptName: 'test-customer-group-import.mjs' },
);

const require2 = createRequire(path.join(backendRootDir, 'package.json'));
const ExcelJS = require2('exceljs');
let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
  if (cond) {
    passed += 1;
    console.log('  ✓', name);
  } else {
    failed += 1;
    console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra).slice(0, 800) : '');
  }
};

const headers = [
  'STT',
  'MÃ ĐỐI TÁC SAP',
  'Mã',
  'MÃ KH',
  'S1-MÁY IN, MỰC IN',
  'S1-PC, LCD',
  'S1-PTTT',
  'S1-LAPTOP',
  'S1-PTKH1',
  'S1-PTKH2',
  'LAPTOP',
  'LINH KIỆN',
  'MÁY IN',
  'PC - SERVER',
  'PTKH1',
  'PTKH2',
];

async function login() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => null);
  if (!json?.access_token) {
    throw new Error(`Login ${res.status}: ${JSON.stringify(json)?.slice(0, 300)}`);
  }
  return json.access_token;
}

async function call(token, method, pathname, body, extraHeaders = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { status: res.status, json, text };
}

async function main() {
  const token = await login();
  console.log('Đăng nhập admin OK');

  // 1 sale có mã nhân viên để parser map được.
  const sales = await call(token, 'GET', '/customers/filter-sales');
  const sale = (sales.json?.data || []).find(
    (item) => item.employeeCode && String(item.employeeCode).trim(),
  );
  if (!sale) throw new Error('Không tìm thấy sale nào có employeeCode');
  console.log(`Dùng sale #${sale.id} (${sale.employeeCode})`);

  const tag = Date.now().toString(36).slice(-6).toUpperCase();
  const CODE_ME = `KGRP_${tag}_ME`;
  const CODE_CON = `KGRP_${tag}_CON`;
  const SAP_ME = `G${tag}M`;
  const SAP_CON = `G${tag}C`;
  const emp = String(sale.employeeCode).trim();

  // Workbook: MẸ KEY ở MÁY IN + CON để trống MÁY IN (kế thừa), STT merge.
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('File Chi Tiết');
  ws.addRow(headers);
  ws.addRow([
    1,
    SAP_ME,
    'MẸ',
    CODE_ME,
    emp,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    'KEY',
    '',
    '',
    '',
  ]);
  ws.addRow([
    1,
    SAP_CON,
    'CON',
    CODE_CON,
    emp,
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  ws.mergeCells('A2:A3');
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  // Upload
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), 'khach-gop-test.xlsx');
  const uploadRes = await fetch(`${BASE}/customer-assignments/import`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: fd,
    signal: AbortSignal.timeout(180000),
  });
  const upload = await uploadRes.json().catch(() => null);
  check('Upload → 201', uploadRes.status === 201, upload);
  const sessionId = upload?.sessionId;
  if (!sessionId) throw new Error('Không có sessionId');
  check(
    'summary.groupsParsed = 1',
    upload?.summary?.groupsParsed === 1,
    upload?.summary,
  );
  check(
    'summary.inheritedTierCells = 1',
    upload?.summary?.inheritedTierCells === 1,
    upload?.summary,
  );
  check(
    'groups[0].main_code = MẸ',
    upload?.groups?.[0]?.main_code === CODE_ME,
    upload?.groups?.[0],
  );
  check(
    'warnings nhóm rỗng',
    (upload?.groups?.[0]?.warnings || []).length === 0,
    upload?.groups?.[0]?.warnings,
  );

  // Preview: chỉ lấy action=create để bỏ hàng nghìn dòng delete của khách
  // vắng mặt trong file lọc. Khách test là mã mới nên parent nằm trong
  // new_data.customer của change CREATE.
  const preview = await call(
    token,
    'GET',
    `/customer-assignments/import-sessions/${sessionId}/preview?action=create&page=1&pageSize=200`,
  );
  const changes = preview.json?.data || [];
  const conChange = changes.find(
    (row) => row.customer_code === CODE_CON && row.department_slug === 'may-in',
  );
  check('Preview có dòng CON may-in', !!conChange, changes.slice(0, 5));
  check(
    'CON may-in tier = KEY + tier_inherited',
    conChange?.new_data?.customer_tier === 'KEY' &&
      conChange?.new_data?.tier_inherited === true,
    conChange?.new_data,
  );
  check(
    'Preview top-level tier_inherited (FE đọc trực tiếp)',
    conChange?.tier_inherited === true,
    conChange,
  );
  const parentOk = changes.some(
    (row) =>
      row.customer_code === CODE_CON &&
      (row.new_data?.customer?.parent_customer_code === CODE_ME ||
        row.new_data?.parent_customer_code === CODE_ME ||
        row.parent_customer_code === CODE_ME),
  );
  check('Preview có parent MẸ/CON', parentOk, changes);
  check(
    'Preview top-level parent_customer_code (FE đọc trực tiếp)',
    changes.some(
      (row) =>
        row.customer_code === CODE_CON &&
        row.parent_customer_code === CODE_ME,
    ),
    changes,
  );

  // Apply
  const apply = await call(
    token,
    'POST',
    `/customer-assignments/import-sessions/${sessionId}/apply`,
  );
  check('Apply → 200', apply.status === 200 || apply.status === 201, apply.json);
  check('Apply không conflict nhóm', (apply.json?.conflicts || []).length === 0, apply.json);

  // GET /customers: CON có group trỏ MẸ, size 2.
  const list = await call(
    token,
    'GET',
    `/customers?search=${encodeURIComponent(CODE_CON)}&page=1&pageSize=20`,
  );
  const conRow = (list.json?.data || []).find(
    (row) => row.customer?.customerCode === CODE_CON,
  );
  check('GET /customers thấy CON', !!conRow, list.json);
  check(
    'CON group.role = CON + parentCustomerCode = MẸ',
    conRow?.group?.role === 'CON' &&
      conRow?.group?.parentCustomerCode === CODE_ME,
    conRow?.group,
  );
  check('Nhóm size = 2', conRow?.group?.size === 2, conRow?.group);

  // Visit coverage cũng phải trả group (FE dùng row.group để hiện badge).
  const visit = await call(
    token,
    'GET',
    `/customer-kpi-reports/visit-coverage?saleId=${sale.id}&search=${encodeURIComponent(CODE_CON)}&page=1&pageSize=50`,
  );
  const visitCon = (visit.json?.customers || []).find(
    (row) => row.customerCode === CODE_CON,
  );
  check('Visit coverage thấy CON', !!visitCon, visit.json);
  check(
    'Visit coverage trả group CON + mã MẸ',
    visitCon?.group?.role === 'CON' &&
      visitCon?.group?.parentCustomerCode === CODE_ME &&
      visitCon?.group?.size === 2,
    visitCon?.group,
  );

  // KPI group-aware: chèn activity cho MẸ, CON phải nhận tiêu chí liên lạc
  // (TC4) dù totals.outbound của CON = 0.
  let db = null;
  try {
    const mysql = require2('mysql2/promise');
    const envFile = path.join(backendRootDir, '.env');
    db = await mysql.createConnection({
      host: readEnvKey(envFile, 'DB_HOST'),
      port: Number(readEnvKey(envFile, 'DB_PORT') || 3306),
      user: readEnvKey(envFile, 'DB_USERNAME'),
      password: readEnvKey(envFile, 'DB_PASSWORD'),
      database: readEnvKey(envFile, 'DB_NAME'),
    });
  } catch (error) {
    console.log('  (bỏ qua KPI group check — không kết nối được DB:', error.message, ')');
  }
  if (db) {
    const meList = await call(
      token,
      'GET',
      `/customers?search=${encodeURIComponent(CODE_ME)}&page=1&pageSize=20`,
    );
    const meRow = (meList.json?.data || []).find(
      (row) => row.customer?.customerCode === CODE_ME,
    );
    const meAssignmentId = meRow?.assignmentId;
    if (!meAssignmentId) {
      check('Tìm được assignment MẸ', false, meList.json);
    } else {
      await db.query(
        `INSERT INTO customer_activity_daily
           (assignment_id, stat_date, inbound_count, outbound_count, order_count, revenue, zalo_linked)
         VALUES (?, CURDATE(), 0, 1, 0, 0, 1)
         ON DUPLICATE KEY UPDATE outbound_count = 1, zalo_linked = 1`,
        [meAssignmentId],
      );
      try {
        const bySale = await call(
          token,
          'GET',
          `/customer-kpi-reports/by-sale?saleId=${sale.id}&search=${encodeURIComponent(CODE_CON)}&page=1&pageSize=50`,
        );
        const conKpi = (bySale.json?.sales?.[0]?.customers || []).find(
          (row) => row.customerCode === CODE_CON,
        );
        const contactCrit = (conKpi?.criteria || []).find(
          (criterion) => criterion.key === 'lien_lac_phan_hoi',
        );
        check('by-sale thấy CON', !!conKpi, bySale.json);
        check(
          'CON TC4 pass nhờ activity của MẸ (group days)',
          contactCrit?.status === 'pass',
          contactCrit,
        );
        check(
          'CON totals.outbound vẫn = 0 (số liệu riêng)',
          conKpi?.totals?.outbound === 0,
          conKpi?.totals,
        );
        check(
          'by-sale trả group CON + mã MẸ',
          conKpi?.group?.role === 'CON' &&
            conKpi?.group?.parentCustomerCode === CODE_ME,
          conKpi?.group,
        );
      } finally {
        await db.query(
          'DELETE FROM customer_activity_daily WHERE assignment_id = ? AND stat_date = CURDATE()',
          [meAssignmentId],
        );
      }

      // Doanh số: nếu sale có map NKM, chèn doanh số cho MẸ → CON KEY phải
      // "có phát sinh" dù doanh số riêng = 0.
      const [mapRows] = await db.query(
        'SELECT slp_code FROM nkm_sale_map WHERE employee_code = ? AND is_active = 1 LIMIT 1',
        [emp],
      );
      const slpCode = mapRows?.[0]?.slp_code;
      if (slpCode != null) {
        await db.query(
          `INSERT INTO customer_revenue_daily
             (customer_code, slp_code, stat_date, quantity, line_total, line_vat, g_total, gross_profit, card_code, is_provisional)
           VALUES (?, ?, CURDATE(), 1, 100, 0, 100, 0, ?, 0)
           ON DUPLICATE KEY UPDATE quantity = 1, line_total = 100, g_total = 100, is_provisional = 0`,
          [CODE_ME, slpCode, CODE_ME],
        );
        try {
          const bySale = await call(
            token,
            'GET',
            `/customer-kpi-reports/by-sale?saleId=${sale.id}&search=${encodeURIComponent(CODE_CON)}&page=1&pageSize=50`,
          );
          const conKpi = (bySale.json?.sales?.[0]?.customers || []).find(
            (row) => row.customerCode === CODE_CON,
          );
          const revenueCrit = (conKpi?.criteria || []).find(
            (criterion) => criterion.key === 'doanh_so_key',
          );
          check(
            'CON doanh_so_key pass nhờ MẸ cùng tier',
            revenueCrit?.status === 'pass',
            revenueCrit,
          );
          check(
            'CON revenueStatus = has_revenue',
            conKpi?.revenueStatus === 'has_revenue',
            conKpi?.revenueStatus,
          );
          if (conKpi?.groupRevenue?.lineTotal != null) {
            check(
              'CON groupRevenue.lineTotal = 100',
              Number(conKpi.groupRevenue.lineTotal) === 100,
              conKpi.groupRevenue,
            );
          }
        } finally {
          await db.query(
            'DELETE FROM customer_revenue_daily WHERE customer_code = ? AND slp_code = ? AND stat_date = CURDATE()',
            [CODE_ME, slpCode],
          );
        }
      } else {
        console.log(
          '  (bỏ qua doanh số nhóm — sale chưa có nkm_sale_map cho employee_code)',
        );
      }
    }
    await db.end();
  }

  // Export: 2 dòng, MẸ trước, STT merge, tier MÁY IN của CON trống.
  const exportRes = await fetch(
    `${BASE}/customer-assignments/export?search=${encodeURIComponent(`KGRP_${tag}`)}`,
    { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180000) },
  );
  check('Export → 200', exportRes.status === 200, exportRes.status);
  const exportWb = new ExcelJS.Workbook();
  await exportWb.xlsx.load(Buffer.from(await exportRes.arrayBuffer()));
  const exportWs = exportWb.getWorksheet('File Chi Tiết');
  const exportHeader = (exportWs.getRow(1).values || []).slice(1).map(String);
  const rows = [];
  exportWs.eachRow((row, n) => {
    if (n === 1) return;
    const cells = (row.values || []).slice(1).map((v) => String(v ?? ''));
    if (cells.some((v) => v !== '')) rows.push(cells);
  });
  check('Export có 2 dòng nhóm', rows.length === 2, rows);
  check('Dòng 1 là MẸ', rows[0]?.[exportHeader.indexOf('MÃ KH')] === CODE_ME, rows[0]);
  check('Dòng 2 là CON', rows[1]?.[exportHeader.indexOf('MÃ KH')] === CODE_CON, rows[1]);
  check(
    'STT ô CON merge vào MẸ',
    exportWs.getCell('A3').isMerged &&
      exportWs.getCell('A3').master.address === 'A2',
    exportWs.getCell('A3').isMerged,
  );
  check(
    'CON MÁY IN để trống (kế thừa)',
    rows[1]?.[exportHeader.indexOf('MÁY IN')] === '',
    rows[1]?.[exportHeader.indexOf('MÁY IN')],
  );

  // Rollback: khách test biến mất khỏi danh sách hoạt động.
  const rollback = await call(
    token,
    'POST',
    `/customer-assignments/import-sessions/${sessionId}/rollback`,
  );
  check('Rollback → 200', rollback.status === 200 || rollback.status === 201, rollback.json);
  const after = await call(
    token,
    'GET',
    `/customers?search=${encodeURIComponent(CODE_CON)}&page=1&pageSize=20`,
  );
  check(
    'Sau rollback không còn CON hoạt động',
    (after.json?.data || []).length === 0,
    after.json,
  );

  // Dọn session đã rollback.
  await call(token, 'DELETE', `/customer-assignments/import-sessions/${sessionId}`);

  console.log(`\n===== ${passed} pass, ${failed} fail =====`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('❌ test-customer-group-import failed:', error);
  process.exit(1);
});
