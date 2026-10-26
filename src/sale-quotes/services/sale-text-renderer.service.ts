import { Injectable } from '@nestjs/common';
import {
  buildNameLine,
  formatMoney,
  formatPrice,
  formatWarranty,
  normalizeStatusText,
  stripStatusPrefix,
  sumLineTotals,
} from '../utils/text.util';

export interface RenderLineItem {
  productCode?: string | null;
  pn?: string | null;
  name?: string | null;
  description?: string | null;
  warranty?: string | null;
  unitPrice?: number | null;
  salePrice?: number | null;
  costPrice?: number | null;
  quantity?: number | null;
  lineTotal?: number | null;
  statusText?: string | null;
  requestText?: string | null;
  matchType?: string | null;
  note?: string | null;
}

export interface BuildTextOptions {
  includeSpecs?: boolean;
  specs?: Array<{ label?: string; value?: string }> | null;
  zaloSuffix?: string | null;
}

export interface QuoteTextOptions {
  mode?: string;
  title?: string | null;
  globalNote?: string | null;
  zaloSuffix?: string | null;
  customerMarkupPercent?: number;
  customerRoundTo?: number;
}

@Injectable()
export class SaleTextRendererService {
  /**
   * Format báo giá chuẩn, bám sát copySingleRow/copySelectedRows:
   * - standard: nhiều dòng, mỗi dòng có số thứ tự
   * - single: chỉ dòng đầu tiên, không số thứ tự
   * - build: có Đơn giá/SL/Thành tiền/Tổng cộng
   * - customer: bản gửi khách, giá đã cộng markup
   */
  renderQuote(
    items: RenderLineItem[],
    options: QuoteTextOptions = {},
  ): string {
    const mode = options.mode || 'standard';
    const lines = (items || []).filter(Boolean);

    if (lines.length === 0) {
      return this.appendFooter('', options.globalNote, options.zaloSuffix);
    }

    let body = '';
    if (mode === 'single') {
      body = this.renderSingle(lines[0]);
    } else if (mode === 'build') {
      body = this.renderBuild(lines, { zaloSuffix: null });
    } else if (mode === 'customer') {
      body = this.renderCustomerLines(
        lines,
        options.title,
        options.customerMarkupPercent ?? 10,
        options.customerRoundTo ?? 1000,
      );
    } else {
      body = this.renderStandardLines(lines);
    }

    // Giống file gốc: quote/máy ráp chỉ nối zaloSuffix, không nối globalNote.
    return this.appendFooter(body, null, options.zaloSuffix);
  }

  /**
   * Format copy Zalo cho cấu hình máy ráp, bám sát copyMayRapGroup:
   * 1-MÃ<TAB>;<TAB>P/N<TAB>TÊN<TAB>BH<TAB>;<TAB>Đơn giá: ... fv<TAB>;<TAB>
   * SL: n<TAB>;<TAB>Thành tiền: ... ₫<TAB>;TÌNH TRẠNG
   * ...
   * Tổng cộng:<6 tab>... ₫
   */
  renderBuild(
    items: RenderLineItem[],
    options: BuildTextOptions = {},
  ): string {
    const lines = (items || []).filter(Boolean);
    if (lines.length === 0) {
      return this.appendFooter('', options.zaloSuffix);
    }

    const body = lines
      .map((item, index) => {
        const quantity = Number(item.quantity || 1);
        const unitPrice = item.unitPrice ?? item.salePrice;
        const price = formatPrice(unitPrice, true);
        const lineTotal =
          item.lineTotal !== null && item.lineTotal !== undefined
            ? Number(item.lineTotal)
            : unitPrice !== null && unitPrice !== undefined
              ? Number(unitPrice) * quantity
              : null;
        const totalText =
          lineTotal !== null && Number.isFinite(lineTotal)
            ? `Thành tiền: ${formatMoney(lineTotal)} ₫`
            : 'Thành tiền: CALL';
        const status = normalizeStatusText(item.statusText);
        return `${index + 1}-${item.productCode || ''}\t;\t${this.nameLine(
          item,
        )}\t${formatWarranty(item.warranty)}\t;\tĐơn giá: ${price}\t;\tSL: ${quantity}\t;\t${totalText}\t${status}`.trimEnd();
      })
      .join('\n\n');

    const total = sumLineTotals(
      lines.map((item) => {
        const unitPrice = item.unitPrice ?? item.salePrice;
        return {
          lineTotal:
            item.lineTotal ??
            (unitPrice !== null && unitPrice !== undefined
              ? Number(unitPrice) * Number(item.quantity || 1)
              : null),
        };
      }),
    );

    let text = `${body}\n\nTổng cộng:\t\t\t\t\t\t${formatMoney(total)} ₫`;

    if (options.includeSpecs && options.specs && options.specs.length > 0) {
      text += '\n\n*THÔNG SỐ KỸ THUẬT:*';
      for (const spec of options.specs) {
        const label = (spec?.label || '').trim();
        const value = (spec?.value || '').trim();
        if (!label && !value) {
          continue;
        }
        text += `\n- ${label}${label && value ? ': ' : ''}${value}`;
      }
    }

    return this.appendFooter(text, options.zaloSuffix);
  }

  /**
   * Format copy Zalo cho báo giá nhanh, bám sát bqnCopyToZalo:
   * 1. MÃ<TAB>;<TAB>DIỄN GIẢI<TAB>BH<TAB>;<TAB>GIÁ fv - SL: n (Tổng: ... fv)<TAB>;TÌNH TRẠNG
   * Dòng thay thế/tương đương có thêm "↳ (Thay thế):" ở dòng dưới.
   */
  renderQuickCase(
    quickCase: {
      title?: string | null;
      globalNote?: string | null;
    },
    items: RenderLineItem[],
    options: { zaloSuffix?: string | null } = {},
  ): string {
    let body = '';
    if (quickCase.title) {
      body += `*${quickCase.title.toUpperCase()}*\n\n`;
    }

    const lines = (items || []).filter(Boolean);
    lines.forEach((item, index) => {
      const stt = index + 1;
      const request = (item.requestText || '').replace(/\n/g, ' ').trim();
      const description = (item.description || '').replace(/\n/g, ' ').trim();
      const warranty = formatWarranty(item.warranty);
      const quantity = Number(item.quantity || 1);
      const priceValue = item.salePrice ?? item.unitPrice;
      const price = formatPrice(priceValue, true);
      const quantityText = quantity > 1 ? ` - SL: ${quantity}` : '';
      let totalText = '';
      if (quantity > 1 && priceValue) {
        totalText = ` (Tổng: ${formatMoney(Number(priceValue) * quantity)} fv)`;
      }
      const statusText = stripStatusPrefix(item.statusText);
      const status = statusText ? `\t;${statusText}` : '';
      const codePrefix = item.productCode ? `${item.productCode}\t;\t` : '';

      const isReplacement =
        item.matchType === 'replacement' || item.matchType === 'equivalent';

      if (isReplacement) {
        const label =
          item.matchType === 'replacement' ? 'Thay thế' : 'Tương đương';
        body += `${stt}. ${request}\n`;
        body += `↳ (${label}): ${codePrefix}${description}\t${warranty}\t;\t${price}${quantityText}${totalText}${status}\n\n`;
      } else {
        const finalDescription = description || request;
        body += `${stt}. ${codePrefix}${finalDescription}\t${warranty}\t;\t${price}${quantityText}${totalText}${status}\n\n`;
      }
    });

    return this.appendFooter(
      body.trimEnd(),
      quickCase.globalNote,
      options.zaloSuffix,
    );
  }

  private renderSingle(item: RenderLineItem): string {
    const price = formatPrice(item.unitPrice, false);
    const status = normalizeStatusText(item.statusText);
    return `${item.productCode || ''}\t;\t${this.nameLine(item)}\t${formatWarranty(
      item.warranty,
    )}\t;\t${price}\t${status}`.trimEnd();
  }

  private renderStandardLines(items: RenderLineItem[]): string {
    return items
      .map((item, index) => {
        const price = formatPrice(item.unitPrice, false);
        const status = normalizeStatusText(item.statusText);
        return `${index + 1}-${item.productCode || ''}\t;\t${this.nameLine(
          item,
        )}\t${formatWarranty(item.warranty)}\t;\t${price}\t${status}`.trimEnd();
      })
      .join('\n\n');
  }

  private renderCustomerLines(
    items: RenderLineItem[],
    title: string | null | undefined,
    markupPercent: number,
    roundTo: number,
  ): string {
    let body = title ? `*${title.toUpperCase()}*\n\n` : '';
    let total = 0;

    body += items
      .map((item, index) => {
        const quantity = Number(item.quantity || 1);
        const basePrice = Number(item.unitPrice);
        const customerPrice =
          Number.isFinite(basePrice) && basePrice > 0
            ? Math.round(
                (basePrice * (1 + markupPercent / 100)) / (roundTo || 1000),
              ) * (roundTo || 1000)
            : null;
        if (customerPrice) {
          total += customerPrice * quantity;
        }
        const priceText = customerPrice
          ? `${formatMoney(customerPrice)} ₫`
          : 'CALL';
        const nameLine = this.nameLine(item).replace(/\t/g, ' | ');
        const warranty = formatWarranty(item.warranty);
        return `${index + 1}. ${nameLine}\n   BH: ${warranty || '—'} | SL: ${quantity} | Giá: ${priceText}`;
      })
      .join('\n\n');

    return `${body}\n\nTổng cộng: ${formatMoney(total)} ₫`;
  }

  private nameLine(item: RenderLineItem): string {
    return buildNameLine(
      item.pn,
      item.name,
      item.productCode,
      item.description,
    );
  }

  private appendFooter(
    body: string,
    globalNote?: string | null,
    zaloSuffix?: string | null,
  ): string {
    let text = (body || '').trimEnd();
    const note = (globalNote || '').trim();
    if (note) {
      text += `\n${note}`;
    }
    const suffix = (zaloSuffix || '').trim();
    if (suffix) {
      text += `\n${suffix}`;
    }
    return text.trim();
  }
}
