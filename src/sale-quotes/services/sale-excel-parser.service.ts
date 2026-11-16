import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

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
