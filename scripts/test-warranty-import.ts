/**
 * Test import bảo hành từ Excel — KHÔNG cần DB (repo giả lập).
 *
 * Chạy: npm run test:warranty-import
 *
 * Che phủ:
 *  - Tìm header "MÃ HT"/"TGBH" không ở dòng 1, không phân biệt dấu/hoa thường
 *  - Dòng không có mã → bỏ qua im lặng
 *  - TGBH sai (trống / "12 tháng" / 12.5 / âm) → cảnh báo đúng dòng
 *  - Mã không tìm thấy → cảnh báo
 *  - Mã trùng trong file → last wins + cảnh báo
 *  - So khớp mã chuẩn hoá (thường/hoa, khoảng trắng, Đ→D)
 *  - Cập nhật: gom theo nhóm số tháng, set warranty_months + warranty_updated_at
 *  - Danh sách chỉ định nạp file (add idempotent / isImporter / remove)
 *  - Guard nạp file: admin luôn pass, người được chỉ định pass, còn lại 403
 */
import * as ExcelJS from 'exceljs';
import { WarrantyImportService } from '../src/products/warranty-import.service';
import { WarrantyImporterGuard } from '../src/products/warranty-importer.guard';
import { productWarrantyText } from '../src/sale-quotes/utils/text.util';

interface CapturedUpdate {
  months: number;
  ids: number[];
}

function makeFakeRepo(rows: { id: number; productCode: string }[]) {
  const updates: CapturedUpdate[] = [];

  const repo = {
    find: async () => rows,
    createQueryBuilder: () => {
      let months: number | null = null;
      let ids: number[] = [];
      const builder = {
        update: () => builder,
        set: (value: { warrantyMonths: number }) => {
          months = value.warrantyMonths;
          return builder;
        },
        where: (_sql: string, params: { ids: number[] }) => ({
          execute: async () => {
            if (months !== null) {
              updates.push({ months, ids: [...params.ids] });
            }
            return { affected: params.ids.length };
          },
        }),
      };
      return builder;
    },
  };

  return { repo, updates };
}

async function buildWorkbook(): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DS Bảo hành');

  // Header nằm ở dòng 3, có dấu + khoảng trắng lạ để test chuẩn hoá
  ws.getRow(3).getCell(2).value = 'MÃ  HT';
  ws.getRow(3).getCell(3).value = 'TGBH';

  ws.getRow(4).getCell(2).value = 'KV-2366';
  ws.getRow(4).getCell(3).value = 12; // hợp lệ

  ws.getRow(5).getCell(3).value = 24; // không có mã → bỏ qua

  ws.getRow(6).getCell(2).value = 'ABC-111';
  ws.getRow(6).getCell(3).value = '12 tháng'; // sai định dạng

  ws.getRow(7).getCell(2).value = 'NOT-EXIST';
  ws.getRow(7).getCell(3).value = 6; // mã không có trong hệ

  ws.getRow(8).getCell(2).value = 'KV-2366';
  ws.getRow(8).getCell(3).value = 18; // trùng mã — bị dòng sau ghi đè

  ws.getRow(9).getCell(2).value = ' kv-2366 '; // trùng mã (chữ thường + space)
  ws.getRow(9).getCell(3).value = 24; // last wins → 24

  ws.getRow(10).getCell(2).value = 'SAI-SO';
  ws.getRow(10).getCell(3).value = 3.5; // không phải số nguyên

  ws.getRow(11).getCell(2).value = 'ĐÔI-MỚI  '; // Đ→D + trim khi so khớp
  ws.getRow(11).getCell(3).value = 12; // hợp lệ

  return (await wb.xlsx.writeBuffer()) as ExcelJS.Buffer;
}

/** Fake repo cho bảng product_warranty_importers + users (giả lập DB). */
function makeImporterFakes(existingUserIds: number[]) {
  const rows: {
    id: number;
    userId: number;
    createdBy: number | null;
  }[] = [];
  let nextId = 1;

  const importerRepo = {
    find: async () =>
      rows.map((r) => ({
        ...r,
        createdAt: new Date(),
        user: { fullName: `User ${r.userId}`, username: `u${r.userId}`, roles: [] },
      })),
    findOne: async ({ where }: any) =>
      rows.find((r) => r.userId === where?.userId) ?? null,
    insert: async (entity: { userId: number; createdBy: number | null }) => {
      rows.push({ id: nextId++, userId: entity.userId, createdBy: entity.createdBy });
      return { identifiers: [{ id: nextId }] };
    },
    delete: async (criteria: any) => {
      // TypeORM: delete(criteria) nhận trực tiếp object giá trị cột.
      const where = criteria?.where ?? criteria;
      const idx = rows.findIndex((r) => r.userId === where?.userId);
      if (idx === -1) return { affected: 0 };
      rows.splice(idx, 1);
      return { affected: 1 };
    },
  };

  const userRepo = {
    findOne: async ({ where }: any) =>
      existingUserIds.includes(where?.id) ? { id: where.id } : null,
  };

  return { importerRepo, userRepo, rows };
}

async function main() {
  const { repo, updates } = makeFakeRepo([
    { id: 1, productCode: 'KV-2366' },
    { id: 2, productCode: 'ĐÔI-MỚI' },
  ]);
  const { importerRepo, userRepo } = makeImporterFakes([10, 20, 30, 555]);
  const service = new WarrantyImportService(
    repo as any,
    importerRepo as any,
    userRepo as any,
  );

  // ---- Case 1: import đầy đủ ----
  const file = {
    buffer: await buildWorkbook(),
    originalname: 'bao-hanh.xlsx',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Express.Multer.File;

  const result = await service.importFromExcel(file);
  console.log('KẾT QUẢ:', JSON.stringify(result, null, 2));
  console.log('CÁC LẦN UPDATE DB:', JSON.stringify(updates));

  const expect = (cond: boolean, label: string) => {
    if (!cond) {
      console.error(`❌ FAIL: ${label}`);
      process.exitCode = 1;
    } else {
      console.log(`✅ ${label}`);
    }
  };

  expect(result.totalRows === 7, '7 dòng có mã được đọc (bỏ 1 dòng không mã)');
  expect(result.skippedEmptyCode === 1, '1 dòng không mã bị bỏ qua');
  expect(result.invalidCount === 2, '2 dòng TGBH sai');
  expect(result.notFoundCount === 1, '1 dòng mã không tìm thấy');
  expect(result.updated === 2, '2 mã hợp lệ được cập nhật');
  expect(result.duplicateCodeCount === 1, '1 mã trùng trong file');
  expect(result.warnings.length === 4, '4 cảnh báo trả về');
  expect(
    result.warnings.some(
      (w) => w.row === 6 && w.message.includes('không phải là số'),
    ),
    'dòng 6: "12 tháng" bị báo lỗi',
  );
  expect(
    result.warnings.some(
      (w) => w.row === 10 && w.message.includes('không phải số nguyên'),
    ),
    'dòng 10: 3.5 bị báo lỗi (không phải số nguyên)',
  );
  expect(
    result.warnings.some((w) => w.row === 7 && w.message.includes('Không tìm thấy')),
    'dòng 7: mã NOT-EXIST không tìm thấy',
  );
  expect(
    result.warnings.some((w) => w.message.includes('3 lần trong file')),
    'mã KV-2366 trùng 3 lần được cảnh báo',
  );
  expect(updates.length === 2, '2 lần UPDATE DB (gom theo nhóm số tháng)');
  expect(
    updates.some((u) => u.months === 24 && u.ids.length === 1 && u.ids[0] === 1),
    'KV-2366 được cập nhật 24 tháng (last wins, gộp theo nhóm tháng)',
  );
  expect(
    updates.some((u) => u.months === 12 && u.ids.length === 1 && u.ids[0] === 2),
    'ĐÔI-MỚI được cập nhật 12 tháng (chuẩn hoá Đ→D, thường/hoa, khoảng trắng)',
  );

  // ---- Case 2: thiếu cột → lỗi rõ ràng ----
  const wb2 = new ExcelJS.Workbook();
  wb2.addWorksheet('Sai').addRow(['Ma hang', 'Thang bao hanh']);
  try {
    await service.importFromExcel({
      buffer: Buffer.from(await wb2.xlsx.writeBuffer()),
    } as Express.Multer.File);
    expect(false, 'thiếu cột phải throw BadRequestException');
  } catch (error: any) {
    expect(
      error?.status === 400 && error?.response?.message?.includes('MÃ HT'),
      'thiếu cột → BadRequestException với thông báo định dạng',
    );
  }

  // ---- Case 3: file mẫu có đủ 2 cột ----
  const template = await service.buildTemplate();
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(template as unknown as ExcelJS.Buffer);
  expect(
    !!wb3.getWorksheet('BAO HANH') && !!wb3.getWorksheet('HUONG DAN'),
    'file mẫu có sheet BAO HANH + HUONG DAN',
  );

  // ---- Case 4: danh sách chỉ định (allowlist) ----
  expect(
    (await service.isImporter(10)) === false,
    'user 10 chưa được chỉ định → isImporter false',
  );

  await service.addImporter(10, 999); // admin id=999 chỉ định user 10
  expect(
    (await service.isImporter(10)) === true,
    'sau khi chỉ định → isImporter true',
  );

  const dup = await service.addImporter(10, 999);
  expect(dup.alreadyAdded === true, 'chỉ định trùng → alreadyAdded, không lỗi');

  try {
    await service.addImporter(404, 999);
    expect(false, 'user không tồn tại phải throw 400');
  } catch (error: any) {
    expect(
      error?.status === 400,
      'chỉ định user không tồn tại → BadRequestException',
    );
  }

  const removed = await service.removeImporter(10);
  expect(removed.removed === true, 'gỡ chỉ định thành công');
  expect(
    (await service.isImporter(10)) === false,
    'sau khi gỡ → isImporter false',
  );
  expect(
    (await service.removeImporter(10)).removed === false,
    'gỡ lần nữa → removed:false (không lỗi)',
  );

  // ---- Case 5: guard nạp file — admin / được chỉ định / người lạ ----
  const guard = new WarrantyImporterGuard(service);
  // Guard chặn bằng cách throw ForbiddenException(403) → coi "false = bị chặn".
  const canActivateSafe = async (user: any): Promise<boolean> => {
    try {
      return await guard.canActivate({
        switchToHttp: () => ({ getRequest: () => ({ user }) }),
      } as any);
    } catch (error: any) {
      if (error?.status === 403) return false;
      throw error;
    }
  };

  expect(
    (await canActivateSafe({
      id: 1,
      roles: [{ name: 'admin' }],
    })) === true,
    'guard: admin pass (không cần trong danh sách)',
  );
  expect(
    (await canActivateSafe({
      id: 555,
      roles: [{ name: 'manager' }],
    })) === false,
    'guard: manager không được chỉ định → bị chặn 403',
  );

  await service.addImporter(555, 1);
  expect(
    (await canActivateSafe({
      id: 555,
      roles: [{ name: 'manager' }],
    })) === true,
    'guard: manager được chỉ định → pass',
  );

  expect(
    (await canActivateSafe(undefined)) === false,
    'guard: chưa đăng nhập → bị chặn 403',
  );

  // ---- Case 6: helper auto-fill bảo hành cho item báo giá ----
  expect(
    productWarrantyText({ warrantyMonths: 12 }) === '12 tháng',
    'helper quote: 12 tháng → "12 tháng"',
  );
  expect(
    productWarrantyText({ warrantyMonths: null }) === null,
    'helper quote: chưa nạp bảo hành → null (không có fallback nào khác)',
  );
  expect(productWarrantyText(undefined) === null, 'helper quote: item tay không gắn sản phẩm → null');

  // ---- Case 7: tự tra quyền cho FE ẩn/hiện nút nạp ----
  const adminPerm = await service.getMyImportPermission({
    id: 1,
    roles: [{ name: 'admin' }],
  });
  expect(
    adminPerm.isAdmin === true && adminPerm.allowed === true,
    'me: admin → allowed:true',
  );

  const designatedPerm = await service.getMyImportPermission({
    id: 555,
    roles: [{ name: 'manager' }],
  });
  expect(
    designatedPerm.isAdmin === false &&
      designatedPerm.designated === true &&
      designatedPerm.allowed === true,
    'me: manager được chỉ định → allowed:true',
  );

  const strangerPerm = await service.getMyImportPermission({
    id: 777,
    roles: [{ name: 'sale' }],
  });
  expect(
    strangerPerm.isAdmin === false &&
      strangerPerm.designated === false &&
      strangerPerm.allowed === false,
    'me: sale thường → allowed:false',
  );

  if (process.exitCode !== 1) {
    console.log('\n🎉 TẤT CẢ TEST ĐẠT');
  }
}

main().catch((error) => {
  console.error('Test crashed:', error);
  process.exit(1);
});
