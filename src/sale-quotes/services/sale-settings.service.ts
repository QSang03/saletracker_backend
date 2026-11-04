import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_PRICING_RULES,
  DEFAULT_STATUS_TEXT,
  PricingRules,
} from '../sale-quote.constants';
import { UpdateSettingsDto } from '../dto/settings.dto';
import { SaleQuoteSetting } from '../entities/sale-quote-setting.entity';

@Injectable()
export class SaleSettingsService {
  constructor(
    @InjectRepository(SaleQuoteSetting)
    private readonly settingRepo: Repository<SaleQuoteSetting>,
  ) {}

  async getForUser(userId: number): Promise<SaleQuoteSetting> {
    const existing = await this.settingRepo.findOne({ where: { userId } });
    if (existing) {
      return existing;
    }
    return this.settingRepo.create({
      userId,
      pricingRules: { ...DEFAULT_PRICING_RULES },
      defaultStatusText: DEFAULT_STATUS_TEXT,
      priceLabel: 'fv',
      defaultGlobalNote: '',
      zaloSuffix: '',
      showStockStatus: true,
      excelDisclaimer1: 'BÁO GIÁ CHỈ MANG TÍNH CHẤT THAM KHẢO, QUÝ KHÁCH VUI LÒNG LIÊN HỆ KINH DOANH ĐỂ CÓ ĐƯỢC GIÁ TỐT NHẤT.',
      excelDisclaimer2: 'HIỆU LỰC BÁO GIÁ CÓ THỜI HẠN TỪ 1-3 NGÀY DO BIẾN ĐỘNG TĂNG GIÁ TỪ HÃNG. MONG QUÝ KHÁCH LƯU Ý.',
    });
  }

  async getEffectiveRules(userId: number): Promise<PricingRules> {
    const settings = await this.getForUser(userId);
    return {
      ...DEFAULT_PRICING_RULES,
      ...(settings.pricingRules || {}),
    };
  }

  async upsert(
    userId: number,
    dto: UpdateSettingsDto,
  ): Promise<SaleQuoteSetting> {
    let settings = await this.settingRepo.findOne({ where: { userId } });
    if (!settings) {
      settings = this.settingRepo.create({
        userId,
        pricingRules: { ...DEFAULT_PRICING_RULES },
        defaultStatusText: DEFAULT_STATUS_TEXT,
        priceLabel: 'fv',
        defaultGlobalNote: '',
        zaloSuffix: '',
      });
    }

    if (dto.pricingRules) {
      settings.pricingRules = {
        ...DEFAULT_PRICING_RULES,
        ...(settings.pricingRules || {}),
        ...dto.pricingRules,
      };
    }
    if (dto.defaultStatusText !== undefined) {
      settings.defaultStatusText = dto.defaultStatusText;
    }
    if (dto.priceLabel !== undefined) {
      settings.priceLabel = dto.priceLabel;
    }
    if (dto.defaultGlobalNote !== undefined) {
      settings.defaultGlobalNote = dto.defaultGlobalNote;
    }
    if (dto.zaloSuffix !== undefined) {
      settings.zaloSuffix = dto.zaloSuffix;
    }
    if (dto.showStockStatus !== undefined) {
      settings.showStockStatus = dto.showStockStatus;
    }
    if (dto.excelDisclaimer1 !== undefined) {
      settings.excelDisclaimer1 = dto.excelDisclaimer1;
    }
    if (dto.excelDisclaimer2 !== undefined) {
      settings.excelDisclaimer2 = dto.excelDisclaimer2;
    }

    return this.settingRepo.save(settings);
  }

  toResponse(settings: SaleQuoteSetting) {
    return {
      id: settings.id ?? null,
      userId: settings.userId,
      pricingRules: {
        ...DEFAULT_PRICING_RULES,
        ...(settings.pricingRules || {}),
      },
      defaultStatusText: settings.defaultStatusText ?? DEFAULT_STATUS_TEXT,
      priceLabel: settings.priceLabel ?? 'fv',
      defaultGlobalNote: settings.defaultGlobalNote ?? '',
      zaloSuffix: settings.zaloSuffix ?? '',
      showStockStatus: settings.showStockStatus ?? true,
      excelDisclaimer1: settings.excelDisclaimer1 ?? 'BÁO GIÁ CHỈ MANG TÍNH CHẤT THAM KHẢO, QUÝ KHÁCH VUI LÒNG LIÊN HỆ KINH DOANH ĐỂ CÓ ĐƯỢC GIÁ TỐT NHẤT.',
      excelDisclaimer2: settings.excelDisclaimer2 ?? 'HIỆU LỰC BÁO GIÁ CÓ THỜI HẠN TỪ 1-3 NGÀY DO BIẾN ĐỘNG TĂNG GIÁ TỪ HÃNG. MONG QUÝ KHÁCH LƯU Ý.',
      createdAt: settings.createdAt ?? null,
      updatedAt: settings.updatedAt ?? null,
    };
  }
}
