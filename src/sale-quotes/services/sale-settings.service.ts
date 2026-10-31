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
      createdAt: settings.createdAt ?? null,
      updatedAt: settings.updatedAt ?? null,
    };
  }
}
