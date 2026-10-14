import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../system_config/system_config.entity';
import { employeeCodeOfLabel } from './nkm-label';

/**
 * Client gọi 3 API NKM do lead cấp — nguồn chân lý của tiêu chí doanh số
 * (thiết kế THIET-KE-DOANH-SO-API-NKM.md §2).
 *
 *   1. GET get-doanhthu-theo-doitac  — doanh thu theo khách/sale, lọc được
 *      theo khoảng ngày + `slpCode` (doanh thu của SALE, không trùng khi khách
 *      do nhiều sale cùng quản lý).
 *   2. GET get-doanhso-quy-truhangtra — chỉ tiêu + thực tế theo quý của cả năm
 *      tài chính (chỉ nhận `year`, không có from/to/quarter).
 *   3. GET GetListBP                  — tra mã khách ↔ mã đối tác (MaCC).
 *
 * Toàn bộ đầu cuối và `access_scarest`, cache, `grpId` đặt trong `system_config`
 * (section `kpi`) nên đổi môi trường không phải sửa code — thiếu dòng cấu hình
 * thì lấy từ biến môi trường rồi tới mặc định của thiết kế.
 *
 * Cùng quy ước với `ZaloPythonApiClient`: gọi qua `fetch`, có timeout, lỗi mạng
 * → ServiceUnavailableException kèm nguyên nhân để job ghi log rõ ràng.
 */

/** Một dòng doanh thu của API khách — đã chuẩn hoá số. */
export interface NkmRevenueRow {
  cardCode: string;
  cardName: string | null;
  /** Số phiếu trong khoảng đã gọi. */
  quantity: number;
  /** CHƯA VAT — cột dùng tính doanh số KPI. */
  lineTotal: number;
  lineVat: number;
  gTotal: number;
  grossProfit: number;
}

/** Chỉ tiêu + thực tế của MỘT sale theo cả năm tài chính (4 quý). */
export interface NkmQuarterRow {
  /** `NKDS12-NGUYỄN HỮU THỊNH` — nối về sale qua `nkm_sale_map.sale_label`. */
  saleLabel: string;
  departmentName: string | null;
  target: number;
  /** [Q1, Q2, Q3, Q4] — Q1 = tháng 4-6. `null` khi API không trả tỉ lệ. */
  targetByQuarter: number[];
  actualByQuarter: number[];
  ratioByQuarter: (number | null)[];
}

/** Thông tin đối tác tra được từ GetListBP. */
export interface NkmBusinessPartner {
  maKh: string;
  maCc: string;
  tenKh: string | null;
  diaChi: string | null;
}

/** Timeout mỗi request — API NKM hay trả nhiều dòng nên để dài hơn API Python. */
const REQUEST_TIMEOUT_MS = 60000;

const CONFIG_SECTION = 'kpi';

const DEFAULTS = {
  revenueUrl: 'http://192.168.245.188:3701/get-doanhthu-theo-doitac',
  quarterUrl: 'http://192.168.245.188:3701/get-doanhso-quy-truhangtra',
  listBpUrl: 'http://192.168.117.222:8094/NKC/Web/GetListBP',
  accessScarest: 'zone_zero',
  /** API quý có cache ~6 tiếng theo lead — job chỉ tiêu không gọi lại sát nhau. */
  quarterCacheHours: 6,
  /** grpId mặc định KHÔNG dùng — chờ lead chốt mục đích (§1.4). */
  grpId: '',
} as const;

const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Giá trị số/chữ từ JSON — còn lại (null, object...) trả null. */
const text = (value: unknown): string | null => {
  if (
    typeof value !== 'string' &&
    typeof value !== 'number' &&
    typeof value !== 'boolean'
  ) {
    return null;
  }
  const str = String(value).trim();
  return str ? str : null;
};

@Injectable()
export class NkmApiClient {
  private readonly logger = new Logger(NkmApiClient.name);
  /** Cache cấu hình trong tiến trình — tránh mỗi lần gọi API lại query bảng. */
  private configs: Map<string, string> = new Map();
  private configsLoadedAt = 0;

  constructor(
    @InjectRepository(SystemConfig)
    private readonly configRepo: Repository<SystemConfig>,
  ) {}

  // ------------------------------------------------------------- cấu hình

  private async loadConfigs(): Promise<Map<string, string>> {
    // 60 giây: admin sửa config trên web thì job gần nhất tự nhận, không cần
    // khởi động lại server.
    if (Date.now() - this.configsLoadedAt < 60000) return this.configs;
    try {
      const rows = await this.configRepo.find({
        where: { section: CONFIG_SECTION },
        select: ['name', 'value'],
      });
      this.configs = new Map(
        rows.map((row) => [row.name, text(row.value) ?? '']),
      );
      this.configsLoadedAt = Date.now();
    } catch (error: any) {
      this.logger.warn(
        `Không đọc được cấu hình NKM (${error?.message}) — dùng mặc định`,
      );
    }
    return this.configs;
  }

  /** Giá trị cấu hình: system_config → biến môi trường → mặc định thiết kế. */
  private async config(
    key: string,
    envKey: string,
    fallback: string,
  ): Promise<string> {
    const configs = await this.loadConfigs();
    const fromDb = configs.get(key);
    if (fromDb !== undefined && fromDb !== '') return fromDb;
    const fromEnv = process.env[envKey];
    return fromEnv ? fromEnv.replace(/\/$/, '') : fallback;
  }

  private async accessScarest(): Promise<string> {
    const configs = await this.loadConfigs();
    return (
      configs.get('nkm_access_scarest') ||
      process.env.NKM_ACCESS_SCAREST ||
      DEFAULTS.accessScarest
    );
  }

  /**
   * `grpId` dùng khi đồng bộ — rỗng nghĩa là chưa dùng (job chỉ lọc theo sale).
   * Lead chốt mục đích thì đặt giá trị trong system_config là chạy được.
   */
  async syncGrpId(): Promise<number | null> {
    const configs = await this.loadConfigs();
    const raw = configs.get('nkm_sync_grp_id') ?? process.env.NKM_SYNC_GRP_ID;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  async quarterCacheHours(): Promise<number> {
    const configs = await this.loadConfigs();
    const parsed = Number(
      configs.get('nkm_quarter_cache_hours') ??
        process.env.NKM_QUARTER_CACHE_HOURS,
    );
    return Number.isFinite(parsed) && parsed > 0
      ? parsed
      : DEFAULTS.quarterCacheHours;
  }

  // ---------------------------------------------------------------- gọi API

  private async requestJson(url: string, label: string): Promise<any> {
    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error: any) {
      throw new ServiceUnavailableException(
        `Không kết nối được API NKM (${label}): ${error?.message}`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `API NKM ${label} trả HTTP ${res.status}`,
      );
    }
    try {
      return await res.json();
    } catch (error: any) {
      throw new ServiceUnavailableException(
        `API NKM ${label} trả dữ liệu không phải JSON: ${error?.message}`,
      );
    }
  }

  /** Danh sách dòng từ response — API trả mảng hoặc bọc trong `data`. */
  private rows(payload: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
      return payload.filter(
        (row): row is Record<string, unknown> =>
          typeof row === 'object' && row !== null,
      );
    }
    if (payload && typeof payload === 'object' && 'data' in payload) {
      const data = (payload as { data?: unknown }).data;
      if (Array.isArray(data)) return this.rows(data);
    }
    return [];
  }

  /** Đối tượng JSON của GetListBP — kiểu chưa biết nên đọc qua accessor an toàn. */
  private object(payload: unknown): Record<string, unknown> {
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  }

  /**
   * Doanh thu theo khách/sale trong khoảng ngày. `from`/`to` lấy CẢ HAI ĐẦU
   * (đã kiểm chứng: 15/09 + 16/09 = 15/09→16/09) nên **muốn 1 ngày phải gọi
   * `from = D` và `to = D`** — gọi "đầu ngày D tới đầu ngày D+1" sẽ lấy tràn 2
   * ngày.
   */
  async getRevenue(opts: {
    from: string;
    to: string;
    slpCode?: number;
    cardCode?: string;
    grpId?: number | null;
  }): Promise<NkmRevenueRow[]> {
    const params = new URLSearchParams();
    params.set('data', 'nkm');
    params.set('from', opts.from);
    params.set('to', opts.to);
    if (opts.slpCode != null) params.set('slpCode', String(opts.slpCode));
    if (opts.cardCode) params.set('cardCode', opts.cardCode);
    if (opts.grpId != null) params.set('grpId', String(opts.grpId));
    const base = await this.config(
      'nkm_revenue_url',
      'NKM_REVENUE_URL',
      DEFAULTS.revenueUrl,
    );
    const payload: unknown = await this.requestJson(
      `${base}?${params.toString()}`,
      'doanh thu theo đối tác',
    );
    return this.rows(payload).map((row) => ({
      cardCode: text(row.CardCode) ?? '',
      cardName: text(row.CardName),
      quantity: num(row.Quantity),
      lineTotal: num(row.LineTotal),
      lineVat: num(row.LineVAT ?? row.LineVat),
      gTotal: num(row.GTotal),
      grossProfit: num(row.GrssProfit ?? row.GrossProfit),
    }));
  }

  /**
   * Chỉ tiêu + thực tế theo quý của CẢ NĂM TÀI CHÍNH. API chỉ nhận `year`
   * (không có from/to/quarter/slpname — các tham số khác bị bỏ qua, đã test),
   * trả về mỗi sale một dòng chứa đủ 4 quý nên một lần gọi là đủ cả năm.
   */
  async getQuarterTargets(year: number): Promise<NkmQuarterRow[]> {
    const base = await this.config(
      'nkm_quarter_url',
      'NKM_QUARTER_URL',
      DEFAULTS.quarterUrl,
    );
    const params = new URLSearchParams();
    params.set('data', 'nkm');
    params.set('access_scarest', await this.accessScarest());
    params.set('year', String(year));
    const payload: unknown = await this.requestJson(
      `${base}?${params.toString()}`,
      `chỉ tiêu quý ${year}`,
    );
    return this.rows(payload)
      .map((row) => ({
        saleLabel: text(row.SlpName) ?? '',
        departmentName: text(row.Department),
        target: num(row.Target),
        targetByQuarter: [1, 2, 3, 4].map((q) => num(row[`TargetQ${q}`])),
        actualByQuarter: [1, 2, 3, 4].map((q) => num(row[`DatThucTeQ${q}`])),
        ratioByQuarter: [1, 2, 3, 4].map((q) =>
          row[`TiLeQ${q}`] == null ? null : num(row[`TiLeQ${q}`]),
        ),
      }))
      .filter((row) => row.saleLabel !== '');
  }

  /**
   * Tra mã khách ↔ mã đối tác SAP (MaCC). API chỉ nhận `makhfull`, không tra
   * được theo sale. `Salephutrach` trong kết quả là ID nội bộ của NKM nên bỏ
   * qua — đó không phải người dùng trong hệ mình.
   */
  async getBusinessPartner(maKh: string): Promise<NkmBusinessPartner | null> {
    if (!maKh) return null;
    const base = await this.config(
      'nkm_list_bp_url',
      'NKM_LIST_BP_URL',
      DEFAULTS.listBpUrl,
    );
    const params = new URLSearchParams({ makhfull: maKh });
    const payload = this.object(
      await this.requestJson(`${base}?${params.toString()}`, 'tra mã đối tác'),
    );
    const maCc = text(payload.MaCC);
    if (!maCc) return null;
    return {
      maKh: text(payload.MaKH) ?? maKh,
      maCc,
      tenKh: text(payload.TenKH),
      diaChi: text(payload.DiaChi),
    };
  }

  /**
   * Mã nhân viên trong `sale_label` của API quý: `NKDS12-ĐÀO CẨM TÚ` → `NKDS12`.
   * Cùng một quy tắc với service nạp bảng tra nên 2 bên không bao giờ lệch mã.
   */
  static employeeCodeOf(saleLabel: string): string {
    return employeeCodeOfLabel(saleLabel);
  }
}
