/**
 * Test export/import khách gộp — KHÔNG cần DB/server.
 *
 * Chạy: npm run test:import-export-groups
 *
 * Kiểm:
 * - Export gom MẸ + CON vào cùng nhóm, merge ô STT.
 * - CON có tier trùng MẸ cùng phòng → xuất ô trống (giữ kế thừa).
 * - CON có tier KHÁC MẸ → xuất KEY/NON cụ thể.
 * - Nạp lại chính file vừa xuất → parser nhận đúng nhóm và kế thừa.
 */
import * as assert from 'node:assert/strict';
import * as ExcelJS from 'exceljs';
import { CustomerAssignmentsService } from '../src/customer-kpi/customer-assignments.service';
import {
  Customer,
  CustomerRole,
  CustomerStatus,
} from '../src/customer-kpi/customer.entity';
import {
  CustomerAssignment,
  CustomerTier,
} from '../src/customer-kpi/customer-assignment.entity';
import { parseImportWorkbook } from '../src/customer-kpi/customer-import-parser';

const customer = (
  id: number,
  code: string,
  sap: string,
  role: CustomerRole,
  parentId: number | null,
): Customer =>
  ({
    id,
    customer_code: code,
    sap_code: sap,
    customer_role: role,
    parent_customer_id: parentId,
    credit_days: 30,
    status: CustomerStatus.ACTIVE,
    customer_name: null,
  }) as Customer;

const assignment = (
  id: number,
  customerId: number,
  department: string,
  tier: CustomerTier,
): CustomerAssignment =>
  ({
    id,
    customer_id: customerId,
    department_slug: department,
    customer_tier: tier,
    sale: { employeeCode: 'NV01', fullName: 'Nguyễn Văn A' },
    sale_id: 1,
    zalo_account_id: null,
  }) as any;

async function main() {
  const me = customer(1, 'CODE_ME', 'C1', CustomerRole.CHINH, null);
  const con = customer(2, 'CODE_CON', 'C2', CustomerRole.PHU, 1);
  const byCustomer = new Map<
    number,
    { customer: Customer; assignments: CustomerAssignment[] }
  >([
    [
      1,
      {
        customer: me,
        assignments: [
          assignment(11, 1, 'may-in', CustomerTier.KEY),
          assignment(12, 1, 'pc', CustomerTier.NON),
        ],
      },
    ],
    [
      2,
      {
        customer: con,
        assignments: [
          // may-in trùng MẸ (KEY) → xuất trống để kế thừa
          assignment(21, 2, 'may-in', CustomerTier.KEY),
          // pc khác MẸ (MẸ NON, CON KEY) → xuất cụ thể
          assignment(22, 2, 'pc', CustomerTier.KEY),
        ],
      },
    ],
  ]);

  // writeAssignmentsWorkbook không dùng repo — chỉ cần instance rỗng.
  const service = new (CustomerAssignmentsService as any)(
    ...Array(12).fill(undefined),
  );
  const buffer = await service.writeAssignmentsWorkbook(ExcelJS, byCustomer);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.getWorksheet('File Chi Tiết');
  assert.ok(ws, 'thiếu sheet File Chi Tiết');

  const header = (ws.getRow(1).values as any[]).slice(1).map(String);
  const rowOf = (n: number) =>
    (ws.getRow(n).values as any[]).slice(1).map((v) => String(v ?? ''));
  const idx = (name: string) => {
    const i = header.indexOf(name);
    assert.ok(i >= 0, `thiếu cột ${name}`);
    return i;
  };

  // MẸ trước, CON sau; STT merge A2:A3.
  assert.equal(rowOf(2)[idx('MÃ KH')], 'CODE_ME', 'dòng 2 phải là MẸ');
  assert.equal(rowOf(3)[idx('MÃ KH')], 'CODE_CON', 'dòng 3 phải là CON');
  assert.equal(rowOf(2)[idx('LOẠI MÃ')], 'CHÍNH');
  assert.equal(rowOf(3)[idx('LOẠI MÃ')], 'PHỤ');
  assert.ok(
    ws.getCell('A3').isMerged &&
      ws.getCell('A3').master.address === 'A2',
    'ô STT của CON phải merge vào dòng MẸ',
  );

  // MẸ: may-in Key, pc NON. CON: may-in trống (kế thừa), pc Key (khác MẸ).
  assert.equal(rowOf(2)[idx('MÁY IN')], 'Key');
  assert.equal(rowOf(2)[idx('PC - SERVER')], 'NON');
  assert.equal(
    rowOf(3)[idx('MÁY IN')],
    '',
    'CON may-in trùng MẸ phải để trống',
  );
  assert.equal(
    rowOf(3)[idx('PC - SERVER')],
    'Key',
    'CON pc khác MẸ phải ghi cụ thể',
  );

  // Nạp lại file vừa xuất → parser nhận nhóm + kế thừa đúng.
  const parsed = await parseImportWorkbook(buffer);
  assert.equal(parsed.groups.length, 1, 'phải nhận đúng 1 nhóm');
  const group = parsed.groups[0];
  assert.equal(group.main_code, 'CODE_ME');
  assert.equal(group.child_count, 1);
  assert.equal(group.inherited_tier_cells, 1);
  const parsedCon = parsed.customers.find(
    (row) => row.customer_code === 'CODE_CON',
  );
  assert.ok(parsedCon, 'thiếu khách CON sau khi nạp lại');
  assert.equal(parsedCon!.group_role, 'CON');
  assert.equal(parsedCon!.group_main_code, 'CODE_ME');
  assert.deepEqual(
    parsedCon!.assignments
      .map((item) => [
        item.department_slug,
        item.tier,
        item.tier_inherited,
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    [
      ['may-in', 'KEY', true],
      ['pc', 'KEY', false],
    ],
    'CON may-in phải kế thừa KEY; pc giữ KEY cụ thể',
  );

  console.log('OK: export/import khách gộp — STT merge + kế thừa blank-only');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
