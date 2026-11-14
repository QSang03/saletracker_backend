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
      'Tiêu chí 3: cấu hình được — binary đạt khi số khách có lịch hẹn completed + matched + checkin_at ≥ target; ratio trả % khách có lịch hẹn / tổng khách phân công. Nguồn API lịch hẹn, theo ngày check-in.',
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
      'Tiêu chí 4: cấu hình được — binary đạt khi số khách có ≥1 tin sale gửi đi ≥ target; ratio trả % khách được liên lạc / khách đo được Zalo.',
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
    description:
      'Tiêu chí 5: khách không còn gợi ý chăm sóc tồn tại thời điểm chấm — chưa phản hồi (tin khách chưa được trả lời), KEY bỏ bê ≥3 ngày ĐO ĐƯỢC, NON có đơn ≤30 ngày bị bỏ bê ≥7 ngày ĐO ĐƯỢC. Gợi ý doanh số không tham gia TC5. Khách chăm đều → không có gợi ý → đạt.',
  },
  {
    team_group: 'kinh-doanh',
    key: 'goi_y_don_hang',
    name: 'Gợi ý đơn hàng',
    metric: 'open_order_suggestion',
    scoring_mode: ScoringMode.BINARY,
    comparison: KpiComparison.GTE,
    period: KpiPeriod.DAY,
    target_value: 1,
    sort_order: 6,
    description:
      'Tiêu chí 6: đơn CHƯA CHỐT trên Zalo tạo trong 4 ngày gần nhất của sale × khách trong danh sách (orders.sale_by + order_details.meta_customer_id khớp customer_zalo) — đếm số gợi ý và tổng giá trị (unit_price × quantity, chưa VAT) để đốc chốt. Đạt = có ≥1 đơn cần chốt; đổi `comparison` sang lte + target 0 nếu muốn nghĩa "đạt = hết đơn tồn"',
  },
  {
    team_group: 'kinh-doanh',
    key: 'sla_phan_hoi_2h',
    name: 'SLA phản hồi 2 giờ',
    metric: 'sla_compliance',
    scoring_mode: ScoringMode.BINARY,
    comparison: KpiComparison.GTE,
    period: KpiPeriod.MONTH,
    target_value: 1,
    sort_order: 7,
    description:
      'Tiêu chí 7 (KPI customer): tháng đạt khi không có vi phạm SLA 2h CHƯA được miễn. Nguồn: kpi_sla_violations do Python quét Zalo ghi; lịch thứ 2–7, 08:00–23:00, xuyên trưa, bỏ Chủ nhật/ngày lễ; call tính là phản hồi, emoji/reaction không tính. Khiếu nại được duyệt → is_waived=1, không tính vi phạm.',
  },
];

/**
 * Metric CỐ ĐỊNH của từng tiêu chí hệ thống — key và adapter là một cặp.
 * Đổi metric dưới cùng key sẽ làm tiêu chí chấm bằng thuật toán khác (ví dụ
 * `support_khach` chuyển sang chấm tin nhắn thay vì lịch hẹn), nên BE chặn
 * để không phá nghĩa của KPI. Tiêu chí custom (key ngoài map) vẫn tự chọn.
 */
const SYSTEM_METRIC_BY_KEY: Record<string, string> = {
  support_khach: 'movement_report',
  lien_lac_phan_hoi: 'monthly_contact',
  goi_y_thuc_hien: 'suggestion_ack',
  goi_y_don_hang: 'open_order_suggestion',
  sla_phan_hoi_2h: 'sla_compliance',
  doanh_so_key: 'revenue_key',
  doanh_so_non: 'revenue_non',
};

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
    await this.ensureDefaultCriteria();
    await this.upgradeSuggestionAckDescription();
    await this.upgradeVisitContactDescriptions();
    // Replace only the obsolete provider description, preserve admin settings.
    const legacy = await this.definitionRepo.find({
      where: { metric: 'movement_report' },
    });
    for (const row of legacy) {
      if (
        row.description?.includes('movement_report_pattern') ||
        row.description?.includes(
          'Trước mốc chuyển đổi dùng bằng chứng lưu trữ',
        )
      ) {
        row.description = DEFAULT_KPI_DEFINITIONS.find(
          (d) => d.key === 'support_khach',
        )!.description!;
        await this.definitionRepo.save(row);
      }
    }
  }

  /**
   * Bù các tiêu chí mặc định còn THIẾU cho môi trường đã seed trước đó (nhánh
   * `count === 0` không chạy lại được) — ví dụ tiêu chí 6 "Gợi ý đơn hàng" thêm
   * sau khi bộ 5 tiêu chí đã nằm trong DB.
   *
   * Chỉ THÊM dòng thiếu, không đụng dòng đã có: admin đã sửa ngưỡng/thuật toán
   * hay tắt (`is_active = 0`) thì giữ nguyên quyết định đó.
   */
  private async ensureDefaultCriteria() {
    const rows = await this.definitionRepo.find({
      where: { team_group: 'kinh-doanh' },
    });
    const existing = new Set(rows.map((row) => row.key));
    const missing = DEFAULT_KPI_DEFINITIONS.filter(
      (definition) => !existing.has(String(definition.key)),
    );
    if (missing.length === 0) return;
    await this.definitionRepo.save(this.definitionRepo.create(missing));
    this.logger.log(
      `Đã bổ sung tiêu chí mặc định còn thiếu: ${missing
        .map((definition) => definition.key)
        .join(', ')}`,
    );
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
   * Cập nhật mô tả TC5 từ luật cũ “đã xử lý gợi ý” sang luật “không còn gợi ý
   * chăm sóc tồn”. Chỉ đè đúng mô tả mặc định cũ; admin đã sửa tay thì giữ.
   */
  private async upgradeSuggestionAckDescription() {
    const oldDefault = 'Tổng hợp từ hoạt động: đã xử lý gợi ý hay chưa';
    const next = DEFAULT_KPI_DEFINITIONS.find(
      (definition) => definition.key === 'goi_y_thuc_hien',
    )!.description!;
    const rows = await this.definitionRepo.find({
      where: { metric: 'suggestion_ack' },
    });
    const stale = rows.filter(
      (row) => row.description?.trim() === oldDefault,
    );
    if (stale.length === 0) return;
    for (const row of stale) row.description = next;
    await this.definitionRepo.save(stale);
    this.logger.log(`Đã cập nhật mô tả TC5 cho ${stale.length} tiêu chí`);
  }

  /**
   * Cập nhật mô tả TC3/TC4 từ luật hardcode "≥1 khách" sang luật cấu hình
   * binary số khách / ratio %. Chỉ đè đúng mô tả mặc định cũ; admin đã sửa
   * tay thì giữ nguyên.
   */
  private async upgradeVisitContactDescriptions() {
    const rows = await this.definitionRepo.find({
      where: [{ metric: 'movement_report' }, { metric: 'monthly_contact' }],
    });
    const next = new Map(
      DEFAULT_KPI_DEFINITIONS.map((definition) => [
        definition.metric,
        definition.description!,
      ]),
    );
    const stale = rows.filter((row) => {
      const text = row.description?.trim() ?? '';
      if (row.metric === 'movement_report') {
        return text.includes('có ít nhất một lịch hẹn');
      }
      return (
        text.includes('tháng đạt khi có ≥1 tin nhắn') ||
        text.includes('có ≥1 tin nhắn từ sale tới khách')
      );
    });
    if (stale.length === 0) return;
    for (const row of stale) {
      row.description = next.get(row.metric) ?? row.description;
    }
    await this.definitionRepo.save(stale);
    this.logger.log(
      `Đã cập nhật mô tả TC3/TC4 cho ${stale.length} tiêu chí`,
    );
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
    const lockedMetric = SYSTEM_METRIC_BY_KEY[dto.key];
    if (lockedMetric && dto.metric !== lockedMetric) {
      throw new BadRequestException(
        `Tiêu chí hệ thống "${dto.key}" phải dùng metric "${lockedMetric}", không phải "${dto.metric}".`,
      );
    }
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
    const lockedMetric = SYSTEM_METRIC_BY_KEY[definition.key];
    if (lockedMetric && dto.metric && dto.metric !== lockedMetric) {
      throw new BadRequestException(
        `Tiêu chí "${definition.key}" là tiêu chí hệ thống — phải dùng metric "${lockedMetric}", không được đổi sang "${dto.metric}".`,
      );
    }

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
