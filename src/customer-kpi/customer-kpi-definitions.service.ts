import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { getRoleNames } from '../common/utils/user-permission.helper';
import {
  KpiComparison,
  KpiDefinition,
  KpiDenominator,
  KpiPeriod,
  ScoringMode,
} from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import {
  CreateKpiDefinitionDto,
  KpiDefinitionQueryDto,
  UpdateKpiDefinitionDto,
} from './dto/kpi-definition.dto';

/**
 * Bộ tiêu chí mặc định nhóm `kinh-doanh` (thiết kế mục 5.1).
 *
 * Hai tiêu chí doanh số lấy từ API NKM: cấp khách chấm "có phát sinh", cấp sale
 * chấm doanh thu + tỷ lệ Key/Non so CHỈ TIÊU QUÝ. Chu kỳ của cả hai là `quarter`
 * — target phân theo quý, xem tuần/tháng chỉ có doanh thu thực (thiết kế
 * THIET-KE-DOANH-SO-API-NKM.md §1.2). Chỉ tiêu không nhập tay nữa: bảng
 * `sale_revenue_target` do job đồng bộ ghi, API `/customer-kpi-targets` chặn
 * hai tiêu chí này.
 */
const DEFAULT_KPI_DEFINITIONS: Array<Partial<KpiDefinition>> = [
  {
    team_group: 'kinh-doanh',
    key: 'doanh_so_key',
    name: 'Doanh số theo Key',
    metric: 'revenue_key',
    scoring_mode: ScoringMode.RATIO,
    denominator: KpiDenominator.TARGET_VALUE,
    period: KpiPeriod.QUARTER,
    sort_order: 1,
    description:
      'Cấp khách: có phát sinh (≥1 phiếu) trong kỳ. Cấp sale: Dso Key / tổng Dso, chỉ tiêu quý lấy từ API NKM (get-doanhso-quy-truhangtra)',
  },
  {
    team_group: 'kinh-doanh',
    key: 'doanh_so_non',
    name: 'Doanh số theo NON',
    metric: 'revenue_non',
    scoring_mode: ScoringMode.RATIO,
    denominator: KpiDenominator.TARGET_VALUE,
    period: KpiPeriod.QUARTER,
    sort_order: 2,
    description:
      'Cấp khách: có phát sinh (≥1 phiếu) trong kỳ. Cấp sale: Dso Non / tổng Dso, dùng chung chỉ tiêu quý với doanh_so_key',
  },
  {
    team_group: 'kinh-doanh',
    key: 'support_khach',
    name: 'Support Khách / Thăm hỏi',
    metric: 'movement_report',
    scoring_mode: ScoringMode.BINARY,
    comparison: KpiComparison.GTE,
    period: KpiPeriod.MONTH,
    target_value: 1,
    sort_order: 3,
    description:
      'Tiêu chí 3: tháng đạt khi có ≥1 tin báo cáo di chuyển khớp cụm system_config.movement_report_pattern ("di gap khach") + mã KH (bảng customer_movement_reports, job Python ghi)',
  },
  {
    team_group: 'kinh-doanh',
    key: 'lien_lac_phan_hoi',
    name: 'Liên lạc / phản hồi',
    metric: 'monthly_contact',
    scoring_mode: ScoringMode.BINARY,
    comparison: KpiComparison.GTE,
    period: KpiPeriod.MONTH,
    target_value: 1,
    sort_order: 4,
    description:
      'Tiêu chí 4: tháng đạt khi có ≥1 tin nhắn từ sale tới khách (outbound > 0)',
  },
  {
    team_group: 'kinh-doanh',
    key: 'goi_y_thuc_hien',
    name: 'Gợi ý thực hiện',
    metric: 'suggestion_ack',
    scoring_mode: ScoringMode.BINARY,
    comparison: KpiComparison.GTE,
    period: KpiPeriod.DAY,
    target_value: 1,
    sort_order: 5,
    description: 'Tổng hợp từ hoạt động: đã xử lý gợi ý hay chưa',
  },
];

/** CRUD cấu hình tiêu chí KPI — làm đủ hôm nay (bảng + seed mặc định). */
@Injectable()
export class CustomerKpiDefinitionsService implements OnModuleInit {
  private readonly logger = new Logger(CustomerKpiDefinitionsService.name);

  constructor(
    @InjectRepository(KpiDefinition)
    private readonly definitionRepo: Repository<KpiDefinition>,
    @InjectRepository(KpiTarget)
    private readonly targetRepo: Repository<KpiTarget>,
  ) {}

  /** Nạp 5 tiêu chí mặc định khi bảng nhóm kinh-doanh còn trống. */
  async onModuleInit() {
    const count = await this.definitionRepo.count({
      where: { team_group: 'kinh-doanh' },
    });
    if (count === 0) {
      await this.definitionRepo.save(
        this.definitionRepo.create(DEFAULT_KPI_DEFINITIONS),
      );
    }
    await this.upgradeBehaviorCriteria();
    await this.upgradeRevenueCriteria();
  }

  /**
   * Nâng cấp tiêu chí 3/4 từ ratio/theo-ngày lên binary/theo-tháng cho môi
   * trường ĐÃ seed (nhánh count === 0 không chạy lại được). Idempotent —
   * chạy lại không đổi gì. Chỉ đè dòng còn đúng định dạng CŨ; ai đã sửa tay
   * sang khác thì giữ nguyên (không đè cấu hình chủ đích).
   */
  private async upgradeBehaviorCriteria() {
    const oldMetricByKey: Record<string, string> = {
      support_khach: 'contacted_customers',
      lien_lac_phan_hoi: 'responded_customers',
    };
    const rows = await this.definitionRepo.find({
      where: { team_group: 'kinh-doanh' },
    });
    const stale = rows.filter((row) => oldMetricByKey[row.key] === row.metric);
    for (const row of stale) {
      Object.assign(row, {
        metric:
          row.key === 'support_khach' ? 'movement_report' : 'monthly_contact',
        scoring_mode: ScoringMode.BINARY,
        comparison: KpiComparison.GTE,
        period: KpiPeriod.MONTH,
        target_value: 1,
        denominator: null,
      });
    }
    if (stale.length > 0) {
      await this.definitionRepo.save(stale);
      this.logger.log(
        `Đã nâng cấp tiêu chí hành vi sang binary/theo-tháng: ${stale
          .map((r) => r.key)
          .join(', ')}`,
      );
    }
  }

  /**
   * Nâng cấp hai tiêu chí doanh số từ "chờ API" (chu kỳ tháng, mô tả tạm) sang
   * chu kỳ QUÝ + mô tả đúng luật API NKM — cho môi trường ĐÃ seed trước khi làm
   * module doanh số. Idempotent, chỉ đè dòng còn đúng định dạng CŨ; ai đã sửa
   * cấu hình theo cách khác thì giữ nguyên (không đè tay của chủ cấu hình).
   *
   * Lưu ý: KHÔNG đổi `metric` (`revenue_key`/`revenue_non`) vì đó là khoá mà
   * engine dùng nhận ra tiêu chí doanh số.
   */
  private async upgradeRevenueCriteria() {
    const rows = await this.definitionRepo.find({
      where: { team_group: 'kinh-doanh' },
    });
    const stale = rows.filter(
      (row) =>
        (row.key === 'doanh_so_key' || row.key === 'doanh_so_non') &&
        (row.metric === 'revenue_key' || row.metric === 'revenue_non') &&
        (row.period === KpiPeriod.MONTH ||
          row.description === 'Chờ API doanh thu'),
    );
    for (const row of stale) {
      const index = DEFAULT_KPI_DEFINITIONS.findIndex(
        (definition) => definition.key === row.key,
      );
      const next = DEFAULT_KPI_DEFINITIONS[index];
      Object.assign(row, {
        period: KpiPeriod.QUARTER,
        description: next?.description ?? row.description,
        scoring_mode: ScoringMode.RATIO,
        denominator: KpiDenominator.TARGET_VALUE,
      });
    }
    if (stale.length > 0) {
      await this.definitionRepo.save(stale);
      this.logger.log(
        `Đã nâng cấp tiêu chí doanh số sang chu kỳ quý (API NKM): ${stale
          .map((r) => r.key)
          .join(', ')}`,
      );
    }
  }

  async list(query: KpiDefinitionQueryDto) {
    const qb = this.definitionRepo.createQueryBuilder('d');
    if (query.team_group) {
      qb.andWhere('d.team_group = :teamGroup', { teamGroup: query.team_group });
    }
    if (query.status === 'active') {
      qb.andWhere('d.is_active = 1');
    } else if (query.status === 'inactive') {
      qb.andWhere('d.is_active = 0');
    }
    qb.orderBy('d.team_group', 'ASC').addOrderBy('d.sort_order', 'ASC');
    const data = await qb.getMany();
    return { data, total: data.length };
  }

  /**
   * Cấu hình tiêu chí là màn hình của QUẢN TRỊ VIÊN (thiết kế vai trò).
   * Guard theo slug+action không phân biệt được ai được sửa màn hình nào
   * (user-khach-hang cũng có action 'update'), nên chặn thêm ở service.
   */
  private assertAdmin(user: any) {
    if (!getRoleNames(user).includes('admin')) {
      throw new ForbiddenException(
        'Chỉ quản trị viên mới được cấu hình tiêu chí KPI',
      );
    }
  }

  async create(dto: CreateKpiDefinitionDto, user: any) {
    this.assertAdmin(user);
    const existed = await this.definitionRepo.findOne({
      where: { team_group: dto.team_group ?? 'kinh-doanh', key: dto.key },
    });
    if (existed) {
      throw new ConflictException(
        `Tiêu chí "${dto.key}" đã tồn tại trong nhóm "${dto.team_group ?? 'kinh-doanh'}"`,
      );
    }
    return this.definitionRepo.save(
      this.definitionRepo.create({
        ...dto,
        scoring_mode: dto.scoring_mode as ScoringMode,
        denominator: dto.denominator as KpiDenominator | undefined,
        period: dto.period as KpiPeriod | undefined,
        comparison: dto.comparison as KpiComparison | undefined,
      }),
    );
  }

  async update(id: number, dto: UpdateKpiDefinitionDto, user: any) {
    this.assertAdmin(user);
    const definition = await this.definitionRepo.findOne({ where: { id } });
    if (!definition) throw new NotFoundException('Không tìm thấy tiêu chí');

    if (dto.scoring_mode === 'binary') {
      // binary không dùng mẫu số
      dto.denominator = undefined;
    } else if (dto.scoring_mode === 'ratio') {
      // ratio không so ngưỡng trực tiếp
      dto.comparison = undefined;
    }
    Object.assign(definition, dto);
    return this.definitionRepo.save(definition);
  }

  async remove(id: number, user: any) {
    this.assertAdmin(user);
    const definition = await this.definitionRepo.findOne({ where: { id } });
    if (!definition) throw new NotFoundException('Không tìm thấy tiêu chí');

    const targetCount = await this.targetRepo.count({
      where: { criterion_key: definition.key },
    });
    if (targetCount > 0) {
      throw new ConflictException(
        `Tiêu chí "${definition.key}" đang có ${targetCount} dòng chỉ tiêu gán. Hãy tắt (is_active = false) thay vì xoá.`,
      );
    }
    await this.definitionRepo.remove(definition);
    return { deleted: true };
  }
}
