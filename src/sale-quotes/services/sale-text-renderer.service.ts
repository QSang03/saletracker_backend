import { Injectable } from '@nestjs/common';
import {
  buildNameLine,
  formatMoney,
  formatPrice,
  formatWarranty,
  normalizeStatusText,
  stripStatusPrefix,
  sumLineTotals,
  generateAutoProductCode,
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
  priceLabel?: string | null;
  showStockStatus?: boolean | null;
}

export interface QuoteTextOptions {
  mode?: string;
  title?: string | null;
  globalNote?: string | null;
  zaloSuffix?: string | null;
  priceLabel?: string | null;
  showStockStatus?: boolean | null;
}

@Injectable()
export class SaleTextRendererService {
  /**
   * Format báo giá chuẩn, bám sát copySingleRow/copySelectedRows:
   * - standard: nhiều dòng, mỗi dòng có số thứ tự
   * - single: chỉ dòng đầu tiên, không số thứ tự
   * - build: có Đơn giá/SL/Thành tiền/Tổng cộng
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
      body = this.renderSingle(lines[0], options);
    } else if (mode === 'build') {
      body = this.renderBuild(lines, { zaloSuffix: null, priceLabel: options.priceLabel, showStockStatus: options.showStockStatus });
    } else {
      body = this.renderStandardLines(lines, options);
    }

    return this.appendFooter(body, options.globalNote, options.zaloSuffix);
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
        const pLabel = options.priceLabel !== undefined ? options.priceLabel : 'fv';
        const totalLabel = pLabel && pLabel.trim() ? ` ${pLabel.trim()}` : '';
        const price = formatPrice(unitPrice, pLabel);
        const rawStatus = options.showStockStatus === false ? '' : normalizeStatusText(item.statusText);
        const statusClean = stripStatusPrefix(rawStatus);
        const warranty = formatWarranty(item.warranty);
        const namePart = this.nameLine(item).replace(/\t+/g, ' ');
        const nameWithWarranty = warranty ? `${namePart} - ${warranty}` : namePart;
        const code = (item.productCode || generateAutoProductCode(item.name)).trim();
        const statusPart = statusClean ? ` ; ${statusClean}` : '';

        if (quantity > 1) {
          const lineTotal =
            item.lineTotal !== null && item.lineTotal !== undefined
              ? Number(item.lineTotal)
              : unitPrice !== null && unitPrice !== undefined
                ? Number(unitPrice) * quantity
                : null;
          const totalText =
            lineTotal !== null && Number.isFinite(lineTotal)
              ? `Thành tiền: ${formatMoney(lineTotal)}${totalLabel}`
              : 'Thành tiền: CALL';
          return `${index + 1}-${code} ; ${nameWithWarranty} ; Đơn giá: ${price} ; SL: ${quantity} ; ${totalText}${statusPart}`.trimEnd();
        } else {
          return `${index + 1}-${code} ; ${nameWithWarranty} ; ${price}${statusPart}`.trimEnd();
        }
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

    const pLabel = options.priceLabel !== undefined ? options.priceLabel : 'fv';
    const totalLabel = pLabel && pLabel.trim() ? ` ${pLabel.trim()}` : '';
    let text = `${body}\n\nTổng cộng: ${formatMoney(total)}${totalLabel}`;

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
    options: {
      zaloSuffix?: string | null;
      priceLabel?: string | null;
      showStockStatus?: boolean | null;
    } = {},
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
      const pLabel = options.priceLabel !== undefined ? options.priceLabel : 'fv';
      const price = formatPrice(priceValue, pLabel);
      const quantityText = quantity > 1 ? ` - SL: ${quantity}` : '';
      let totalText = '';
      if (quantity > 1 && priceValue) {
        const totalLabel = pLabel && pLabel.trim() ? ` ${pLabel.trim()}` : '';
        totalText = ` (Tổng: ${formatMoney(Number(priceValue) * quantity)}${totalLabel})`;
      }
      const statusText = options.showStockStatus === false ? '' : stripStatusPrefix(item.statusText);
      const status = statusText ? `\t;${statusText}` : '';
      const code = (item.productCode || generateAutoProductCode(description || request)).trim();

      const isReplacement =
        item.matchType === 'replacement' || item.matchType === 'equivalent';

      if (isReplacement) {
        const label =
          item.matchType === 'replacement' ? 'Thay thế' : 'Tương đương';
        body += `${stt}-${request}\n`;
        body += `↳ (${label}): ${code}\t;\t${description}\t${warranty}\t;\t${price}${quantityText}${totalText}${status}\n\n`;
      } else {
        const finalDescription = description || request;
        body += `${stt}-${code}\t;\t${finalDescription}\t${warranty}\t;\t${price}${quantityText}${totalText}${status}\n\n`;
      }
    });

    return this.appendFooter(
      body.trimEnd(),
      null,
      options.zaloSuffix,
    );
  }

  private renderSingle(item: RenderLineItem, options: QuoteTextOptions = {}): string {
    const price = formatPrice(item.unitPrice, false);
    const rawStatus = options.showStockStatus === false ? '' : normalizeStatusText(item.statusText);
    const statusClean = stripStatusPrefix(rawStatus);
    const statusPart = statusClean ? ` ; ${statusClean}` : '';
    const warranty = formatWarranty(item.warranty);
    const namePart = this.nameLine(item).replace(/\t+/g, ' ');
    const nameWithWarranty = warranty ? `${namePart} - ${warranty}` : namePart;
    const code = (item.productCode || '').trim();
    return `${code ? `${code} ; ` : ''}${nameWithWarranty} ; ${price}${statusPart}`.trimEnd();
  }

  private renderStandardLines(items: RenderLineItem[], options: QuoteTextOptions = {}): string {
    return items
      .map((item, index) => {
        const price = formatPrice(item.unitPrice, false);
        const rawStatus = options.showStockStatus === false ? '' : normalizeStatusText(item.statusText);
        const statusClean = stripStatusPrefix(rawStatus);
        const statusPart = statusClean ? ` ; ${statusClean}` : '';
        const warranty = formatWarranty(item.warranty);
        const namePart = this.nameLine(item).replace(/\t+/g, ' ');
        const nameWithWarranty = warranty ? `${namePart} - ${warranty}` : namePart;
        const code = (item.productCode || generateAutoProductCode(item.name)).trim();
        return `${index + 1}-${code} ; ${nameWithWarranty} ; ${price}${statusPart}`.trimEnd();
      })
      .join('\n\n');
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
    const footerLines: string[] = [];
    const seenLines = new Set<string>();

    const addLines = (raw?: string | null) => {
      if (!raw) return;
      const lines = raw.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          !trimmed ||
          trimmed.toLowerCase() === 'giá đã bao gồm vat.' ||
          trimmed.toLowerCase() === 'giá đã bao gồm vat'
        ) {
          continue;
        }
        if (!seenLines.has(trimmed)) {
          seenLines.add(trimmed);
          footerLines.push(trimmed);
        }
      }
    };

    addLines(globalNote);
    addLines(zaloSuffix);

    if (footerLines.length > 0) {
      text += `\n\n${footerLines.join('\n')}`;
    }
    return text.trim();
  }
}
