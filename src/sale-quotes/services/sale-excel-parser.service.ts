import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  SaleExcelTemplate,
  SheetGroupMapping,
} from '../entities/sale-excel-template.entity';

export interface InspectedSheetColumn {
  name: string;
  colIndex: number;
  sampleVal: string;
}

export interface InspectedColumnCompat {
  name: string;
  index: number;
  sampleValue: string;
}

export interface InspectedSheetGroup {
  id: string;
  groupId: string;
  name: string;
  groupName: string;
  sheets: string[];
  appliedSheets: string[];
  headerRow: number;
  columns: InspectedColumnCompat[];
  excelColumns: string[];
  columnsDetail: InspectedSheetColumn[];
  sampleRows: Record<string, string>[];
}

export interface InspectTemplateResult {
  totalSheets: number;
  allSheets: string[];
  isAllSame: boolean;
  sheetGroups: InspectedSheetGroup[];
}

export interface TemplateValidationErrorItem {
  sheetName: string;
  groupName?: string;
  missingRequiredColumns: Array<{ field: string; expectedColumn: string }>;
  foundColumns: string[];
}

export interface ParsedItemRow {
  rowIndex: number;
  productCode: string;
  productName: string;
  modelName?: string | null;
  warranty?: string | null;
  price: number;
  rawStatus?: string | null;
}

export interface ParsedSheet {
  sheetName: string;
  sheetIndex: number;
  items: ParsedItemRow[];
}

export interface ParsedWorkbookResult {
  totalSheets: number;
  totalItems: number;
  sheets: ParsedSheet[];
}

@Injectable()
export class SaleExcelParserService {
  private readonly logger = new Logger(SaleExcelParserService.name);

  /**
   * Parse file Excel buffer theo templateType (1..4)
   */
  async parseBuffer(
    buffer: Buffer,
    templateType: number,
  ): Promise<ParsedWorkbookResult> {
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore
    await workbook.xlsx.load(buffer);

    const sheets: ParsedSheet[] = [];
    let totalItems = 0;

    workbook.worksheets.forEach((ws, sheetIdx) => {
      // Bỏ qua các sheet ẩn nếu có
      if (ws.state === 'hidden' || ws.state === 'veryHidden') {
        return;
      }

      let parsedItems: ParsedItemRow[] = [];
      switch (Number(templateType)) {
        case 1:
          parsedItems = this.parseTemplate1(ws);
          break;
        case 2:
          parsedItems = this.parseTemplate2(ws);
          break;
        case 3:
          parsedItems = this.parseTemplate3(ws);
          break;
        case 4:
          parsedItems = this.parseTemplate4(ws);
          break;
        default:
          parsedItems = this.parseGeneric(ws);
          break;
      }

      if (parsedItems.length > 0) {
        totalItems += parsedItems.length;
        sheets.push({
          sheetName: ws.name.trim(),
          sheetIndex: sheetIdx,
          items: parsedItems,
        });
      }
    });

    return {
      totalSheets: sheets.length,
      totalItems,
      sheets,
    };
  }

  // =========================================================================
  // HELPER LẤY GIÁ TRỊ Ô
  // =========================================================================
  private getCellValue(cell: ExcelJS.Cell | undefined): string {
    if (!cell || cell.value === null || cell.value === undefined) return '';
    let val: any = cell.value;
    if (typeof val === 'object') {
      if (Array.isArray(val.richText)) {
        val = val.richText.map((t: any) => t.text).join('');
      } else if (val.result !== undefined) {
        val = val.result;
      } else if (val.text !== undefined) {
        val = val.text;
      }
    }
    const str = String(val ?? '').trim();
    return str.replace(/\s+/g, ' ');
  }

  private parsePrice(raw: string): number {
    if (!raw) return 0;
    // Bỏ ký tự phân cách nghìn, đơn vị tiền tệ
    const clean = raw.replace(/[,\.₫đVND\s]/gi, '').trim();
    const num = parseInt(clean, 10);
    return isNaN(num) || num < 0 ? 0 : num;
  }

  private normalizeWarranty(raw: string): string {
    if (!raw) return '';
    let clean = raw.trim();
    // Bỏ dấu ; nếu có
    clean = clean.replace(/^;+|;+$/g, '').trim();
    if (/^(\d+)\s*(year|yr)s?$/i.test(clean)) {
      clean = clean.replace(/^(\d+)\s*(year|yr)s?$/i, '$1 năm');
    } else if (/^(\d+)-year$/i.test(clean)) {
      clean = clean.replace(/^(\d+)-year$/i, '$1 năm');
    }
    return clean;
  }

  // =========================================================================
  // MẪU 1: ASUS NUC & LCD
  // =========================================================================
  private parseTemplate1(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};

    // Tìm header trong 5 dòng đầu
    for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const rowCols: Record<string, number> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const text = this.getCellValue(cell).toUpperCase();
        if (text.includes('PRODUCT CODE HT') || text.includes('MÃ HÀNG')) rowCols['code_ht'] = colNumber;
        if (text.includes('MODEL NAME') || text.includes('MODEL')) rowCols['model'] = colNumber;
        if (text.includes('PRODUCT CODE 1') || text.includes('ASUS P/N') || text.includes('PART NUMBER')) rowCols['pn'] = colNumber;
        if (text === 'PRODUCT CODE' || text.includes('TÊN HÀNG') || text.includes('DIỄN GIẢI') || text.includes('THÔNG SỐ')) rowCols['name'] = colNumber;
        if (text.includes('WARRANTY') || text.includes('TGBH') || text.includes('BẢO HÀNH')) rowCols['warranty'] = colNumber;
        if (text.includes('UNIT PRICE') || text.includes('ĐƠN GIÁ') || text.includes('GIÁ') || text.includes('EU PRICE')) rowCols['price'] = colNumber;
        if (text.includes('PRODUCT STATUS') || text.includes('TÌNH TRẠNG')) rowCols['status'] = colNumber;
        if (text.includes('FUND')) rowCols['fund'] = colNumber;
        if (text.includes('NPP')) rowCols['npp'] = colNumber;
      });

      if (rowCols['code_ht'] || (rowCols['model'] && rowCols['price']) || (rowCols['name'] && rowCols['price'])) {
        headerRowIdx = r;
        colMap = rowCols;
        break;
      }
    }

    if (headerRowIdx === -1) {
      // Fallback: nếu không tìm thấy header rõ ràng, thử dòng 2
      headerRowIdx = 2;
    }

    // Đọc các dòng dữ liệu
    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const codeHt = colMap['code_ht'] ? this.getCellValue(row.getCell(colMap['code_ht'])) : '';
      const model = colMap['model'] ? this.getCellValue(row.getCell(colMap['model'])) : '';
      const pn = colMap['pn'] ? this.getCellValue(row.getCell(colMap['pn'])) : '';
      const name = colMap['name'] ? this.getCellValue(row.getCell(colMap['name'])) : '';
      const warranty = colMap['warranty'] ? this.getCellValue(row.getCell(colMap['warranty'])) : '';
      const priceRaw = colMap['price'] ? this.getCellValue(row.getCell(colMap['price'])) : '';
      const status = colMap['status'] ? this.getCellValue(row.getCell(colMap['status'])) : '';
      const fund = colMap['fund'] ? this.getCellValue(row.getCell(colMap['fund'])) : '';
      const npp = colMap['npp'] ? this.getCellValue(row.getCell(colMap['npp'])) : '';

      const productCode = codeHt || pn || model;
      const productName = name || model || productCode;

      // Bỏ qua dòng trống hoặc tiêu đề phân cách
      if (!productCode && !productName) continue;
      if (productName.toUpperCase().includes('TẤT CẢ NUC') || productName.toUpperCase().includes('GÓI TIẾT KIỆM')) {
        if (!codeHt && !pn) continue;
      }

      const notes: string[] = [];
      if (status) notes.push(status);
      if (fund) notes.push(`Fund: ${fund}`);
      if (npp && npp !== 'AVAIL') notes.push(`NPP: ${npp}`);

      items.push({
        rowIndex: r,
        productCode: productCode.trim(),
        productName: productName.trim(),
        modelName: model ? model.trim() : null,
        warranty: this.normalizeWarranty(warranty),
        price: this.parsePrice(priceRaw),
        rawStatus: notes.join(' | ') || (status || null),
      });
    }

    return items;
  }

  // =========================================================================
  // MẪU 2: BẢNG GIÁ QUY ĐỊNH ASUS
  // =========================================================================
  private parseTemplate2(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};

    for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const rowCols: Record<string, number> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const text = this.getCellValue(cell).toUpperCase();
        if (text.includes('MODEL NAME') || text.includes('MODEL')) rowCols['code'] = colNumber;
        if (text.includes('CHI TIẾT') || text.includes('MÔ TẢ') || text.includes('DIỄN GIẢI')) rowCols['name'] = colNumber;
        if (text.includes('TGBH') || text.includes('BẢO HÀNH')) rowCols['warranty'] = colNumber;
        if (text.includes('GIÁ BÁN') || text.includes('GIÁ') || text.includes('VAT')) rowCols['price'] = colNumber;
        if (text.includes('THÔNG TIN HÀNG') || text.includes('TÌNH TRẠNG')) rowCols['status'] = colNumber;
        if (text.includes('FUNDING') || text.includes('GIẢM')) rowCols['fund'] = colNumber;
      });

      if (rowCols['code'] && (rowCols['name'] || rowCols['price'])) {
        headerRowIdx = r;
        colMap = rowCols;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 3;

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const code = colMap['code'] ? this.getCellValue(row.getCell(colMap['code'])) : '';
      let name = colMap['name'] ? this.getCellValue(row.getCell(colMap['name'])) : '';
      const warranty = colMap['warranty'] ? this.getCellValue(row.getCell(colMap['warranty'])) : '';
      const priceRaw = colMap['price'] ? this.getCellValue(row.getCell(colMap['price'])) : '';
      const status = colMap['status'] ? this.getCellValue(row.getCell(colMap['status'])) : '';
      const fund = colMap['fund'] ? this.getCellValue(row.getCell(colMap['fund'])) : '';

      // Làm sạch ký tự ; ở đầu/cuối của name
      name = name.replace(/^;+|;+$/g, '').trim();

      // Dòng phân nhóm (ví dụ: code="Model Name" hoặc rỗng, name="Core I3" hoặc rỗng)
      if (!code || code.toUpperCase() === 'MODEL NAME') continue;
      if (!priceRaw && (!name || name.startsWith('Core I'))) continue;

      const notes: string[] = [];
      if (status) notes.push(status);
      if (fund) notes.push(`Fund: ${fund}`);

      items.push({
        rowIndex: r,
        productCode: code.trim(),
        productName: (name || code).trim(),
        modelName: code.trim(),
        warranty: this.normalizeWarranty(warranty),
        price: this.parsePrice(priceRaw),
        rawStatus: notes.join(' | ') || (status || null),
      });
    }

    return items;
  }

  // =========================================================================
  // MẪU 3: BÁO GIÁ NỘI BỘ PC MSI
  // =========================================================================
  private parseTemplate3(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    let headerRowIdx = 1;
    let colMap: Record<string, number> = {};

    const headerRow = ws.getRow(headerRowIdx);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const text = this.getCellValue(cell).toUpperCase();
      if (text.includes('MÃ KHO S1') || text.includes('KHO S1')) colMap['code_s1'] = colNumber;
      if (text.includes('PRODUCT CODE')) colMap['code_product'] = colNumber;
      if (text.includes('MODEL NAME')) colMap['model'] = colNumber;
      if (text.includes('CẤU HÌNH') || text.includes('DIỄN GIẢI') || text.includes('MÔ TẢ')) colMap['name'] = colNumber;
      if (text.includes('BẢO HÀNH')) colMap['warranty'] = colNumber;
      if (text === 'GIÁ' || text.includes('ĐƠN GIÁ') || text.includes('GIÁ BÁN')) colMap['price'] = colNumber;
      if (text.includes('NOTED') || text.includes('GHI CHÚ') || text.includes('TÌNH TRẠNG')) colMap['status'] = colNumber;
      if (text.includes('FUND')) colMap['fund'] = colNumber;
    });

    // Fallback default MSI template columns if not auto detected
    if (!colMap['code_s1']) colMap['code_s1'] = 4;
    if (!colMap['name']) colMap['name'] = 6;
    if (!colMap['warranty']) colMap['warranty'] = 7;
    if (!colMap['price']) colMap['price'] = 8;
    if (!colMap['status']) colMap['status'] = 9;
    if (!colMap['fund']) colMap['fund'] = 10;
    if (!colMap['model']) colMap['model'] = 2;

    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const codeS1 = colMap['code_s1'] ? this.getCellValue(row.getCell(colMap['code_s1'])) : '';
      const codeProduct = colMap['code_product'] ? this.getCellValue(row.getCell(colMap['code_product'])) : '';
      const model = colMap['model'] ? this.getCellValue(row.getCell(colMap['model'])) : '';
      let name = colMap['name'] ? this.getCellValue(row.getCell(colMap['name'])) : '';
      const warranty = colMap['warranty'] ? this.getCellValue(row.getCell(colMap['warranty'])) : '';
      const priceRaw = colMap['price'] ? this.getCellValue(row.getCell(colMap['price'])) : '';
      const status = colMap['status'] ? this.getCellValue(row.getCell(colMap['status'])) : '';
      const fund = colMap['fund'] ? this.getCellValue(row.getCell(colMap['fund'])) : '';

      name = name.replace(/^;+|;+$/g, '').trim();

      // Bỏ qua dòng section title gộp ô (như PC MSI, PC Mini Cubi MSI lặp lại ở mọi cột)
      if (codeS1 === model && codeS1 === name && !priceRaw) continue;
      if (!codeS1 && !name && !priceRaw) continue;

      const productCode = codeS1 || codeProduct || model;
      if (!productCode && !name) continue;

      const notes: string[] = [];
      if (status) notes.push(status);
      if (fund) notes.push(`Fund: ${fund}`);

      items.push({
        rowIndex: r,
        productCode: productCode.trim(),
        productName: (name || model || productCode).trim(),
        modelName: model ? model.trim() : null,
        warranty: this.normalizeWarranty(warranty),
        price: this.parsePrice(priceRaw),
        rawStatus: notes.join(' | ') || (status || null),
      });
    }

    return items;
  }

  // =========================================================================
  // MẪU 4: SILICON - NIKATEI - FUJIE
  // =========================================================================
  private parseTemplate4(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const sheetNameLower = ws.name.toLowerCase();
    const isDealerSheet = sheetNameLower.includes('dealer') || sheetNameLower.includes('giá');

    if (isDealerSheet) {
      return this.parseSiliconDealerSheet(ws);
    } else {
      return this.parseSiliconDetailSheet(ws);
    }
  }

  private parseSiliconDealerSheet(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    let headerRowIdx = 2;
    let colMap: Record<string, number> = {};

    for (let r = 1; r <= Math.min(4, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const rowCols: Record<string, number> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const text = this.getCellValue(cell).toUpperCase();
        if (text.includes('MÃ KHO') || text.includes('MÃ NK')) rowCols['code_nk'] = colNumber;
        if (text.includes('MODEL')) rowCols['model'] = colNumber;
        if (text.includes('SẢN PHẨM')) rowCols['product'] = colNumber;
        if (text.includes('HÃNG')) rowCols['brand'] = colNumber;
        if (text.includes('DEALER') || text.includes('GIÁ NK') || text.includes('GIÁ BÁN')) rowCols['price'] = colNumber;
        if (text.includes('TGBH') || text.includes('BẢO HÀNH')) rowCols['warranty'] = colNumber;
        if (text.includes('BÁN LẺ')) rowCols['retail_price'] = colNumber;
      });

      if (rowCols['model'] || rowCols['code_nk']) {
        headerRowIdx = r;
        colMap = rowCols;
        break;
      }
    }

    // Default fallback columns for Gia Dealer sheet
    if (!colMap['code_nk']) colMap['code_nk'] = 8;
    if (!colMap['model']) colMap['model'] = 4;
    if (!colMap['product']) colMap['product'] = 2;
    if (!colMap['brand']) colMap['brand'] = 3;
    if (!colMap['price']) colMap['price'] = 5;
    if (!colMap['warranty']) colMap['warranty'] = 6;
    if (!colMap['retail_price']) colMap['retail_price'] = 7;

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const codeNk = colMap['code_nk'] ? this.getCellValue(row.getCell(colMap['code_nk'])) : '';
      const model = colMap['model'] ? this.getCellValue(row.getCell(colMap['model'])) : '';
      const product = colMap['product'] ? this.getCellValue(row.getCell(colMap['product'])) : '';
      const brand = colMap['brand'] ? this.getCellValue(row.getCell(colMap['brand'])) : '';
      const priceRaw = colMap['price'] ? this.getCellValue(row.getCell(colMap['price'])) : '';
      const retailPriceRaw = colMap['retail_price'] ? this.getCellValue(row.getCell(colMap['retail_price'])) : '';
      const warranty = colMap['warranty'] ? this.getCellValue(row.getCell(colMap['warranty'])) : '';

      if (!model && !codeNk) continue;

      const productCode = codeNk || model;
      const productNameParts = [product, brand, model].filter(Boolean);
      const productName = productNameParts.join(' ');

      const notes: string[] = [];
      if (retailPriceRaw) notes.push(`Giá niêm yết: ${retailPriceRaw}`);

      items.push({
        rowIndex: r,
        productCode: productCode.trim(),
        productName: productName.trim(),
        modelName: model ? model.trim() : null,
        warranty: this.normalizeWarranty(warranty),
        price: this.parsePrice(priceRaw),
        rawStatus: notes.join(' | ') || null,
      });
    }

    return items;
  }

  private parseSiliconDetailSheet(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    let headerRowIdx = -1;
    let colMap: Record<string, number> = {};

    for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const rowCols: Record<string, number> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const text = this.getCellValue(cell).toUpperCase();
        if (text.includes('MODEL') || text.includes('MÃ')) rowCols['model'] = colNumber;
        if (text.includes('MÔ TẢ') || text.includes('DESCRIPTION') || text.includes('ĐẶC TÍNH')) rowCols['desc'] = colNumber;
        if (text.includes('WARRANTY') || text.includes('BẢO HÀNH')) rowCols['warranty'] = colNumber;
        if (text.includes('GIÁ') || text.includes('END USER') || text.includes('PRICE')) rowCols['price'] = colNumber;
      });

      if (rowCols['model'] && (rowCols['desc'] || rowCols['warranty'])) {
        headerRowIdx = r;
        colMap = rowCols;
        break;
      }
    }

    if (headerRowIdx === -1) headerRowIdx = 4;

    for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const model = colMap['model'] ? this.getCellValue(row.getCell(colMap['model'])) : '';
      let desc = colMap['desc'] ? this.getCellValue(row.getCell(colMap['desc'])) : '';
      const warranty = colMap['warranty'] ? this.getCellValue(row.getCell(colMap['warranty'])) : '';
      const priceRaw = colMap['price'] ? this.getCellValue(row.getCell(colMap['price'])) : '';

      if (!model && !desc) continue;
      // Bỏ qua dòng tiêu đề nhóm gộp
      if (model.includes('NHÓM SẢN PHẨM') || model.includes('MÁY HỦY') || model.includes('PHỤ KIỆN')) continue;

      items.push({
        rowIndex: r,
        productCode: model.trim(),
        productName: (desc || model).trim(),
        modelName: model.trim(),
        warranty: this.normalizeWarranty(warranty),
        price: this.parsePrice(priceRaw),
        rawStatus: null,
      });
    }

    return items;
  }

  // =========================================================================
  // PHÂN TÍCH FILE EXCEL ĐỂ TẠO MẪU MỚI (INSPECT TEMPLATE)
  // Tự động gom nhóm các Tab Sheet có cấu trúc cột giống nhau
  // =========================================================================
  async inspectTemplateBuffer(buffer: Buffer): Promise<InspectTemplateResult> {
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore
    await workbook.xlsx.load(buffer);

    const sheetSummaries: Array<{
      sheetName: string;
      headerRow: number;
      columns: string[];
      columnsDetail: InspectedSheetColumn[];
      sampleRows: Record<string, string>[];
      signature: string;
    }> = [];

    workbook.worksheets.forEach((ws) => {
      if (ws.state === 'hidden' || ws.state === 'veryHidden') return;

      // 1. Tìm dòng header tốt nhất trong 5 dòng đầu
      let bestHeaderRow = 1;
      let maxColsWithText = 0;
      for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
        const row = ws.getRow(r);
        let count = 0;
        row.eachCell({ includeEmpty: false }, (cell) => {
          const val = this.getCellValue(cell).trim();
          if (val.length > 0 && isNaN(Number(val))) count++;
        });
        if (count > maxColsWithText) {
          maxColsWithText = count;
          bestHeaderRow = r;
        }
      }

      // 2. Đọc các cột tại dòng header
      const headerRowObj = ws.getRow(bestHeaderRow);
      const colsDetail: InspectedSheetColumn[] = [];
      const colNames: string[] = [];

      // Tìm dòng dữ liệu sản phẩm thật đầu tiên bên dưới header để lấy sample value chuẩn
      // (Bỏ qua các dòng phân cách danh mục chỉ có 1 ô như "PC Mini Cubi MSI", "PC MSI", "AIO MSI"...)
      let firstDataRowIdx = bestHeaderRow + 1;
      for (let r = bestHeaderRow + 1; r <= Math.min(bestHeaderRow + 10, ws.rowCount); r++) {
        const testRow = ws.getRow(r);
        let filledCount = 0;
        testRow.eachCell({ includeEmpty: false }, (cell) => {
          if (this.getCellValue(cell).trim()) filledCount++;
        });
        if (filledCount >= 3) {
          firstDataRowIdx = r;
          break;
        }
      }

      headerRowObj.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const name = this.getCellValue(cell).trim();
        if (!name) return;

        // Lấy giá trị mẫu ở dòng dữ liệu sản phẩm thật
        let sampleVal = this.getCellValue(
          ws.getRow(firstDataRowIdx).getCell(colNumber),
        ).trim();

        // Fallback: Nếu ô ở dòng firstDataRowIdx rỗng, tìm ô đầu tiên có giá trị trong 10 dòng kế tiếp
        if (!sampleVal) {
          for (let r = bestHeaderRow + 1; r <= Math.min(bestHeaderRow + 12, ws.rowCount); r++) {
            const val = this.getCellValue(ws.getRow(r).getCell(colNumber)).trim();
            if (val) {
              sampleVal = val;
              break;
            }
          }
        }

        colsDetail.push({
          name,
          colIndex: colNumber,
          sampleVal: sampleVal || '—',
        });
        colNames.push(name);
      });

      // Đọc 1-2 dòng demo thực tế (chỉ lấy dòng sản phẩm thật có từ 3 ô dữ liệu trở lên)
      const sampleRows: Record<string, string>[] = [];
      for (let r = bestHeaderRow + 1; r <= Math.min(bestHeaderRow + 15, ws.rowCount); r++) {
        const rowObj = ws.getRow(r);
        let filledCount = 0;
        rowObj.eachCell({ includeEmpty: false }, (cell) => {
          if (this.getCellValue(cell).trim()) filledCount++;
        });

        // Bỏ qua dòng section phân chia danh mục
        if (filledCount < 3) continue;

        const rowData: Record<string, string> = {};
        colsDetail.forEach((c) => {
          rowData[c.name] = this.getCellValue(rowObj.getCell(c.colIndex)).trim();
        });
        if (Object.values(rowData).some((v) => v.length > 0)) {
          sampleRows.push(rowData);
          if (sampleRows.length >= 3) break;
        }
      }

      // Chữ ký đại diện để so sánh cấu trúc cột giữa các tab
      const signature = colNames
        .map((c) => c.toUpperCase().replace(/\s+/g, ''))
        .sort()
        .join('|');

      sheetSummaries.push({
        sheetName: ws.name.trim(),
        headerRow: bestHeaderRow,
        columns: colNames,
        columnsDetail: colsDetail,
        sampleRows,
        signature,
      });
    });

    if (sheetSummaries.length === 0) {
      return {
        totalSheets: 0,
        allSheets: [],
        isAllSame: true,
        sheetGroups: [],
      };
    }

    // 3. Tự động gom nhóm các tab có cùng cấu trúc cột
    const groupMap = new Map<string, InspectedSheetGroup>();
    let groupCounter = 1;

    sheetSummaries.forEach((s) => {
      if (!groupMap.has(s.signature)) {
        const gId = `group_${groupCounter++}`;
        const gName = `Nhóm ${groupCounter - 1}: Áp dụng cho [${s.sheetName}]`;
        const columnsCompat: InspectedColumnCompat[] = s.columnsDetail.map((c) => ({
          name: c.name,
          index: c.colIndex,
          sampleValue: c.sampleVal,
        }));

        groupMap.set(s.signature, {
          id: gId,
          groupId: gId,
          name: gName,
          groupName: gName,
          sheets: [s.sheetName],
          appliedSheets: [s.sheetName],
          headerRow: s.headerRow,
          columns: columnsCompat,
          excelColumns: s.columns,
          columnsDetail: s.columnsDetail,
          sampleRows: s.sampleRows,
        });
      } else {
        const existing = groupMap.get(s.signature)!;
        existing.sheets.push(s.sheetName);
        existing.appliedSheets.push(s.sheetName);
        const updatedName = `Nhóm ${existing.groupId.replace('group_', '')}: Áp dụng cho [${existing.appliedSheets.join(', ')}]`;
        existing.name = updatedName;
        existing.groupName = updatedName;
      }
    });

    const sheetGroups = Array.from(groupMap.values());
    const isAllSame = sheetGroups.length === 1;

    return {
      totalSheets: sheetSummaries.length,
      allSheets: sheetSummaries.map((s) => s.sheetName),
      isAllSame,
      sheetGroups,
    };
  }

  // =========================================================================
  // KIỂM TRA HỢP LỆ KHI NẠP FILE THEO MẪU (PRE-UPLOAD VALIDATION)
  // Nếu có Tab nào trong file nạp lên bị sai cấu trúc so với Mẫu thì báo lỗi chi tiết
  // =========================================================================
  async validateFileAgainstTemplate(
    buffer: Buffer,
    template: SaleExcelTemplate,
  ): Promise<{ isValid: boolean; errors: TemplateValidationErrorItem[] }> {
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore
    await workbook.xlsx.load(buffer);

    const errors: TemplateValidationErrorItem[] = [];

    workbook.worksheets.forEach((ws) => {
      if (ws.state === 'hidden' || ws.state === 'veryHidden') return;

      const sheetName = ws.name.trim();

      // Tìm nhóm mapping áp dụng cho sheet này
      const mapping =
        template.sheetGroups.find((g) => g.appliedSheets.includes(sheetName)) ||
        template.sheetGroups[0];

      if (!mapping || !mapping.columns) return;

      // Đọc toàn bộ các cột thực tế có trong sheet tại headerRow (hoặc quét 5 dòng đầu)
      const foundCols: string[] = [];
      const hRow = ws.getRow(mapping.headerRow || 1);
      hRow.eachCell({ includeEmpty: false }, (cell) => {
        const val = this.getCellValue(cell).trim();
        if (val) foundCols.push(val);
      });

      // Chuẩn hóa tên cột để so khớp không phân biệt hoa thường
      const normalize = (str: string) => str.trim().toUpperCase().replace(/\s+/g, ' ');
      const normalizedFound = foundCols.map(normalize);

      const missing: Array<{ field: string; expectedColumn: string }> = [];

      // Kiểm tra cột Mã sản phẩm (Bắt buộc)
      if (mapping.columns.productCode) {
        const exp = mapping.columns.productCode;
        if (!normalizedFound.includes(normalize(exp))) {
          missing.push({ field: 'Mã Sản Phẩm', expectedColumn: exp });
        }
      }

      // Kiểm tra cột Tên sản phẩm (Bắt buộc)
      if (mapping.columns.productName) {
        const exp = mapping.columns.productName;
        if (!normalizedFound.includes(normalize(exp))) {
          missing.push({ field: 'Tên Sản Phẩm', expectedColumn: exp });
        }
      }

      // Kiểm tra Đơn giá nếu có map
      if (mapping.columns.price) {
        const exp = mapping.columns.price;
        if (!normalizedFound.includes(normalize(exp))) {
          missing.push({ field: 'Đơn Giá', expectedColumn: exp });
        }
      }

      if (missing.length > 0) {
        errors.push({
          sheetName,
          groupName: mapping.groupName,
          missingRequiredColumns: missing,
          foundColumns: foundCols,
        });
      }
    });

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  // =========================================================================
  // PARSE FILE EXCEL BẰNG TEMPLATE ĐỘNG TỪ DATABASE
  // =========================================================================
  async parseBufferWithTemplate(
    buffer: Buffer,
    template: SaleExcelTemplate,
  ): Promise<ParsedWorkbookResult> {
    const workbook = new ExcelJS.Workbook();
    // @ts-ignore
    await workbook.xlsx.load(buffer);

    const sheets: ParsedSheet[] = [];
    let totalItems = 0;

    const normalize = (str: string) => str.trim().toUpperCase().replace(/\s+/g, ' ');

    workbook.worksheets.forEach((ws, sheetIdx) => {
      if (ws.state === 'hidden' || ws.state === 'veryHidden') return;

      const sheetName = ws.name.trim();

      // Tìm nhóm mapping tương ứng
      const mapping =
        template.sheetGroups.find((g) => g.appliedSheets.includes(sheetName)) ||
        template.sheetGroups[0];

      if (!mapping || !mapping.columns) return;

      // Xác định số thứ tự cột (colNumber) của từng trường trong worksheet
      const headerRow = ws.getRow(mapping.headerRow || 1);
      const colMap: Record<string, number> = {};

      headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const cellName = normalize(this.getCellValue(cell));
        if (mapping.columns.productCode && cellName === normalize(mapping.columns.productCode)) {
          colMap['productCode'] = colNumber;
        }
        if (mapping.columns.productName && cellName === normalize(mapping.columns.productName)) {
          colMap['productName'] = colNumber;
        }
        if (mapping.columns.modelName && cellName === normalize(mapping.columns.modelName)) {
          colMap['modelName'] = colNumber;
        }
        if (mapping.columns.warranty && cellName === normalize(mapping.columns.warranty)) {
          colMap['warranty'] = colNumber;
        }
        if (mapping.columns.price && cellName === normalize(mapping.columns.price)) {
          colMap['price'] = colNumber;
        }
        if (mapping.columns.rawStatus && cellName === normalize(mapping.columns.rawStatus)) {
          colMap['rawStatus'] = colNumber;
        }
      });

      const startRow = mapping.dataStartRow || (mapping.headerRow || 1) + 1;
      const parsedItems: ParsedItemRow[] = [];

      for (let r = startRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);

        // Đếm số lượng cell có nội dung trên dòng
        let nonEmptyCellCount = 0;
        row.eachCell({ includeEmpty: false }, (cell) => {
          if (this.getCellValue(cell).trim()) nonEmptyCellCount++;
        });

        // 1. Bỏ qua dòng trống hoàn toàn hoặc chỉ có duy nhất 1 ô
        // (Đây là các dòng phân cách danh mục như "PC Mini Cubi MSI", "PC MSI", "AIO MSI"...)
        if (nonEmptyCellCount <= 1) continue;

        const productCodeRaw = colMap['productCode']
          ? this.getCellValue(row.getCell(colMap['productCode'])).trim()
          : '';
        const productNameRaw = colMap['productName']
          ? this.getCellValue(row.getCell(colMap['productName'])).trim()
          : '';
        const modelName = colMap['modelName']
          ? this.getCellValue(row.getCell(colMap['modelName'])).trim()
          : null;
        const warranty = colMap['warranty']
          ? this.getCellValue(row.getCell(colMap['warranty'])).trim()
          : null;
        const priceRaw = colMap['price']
          ? this.getCellValue(row.getCell(colMap['price'])).trim()
          : '';
        const rawStatus = colMap['rawStatus']
          ? this.getCellValue(row.getCell(colMap['rawStatus'])).trim()
          : null;

        // 2. Nếu cả mã và tên đều rỗng -> Bỏ qua
        if (!productCodeRaw && !productNameRaw) continue;

        // 3. Bỏ qua nếu dòng lặp lại tên Header
        const normCode = productCodeRaw.toUpperCase();
        const normName = productNameRaw.toUpperCase();
        if (
          normCode === 'PRODUCT CODE' ||
          normCode === 'MÃ KHO S1' ||
          normCode === 'MODEL NAME' ||
          normCode === 'STT' ||
          normCode === 'NO' ||
          normName === 'CẤU HÌNH' ||
          normName === 'TÊN SẢN PHẨM'
        ) {
          continue;
        }

        const price = this.parsePrice(priceRaw);
        const hasPrice = price > 0;
        const hasWarranty = !!warranty && warranty.length > 0;

        // 4. LỌC BỎ DÒNG PHÂN CHIA DANH MỤC / TIÊU ĐỀ SECTION:
        // (Ví dụ: "PC Mini Cubi MSI", "PC MSI", "AIO MSI"...)
        if (!hasPrice && !hasWarranty) {
          // TH a: Dòng banner gộp ô hoặc một trong 2 ô mã/tên rỗng
          if (
            productCodeRaw === productNameRaw ||
            !productCodeRaw ||
            !productNameRaw
          ) {
            continue;
          }
          // TH b: Số ô có dữ liệu trên dòng <= 2
          if (nonEmptyCellCount <= 2) {
            continue;
          }
        }

        // TH c: Mẫu có nối cột giá mà ô giá rỗng, và tên không mang thông số cấu hình máy tính
        if (colMap['price'] && !hasPrice && !hasWarranty) {
          const isSpec =
            /gb|ram|ssd|hdd|core|intel|amd|ryzen|fhd|hz|inch|vga|ti|rtx|wifi|bt|usb|nuc|mini|desktop/i.test(
              productNameRaw,
            );
          if (!isSpec) {
            continue;
          }
        }

        parsedItems.push({
          rowIndex: r,
          productCode: productCodeRaw || productNameRaw,
          productName: productNameRaw || productCodeRaw,
          modelName: modelName || null,
          warranty: this.normalizeWarranty(warranty || ''),
          price,
          rawStatus: rawStatus || null,
        });
      }

      if (parsedItems.length > 0) {
        totalItems += parsedItems.length;
        sheets.push({
          sheetName,
          sheetIndex: sheetIdx,
          items: parsedItems,
        });
      }
    });

    return {
      totalSheets: sheets.length,
      totalItems,
      sheets,
    };
  }

  // =========================================================================
  // GENERIC PARSER DỰ PHÒNG
  // =========================================================================
  private parseGeneric(ws: ExcelJS.Worksheet): ParsedItemRow[] {
    const items: ParsedItemRow[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const c1 = this.getCellValue(row.getCell(1));
      const c2 = this.getCellValue(row.getCell(2));
      const c3 = this.getCellValue(row.getCell(3));
      const c4 = this.getCellValue(row.getCell(4));
      if (!c1 && !c2) continue;
      items.push({
        rowIndex: r,
        productCode: (c1 || c2).trim(),
        productName: (c2 || c3 || c1).trim(),
        warranty: '',
        price: this.parsePrice(c4 || c3),
      });
    }
    return items;
  }
}
