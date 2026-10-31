import { Injectable } from '@nestjs/common';
import { PricingRules } from '../sale-quote.constants';
import { SaleSettingsService } from './sale-settings.service';

@Injectable()
export class SalePricingService {
  constructor(private readonly settingsService: SaleSettingsService) {}

  async getRules(userId: number): Promise<PricingRules> {
    return this.settingsService.getEffectiveRules(userId);
  }

  roundTo(value: number, step: number): number {
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    const safeStep = Number(step) > 0 ? Number(step) : 1;
    return Math.round(value / safeStep) * safeStep;
  }

  /**
   * Tính giá bán theo quy tắc cấu hình (áp dụng cho Tab Báo Giá Theo Yêu Cầu):
   * - cost <= 0 hoặc null -> null (hiển thị CALL)
   * - cost < lowPriceThreshold -> cost + lowPriceMargin
   * - cost >= lowPriceThreshold -> cost * (1 + highPriceMarkupPercent / 100)
   * - làm tròn theo roundTo
   */
  suggestSalePrice(
    costPrice?: number | null,
    rules?: Partial<PricingRules> | null,
  ): number | null {
    const cost = Number(costPrice);
    if (!Number.isFinite(cost) || cost <= 0) {
      return null;
    }
    const threshold = Number(rules?.lowPriceThreshold ?? 1_000_000);
    const margin = Number(rules?.lowPriceMargin ?? 20_000);
    const percent = Number(rules?.highPriceMarkupPercent ?? 2);
    const roundTo = Number(rules?.roundTo ?? 1_000);

    const raw = cost < threshold ? cost + margin : cost * (1 + percent / 100);
    return this.roundTo(raw, roundTo);
  }

  marginAmount(
    salePrice?: number | null,
    costPrice?: number | null,
  ): number | null {
    const sale = Number(salePrice);
    const cost = Number(costPrice);
    if (!Number.isFinite(sale) || !Number.isFinite(cost)) {
      return null;
    }
    return sale - cost;
  }

  marginPercent(
    salePrice?: number | null,
    costPrice?: number | null,
  ): number | null {
    const sale = Number(salePrice);
    const cost = Number(costPrice);
    if (!Number.isFinite(sale) || !Number.isFinite(cost) || cost <= 0) {
      return null;
    }
    return Number((((sale - cost) / cost) * 100).toFixed(2));
  }
}
