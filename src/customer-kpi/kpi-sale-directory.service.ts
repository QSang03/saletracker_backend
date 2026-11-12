import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { SaleSlpMapping } from './kpi-coverage.calc';

export interface KpiSaleInfo {
  id: number;
  fullName: string;
  employeeCode: string | null;
}

/**
 * Tra cứu sale → mã nhân viên → slpCode NKM.
 *
 * Dùng chung cho KpiCoverageService (tháng/quý) và KpiCareFunnelService (phễu
 * 4 nhóm) để hai nơi không lệch nhau khi bảng tra mã thay đổi.
 */
@Injectable()
export class KpiSaleDirectoryService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(NkmSaleMap)
    private readonly saleMapRepo: Repository<NkmSaleMap>,
  ) {}

  async loadSaleInfos(saleIds: number[]): Promise<Map<number, KpiSaleInfo>> {
    const result = new Map<number, KpiSaleInfo>();
    if (saleIds.length === 0) return result;
    const users = await this.userRepo
      .createQueryBuilder('u')
      .select(['u.id', 'u.fullName', 'u.employeeCode'])
      .where('u.id IN (:...ids)', { ids: saleIds })
      .andWhere('u.deletedAt IS NULL')
      .getMany();
    for (const user of users) {
      result.set(user.id, {
        id: user.id,
        fullName: user.fullName ?? `User #${user.id}`,
        employeeCode: user.employeeCode ?? null,
      });
    }
    return result;
  }

  async loadMappings(
    saleIds: number[],
    saleInfos: Map<number, KpiSaleInfo>,
  ): Promise<SaleSlpMapping[]> {
    const employeeCodes = [
      ...new Set(
        saleIds
          .map((id) => saleInfos.get(id)?.employeeCode)
          .filter((code): code is string => !!code),
      ),
    ];
    const byEmployee = new Map<string, number[]>();
    if (employeeCodes.length > 0) {
      const rows = await this.saleMapRepo.find({
        where: {
          employee_code: In(employeeCodes),
          is_active: true,
        },
        select: ['employee_code', 'slp_code'],
      });
      for (const row of rows) {
        const list = byEmployee.get(row.employee_code) ?? [];
        list.push(row.slp_code);
        byEmployee.set(row.employee_code, list);
      }
    }
    return saleIds.map((saleId) => {
      const code = saleInfos.get(saleId)?.employeeCode ?? null;
      return {
        saleId,
        slpCodes: code ? [...new Set(byEmployee.get(code) ?? [])].sort() : [],
      };
    });
  }
}
