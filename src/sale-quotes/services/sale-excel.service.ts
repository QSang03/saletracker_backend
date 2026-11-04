import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { SalePricingService } from './sale-pricing.service';
import { formatWarranty, stripStatusPrefix } from '../utils/text.util';

type ExportType = 'internal' | 'customer';

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

@Injectable()
export class SaleExcelService {
  constructor(private readonly pricingService: SalePricingService) {}

  async buildQuoteWorkbook(quote: any, type: ExportType = 'internal', settings?: any) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BaoGia');
    const items = (quote.items || []) as any[];
    const isCustomer = type === 'customer';

    const headers = isCustomer
      ? [
          'STT',
          'MÃ HỆ THỐNG',
          'DIỄN GIẢI',
          'THBH / WARRANTY',
          'ĐƠN GIÁ (VNĐ)',
          'SL',
          'THÀNH TIỀN (VNĐ)',
        ]
      : [
          'STT',
          'MÃ HỆ THỐNG',
          'DIỄN GIẢI',
          'THBH / WARRANTY',
          'GIÁ VỐN',
          'ĐƠN GIÁ',
          'SL',
          'THÀNH TIỀN',
          'TÌNH TRẠNG',
        ];

    let rowIndex = 1;
    if (isCustomer) {
      const disclaimer1 =
        settings?.excelDisclaimer1?.trim() ||
        'BÁO GIÁ CHỈ MANG TÍNH CHẤT THAM KHẢO, QUÝ KHÁCH VUI LÒNG LIÊN HỆ KINH DOANH ĐỂ CÓ ĐƯỢC GIÁ TỐT NHẤT.';
      const disclaimer2 =
        settings?.excelDisclaimer2?.trim() ||
        'HIỆU LỰC BÁO GIÁ CÓ THỜI HẠN TỪ 1-3 NGÀY DO BIẾN ĐỘNG TĂNG GIÁ TỪ HÃNG. MONG QUÝ KHÁCH LƯU Ý.';
      sheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
      sheet.getCell(`A${rowIndex}`).value = disclaimer1;
      sheet.getCell(`A${rowIndex}`).font = {
        italic: true,
        color: { argb: 'FFB91C1C' },
      };
      rowIndex += 1;
      sheet.mergeCells(`A${rowIndex}:G${rowIndex}`);
      sheet.getCell(`A${rowIndex}`).value = disclaimer2;
      sheet.getCell(`A${rowIndex}`).font = {
        italic: true,
        color: { argb: 'FFB91C1C' },
      };
      rowIndex += 2;
    }

    const title = quote.title
      ? `BẢNG BÁO GIÁ: ${String(quote.title).toUpperCase()}`
      : 'BẢNG BÁO GIÁ';
    const lastColumn = String.fromCharCode(64 + headers.length);
    sheet.mergeCells(`A${rowIndex}:${lastColumn}${rowIndex}`);
    const titleCell = sheet.getCell(`A${rowIndex}`);
    titleCell.value = title;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0284C7' },
    };
    rowIndex += 1;

    const meta = [
      `Mã báo giá: ${quote.quoteCode || ''}`,
      `Khách hàng: ${quote.customerName || ''}`,
      `Điện thoại: ${quote.customerPhone || ''}`,
      `Ngày: ${new Date().toLocaleDateString('vi-VN')}`,
    ].join('   |   ');
    sheet.mergeCells(`A${rowIndex}:${lastColumn}${rowIndex}`);
    sheet.getCell(`A${rowIndex}`).value = meta;
    sheet.getCell(`A${rowIndex}`).font = {
      size: 10,
      color: { argb: 'FF475569' },
    };
    rowIndex += 2;

    const headerRow = sheet.getRow(rowIndex);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF2563EB' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = THIN_BORDER;
    });
    rowIndex += 1;

    let total = 0;
    items.forEach((item, index) => {
      const quantity = Number(item.quantity || 1);
      const basePrice =
        item.unitPrice !== null && item.unitPrice !== undefined
          ? Number(item.unitPrice)
          : null;
      const price = basePrice;
      const lineTotal = price !== null ? price * quantity : null;
      if (lineTotal !== null) {
        total += lineTotal;
      }

      const row = sheet.getRow(rowIndex);
      row.values = isCustomer
        ? [
            index + 1,
            item.productCode || '',
            item.name || '',
            formatWarranty(item.warranty),
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
          ]
        : [
            index + 1,
            item.productCode || '',
            item.name || '',
            formatWarranty(item.warranty),
            item.costPrice ?? '',
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
            stripStatusPrefix(item.statusText),
          ];
      row.height = 26;
      row.eachCell((cell, colNumber) => {
        cell.border = THIN_BORDER;
        cell.alignment = {
          vertical: 'middle',
          wrapText: true,
          horizontal: colNumber === 1 ? 'center' : undefined,
        };
        if (
          typeof cell.value === 'number' &&
          ((!isCustomer && [5, 6, 8].includes(colNumber)) ||
            (isCustomer && [5, 7].includes(colNumber)))
        ) {
          cell.numFmt = '#,##0';
        }
      });
      rowIndex += 1;
    });

    const totalRow = sheet.getRow(rowIndex);
    totalRow.values = isCustomer
      ? ['', '', '', '', '', 'TỔNG CỘNG:', total]
      : ['', '', '', '', '', '', '', 'TỔNG CỘNG:', total, ''];
    totalRow.font = { bold: true, size: 12 };
    totalRow.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      if (colNumber === (isCustomer ? 6 : 8)) {
        cell.alignment = { horizontal: 'right' };
      }
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
        cell.font = { bold: true, color: { argb: 'FFDC2626' } };
      }
    });
    rowIndex += 2;

    const note = (quote.globalNote || '').trim();
    if (note) {
      sheet.getCell(`A${rowIndex}`).value = 'GHI CHÚ CHUNG:';
      sheet.getCell(`A${rowIndex}`).font = {
        bold: true,
        color: { argb: 'FFB45309' },
      };
      rowIndex += 1;
      sheet.mergeCells(`A${rowIndex}:${lastColumn}${rowIndex}`);
      const noteCell = sheet.getCell(`A${rowIndex}`);
      noteCell.value = note;
      noteCell.alignment = { wrapText: true, vertical: 'top' };
      noteCell.font = { italic: true, color: { argb: 'FF475569' } };
      sheet.getRow(rowIndex).height = 60;
    }

    this.setWidths(sheet, headers.length, isCustomer, 'quote');
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async buildBuildWorkbook(build: any, type: ExportType = 'internal') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('CauHinh');
    const items = (build.items || []) as any[];
    const isCustomer = type === 'customer';
    const headers = isCustomer
      ? ['STT', 'MÃ HỆ THỐNG', 'LINH KIỆN', 'BH', 'ĐƠN GIÁ', 'SL', 'THÀNH TIỀN']
      : [
          'STT',
          'MÃ HỆ THỐNG',
          'LINH KIỆN',
          'BH',
          'GIÁ VỐN',
          'ĐƠN GIÁ',
          'SL',
          'THÀNH TIỀN',
          'TÌNH TRẠNG',
        ];

    let rowIndex = 1;
    sheet.mergeCells(
      `A${rowIndex}:${String.fromCharCode(64 + headers.length)}${rowIndex}`,
    );
    const titleCell = sheet.getCell(`A${rowIndex}`);
    titleCell.value = `CẤU HÌNH MÁY RÁP: ${String(build.name || '').toUpperCase()}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' },
    };
    rowIndex += 2;

    const headerRow = sheet.getRow(rowIndex);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF0D9488' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = THIN_BORDER;
    });
    rowIndex += 1;

    let total = 0;
    items.forEach((item, index) => {
      const quantity = Number(item.quantity || 1);
      const basePrice =
        item.salePrice !== null && item.salePrice !== undefined
          ? Number(item.salePrice)
          : null;
      const price = basePrice;
      const lineTotal = price !== null ? price * quantity : null;
      if (lineTotal !== null) {
        total += lineTotal;
      }

      const row = sheet.getRow(rowIndex);
      row.values = isCustomer
        ? [
            index + 1,
            item.productCode || '',
            item.name || '',
            formatWarranty(item.warranty),
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
          ]
        : [
            index + 1,
            item.productCode || '',
            item.name || '',
            formatWarranty(item.warranty),
            item.costPrice ?? '',
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
            stripStatusPrefix(item.statusText),
          ];
      row.height = 26;
      row.eachCell((cell, colNumber) => {
        cell.border = THIN_BORDER;
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (
          typeof cell.value === 'number' &&
          ((!isCustomer && [5, 6, 8].includes(colNumber)) ||
            (isCustomer && [5, 7].includes(colNumber)))
        ) {
          cell.numFmt = '#,##0';
        }
      });
      rowIndex += 1;
    });

    const totalRow = sheet.getRow(rowIndex);
    totalRow.values = isCustomer
      ? ['', '', '', '', '', 'TỔNG CỘNG:', total]
      : ['', '', '', '', '', '', '', 'TỔNG CỘNG:', total, ''];
    totalRow.font = { bold: true, size: 12 };
    totalRow.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      if (colNumber === 5) cell.alignment = { horizontal: 'right' };
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
        cell.font = { bold: true, color: { argb: 'FFDC2626' } };
      }
    });
    rowIndex += 2;

    const specs = (build.specs || []) as Array<{
      label?: string;
      value?: string;
    }>;
    if (specs.length > 0) {
      sheet.getCell(`A${rowIndex}`).value = 'THÔNG SỐ KỸ THUẬT';
      sheet.getCell(`A${rowIndex}`).font = {
        bold: true,
        size: 12,
        color: { argb: 'FF0F766E' },
      };
      rowIndex += 1;
      for (const spec of specs) {
        const label = (spec.label || '').trim();
        const value = (spec.value || '').trim();
        if (!label && !value) continue;
        const row = sheet.getRow(rowIndex);
        row.values = [label, value];
        row.getCell(1).font = { bold: true };
        row.getCell(1).alignment = { vertical: 'middle' };
        row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
        rowIndex += 1;
      }
    }

    this.setWidths(sheet, headers.length, isCustomer, 'build');
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async buildQuickCaseWorkbook(quickCase: any, type: ExportType = 'internal') {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BaoGiaNhanh');
    const items = (quickCase.items || []) as any[];
    const isCustomer = type === 'customer';
    const headers = isCustomer
      ? ['STT', 'YÊU CẦU', 'DIỄN GIẢI / SẢN PHẨM', 'BH', 'ĐƠN GIÁ', 'SL', 'THÀNH TIỀN']
      : [
          'STT',
          'YÊU CẦU',
          'DIỄN GIẢI / SẢN PHẨM',
          'BH',
          'GIÁ VỐN',
          'ĐƠN GIÁ',
          'SL',
          'THÀNH TIỀN',
          'TÌNH TRẠNG',
        ];

    let rowIndex = 1;
    sheet.mergeCells(
      `A${rowIndex}:${String.fromCharCode(64 + headers.length)}${rowIndex}`,
    );
    const titleCell = sheet.getCell(`A${rowIndex}`);
    titleCell.value = quickCase.title
      ? `BẢNG BÁO GIÁ: ${String(quickCase.title).toUpperCase()}`
      : 'BẢNG BÁO GIÁ DỊCH VỤ / SẢN PHẨM';
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    titleCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF7C3AED' },
    };
    rowIndex += 2;

    const headerRow = sheet.getRow(rowIndex);
    headerRow.values = headers;
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF8B5CF6' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
      cell.border = THIN_BORDER;
    });
    rowIndex += 1;

    let total = 0;
    items.forEach((item, index) => {
      const quantity = Number(item.quantity || 1);
      const basePrice =
        item.salePrice !== null && item.salePrice !== undefined
          ? Number(item.salePrice)
          : null;
      const price = basePrice;
      const lineTotal = price !== null ? price * quantity : null;
      if (lineTotal !== null) {
        total += lineTotal;
      }
      const isReplacementOrEquiv = item.matchType === 'replacement' || item.matchType === 'equivalent';
      const typeTag = item.matchType === 'replacement' ? '(Thay thế)' : item.matchType === 'equivalent' ? '(Tương đương)' : '';
      let baseDesc = (item.description || item.requestText || '').trim();
      if (typeTag && !baseDesc.includes(typeTag)) {
        baseDesc = `${typeTag} ${baseDesc}`;
      }
      const description = baseDesc;

      const row = sheet.getRow(rowIndex);
      row.values = isCustomer
        ? [
            index + 1,
            item.requestText || '',
            description,
            formatWarranty(item.warranty),
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
          ]
        : [
            index + 1,
            item.requestText || '',
            description,
            formatWarranty(item.warranty),
            item.costPrice ?? '',
            price ?? 'CALL',
            quantity,
            lineTotal ?? 'CALL',
            stripStatusPrefix(item.statusText),
          ];
      row.height = 28;
      row.eachCell((cell, colNumber) => {
        cell.border = THIN_BORDER;
        cell.alignment = { vertical: 'middle', wrapText: true };
        if (
          typeof cell.value === 'number' &&
          ((!isCustomer && [5, 6, 8].includes(colNumber)) ||
            (isCustomer && [5, 7].includes(colNumber)))
        ) {
          cell.numFmt = '#,##0';
        }
      });
      if (isReplacementOrEquiv) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFE4E6' },
          };
          cell.font = {
            color: { argb: 'FFDC2626' },
            bold: true,
          };
        });
      }
      rowIndex += 1;
    });

    const totalRow = sheet.getRow(rowIndex);
    totalRow.values = isCustomer
      ? ['', '', '', '', '', 'TỔNG CỘNG:', total]
      : ['', '', '', '', '', '', 'TỔNG CỘNG:', total, ''];
    totalRow.font = { bold: true, size: 12 };
    totalRow.eachCell((cell, colNumber) => {
      cell.border = THIN_BORDER;
      if (colNumber === (isCustomer ? 6 : 6)) {
        cell.alignment = { horizontal: 'right' };
      }
      if (typeof cell.value === 'number') {
        cell.numFmt = '#,##0';
        cell.font = { bold: true, color: { argb: 'FFDC2626' } };
      }
    });
    rowIndex += 2;

    const note = (quickCase.globalNote || '').trim();
    if (note) {
      sheet.getCell(`A${rowIndex}`).value = 'GHI CHÚ CHUNG:';
      sheet.getCell(`A${rowIndex}`).font = {
        bold: true,
        color: { argb: 'FFB45309' },
      };
      rowIndex += 1;
      sheet.mergeCells(
        `A${rowIndex}:${String.fromCharCode(64 + headers.length)}${rowIndex}`,
      );
      const noteCell = sheet.getCell(`A${rowIndex}`);
      noteCell.value = note;
      noteCell.alignment = { wrapText: true, vertical: 'top' };
      noteCell.font = { italic: true, color: { argb: 'FF475569' } };
      sheet.getRow(rowIndex).height = 60;
    }

    this.setWidths(sheet, headers.length, isCustomer, 'quickCase');
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  private setWidths(
    sheet: ExcelJS.Worksheet,
    columnCount: number,
    isCustomer: boolean,
    templateType: 'quote' | 'build' | 'quickCase' = 'quote',
  ) {
    let widths: number[];
    if (templateType === 'quickCase') {
      widths = isCustomer
        ? [6, 35, 45, 14, 16, 8, 18]
        : [6, 35, 45, 14, 16, 16, 8, 18, 26];
    } else {
      // quote or build (7 cols customer, 9 cols internal)
      widths = isCustomer
        ? [6, 22, 48, 16, 16, 8, 18]
        : [6, 22, 48, 16, 16, 16, 8, 18, 26];
    }
    for (let index = 1; index <= columnCount; index += 1) {
      sheet.getColumn(index).width = widths[index - 1] ?? 16;
    }
  }
}
