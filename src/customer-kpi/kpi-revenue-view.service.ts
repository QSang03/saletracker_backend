import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../system_config/system_config.entity';
import { KpiUser } from './kpi-scope.service';
import { RevenueViewMode } from './kpi-mask.helper';

const REVENUE_VIEW_CONFIG = 'kpi_revenue_visibility';
const DEFAULT_MODE: RevenueViewMode = 'full';

/**
 * Công tắc admin bật/tắt xem doanh số của sale khác.
 *
 * - `full` (mặc định): manager/pm/view/admin xem được số doanh số/doanh thu.
 * - `percent`: chỉ xem %, mọi số tiền tuyệt đối bị mask.
 *
 * **Không ảnh hưởng lương/thưởng**: `bonus_amount`, `monthly_bonus_total`,
 * `clawback_amount` luôn bị mask với người khác ở mọi chế độ.
 */
@Injectable()
export class KpiRevenueViewService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  async getMode(): Promise<RevenueViewMode> {
    const row = await this.configRepo.findOne({
      where: { name: REVENUE_VIEW_CONFIG },
    });
    return row?.value === 'percent' ? 'percent' : DEFAULT_MODE;
  }

  async getSettings(): Promise<{ enabled: boolean; mode: RevenueViewMode }> {
    const mode = await this.getMode();
    return { enabled: mode === 'full', mode };
  }

  async setEnabled(
    enabled: boolean,
    user: KpiUser,
  ): Promise<{ enabled: boolean; mode: RevenueViewMode }> {
    if (!this.isAdmin(user)) {
      throw new ForbiddenException('Chỉ admin được bật/tắt quyền xem doanh số');
    }
    const mode: RevenueViewMode = enabled ? 'full' : 'percent';
    const row = await this.configRepo.findOne({
      where: { name: REVENUE_VIEW_CONFIG },
    });
    if (row) {
      row.value = mode;
      await this.configRepo.save(row);
    } else {
      await this.configRepo.save(
        this.configRepo.create({
          name: REVENUE_VIEW_CONFIG,
          display_name: 'Quyền xem doanh số của sale khác (full/percent)',
          value: mode,
          type: 'string',
          section: 'kpi',
          status: 1,
        }),
      );
    }
    return { enabled, mode };
  }

  private isAdmin(user: KpiUser | null | undefined): boolean {
    return (user?.roles ?? []).some((role) => {
      const name = typeof role === 'string' ? role : (role?.name ?? '');
      return name.toLowerCase() === 'admin';
    });
  }
}
