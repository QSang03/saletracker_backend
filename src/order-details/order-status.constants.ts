import { BadRequestException } from '@nestjs/common';
import { OrderDetailStatus } from './order-detail.entity';

export type OrderStatusValue =
  | OrderDetailStatus.QUOTED
  | OrderDetailStatus.CARED
  | OrderDetailStatus.COMPLETED
  | OrderDetailStatus.DEMAND
  | OrderDetailStatus.REJECTED;

export const ORDER_STATUS_VALUES: OrderStatusValue[] = [
  OrderDetailStatus.QUOTED,
  OrderDetailStatus.CARED,
  OrderDetailStatus.COMPLETED,
  OrderDetailStatus.DEMAND,
  OrderDetailStatus.REJECTED,
];

export const FINAL_ORDER_STATUSES: OrderStatusValue[] = [
  OrderDetailStatus.COMPLETED,
  OrderDetailStatus.DEMAND,
  OrderDetailStatus.REJECTED,
];

export const CARE_ELIGIBLE_STATUSES: OrderStatusValue[] = [
  OrderDetailStatus.QUOTED,
  OrderDetailStatus.CARED,
];

/**
 * Dữ liệu cũ trước migration: pending/confirmed không còn trong DB.
 * Map ở biên nhận input để client/FE cũ không làm sập luồng.
 */
const LEGACY_STATUS_MAP: Record<string, OrderStatusValue> = {
  pending: OrderDetailStatus.QUOTED,
  confirmed: OrderDetailStatus.COMPLETED,
};

const TRANSITIONS: Record<OrderStatusValue, OrderStatusValue[]> = {
  [OrderDetailStatus.QUOTED]: [
    OrderDetailStatus.COMPLETED,
    OrderDetailStatus.CARED,
    OrderDetailStatus.DEMAND,
    OrderDetailStatus.REJECTED,
  ],
  [OrderDetailStatus.CARED]: [
    OrderDetailStatus.COMPLETED,
    OrderDetailStatus.REJECTED,
    OrderDetailStatus.CARED,
  ],
  [OrderDetailStatus.COMPLETED]: [],
  [OrderDetailStatus.DEMAND]: [],
  [OrderDetailStatus.REJECTED]: [],
};

/** Trả về null nếu không phải status hợp lệ (dùng cho filter, dữ liệu cũ). */
export function normalizeOrderStatusOrNull(
  value?: string | null,
): OrderStatusValue | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;
  const mapped = LEGACY_STATUS_MAP[raw] ?? raw;
  return ORDER_STATUS_VALUES.includes(mapped as OrderStatusValue)
    ? (mapped as OrderStatusValue)
    : null;
}

/** Chuẩn hóa status bắt buộc hợp lệ; ném 400 nếu sai. */
export function normalizeOrderStatus(value?: string | null): OrderStatusValue {
  const normalized = normalizeOrderStatusOrNull(value);
  if (!normalized) {
    throw new BadRequestException(`Trạng thái đơn hàng không hợp lệ: ${value}`);
  }
  return normalized;
}

/** Chuẩn hóa CSV status filter; bỏ giá trị lạ, map pending/confirmed cũ. */
export function normalizeStatusCsv(value?: string | null): OrderStatusValue[] {
  if (!value || !value.trim()) return [];
  const result: OrderStatusValue[] = [];
  for (const item of value.split(',')) {
    const normalized = normalizeOrderStatusOrNull(item);
    if (normalized && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

export function isCareEligibleStatus(value?: string | null): boolean {
  const normalized = normalizeOrderStatusOrNull(value);
  return !!normalized && CARE_ELIGIBLE_STATUSES.includes(normalized);
}

export function isFinalOrderStatus(value?: string | null): boolean {
  const normalized = normalizeOrderStatusOrNull(value);
  return !!normalized && FINAL_ORDER_STATUSES.includes(normalized);
}

/**
 * Kiểm tra chuyển trạng thái. Trả về status đã chuẩn hóa để service ghi DB.
 * - allowCared=false (mặc định): user không được set "cared" tay; chỉ care service.
 * - Cùng status: no-op hợp lệ.
 */
export function assertStatusTransition(
  current: string,
  next: string,
  opts?: { allowCared?: boolean },
): OrderStatusValue {
  const cur = normalizeOrderStatus(current);
  const nxt = normalizeOrderStatus(next);

  if (cur === nxt) return nxt;

  // Trong giai đoạn FE cũ chưa cập nhật, có thể tạm đặt ORDER_STATUS_STRICT=false
  // để không chặn các chuyển đổi cũ. Mặc định vẫn enforce.
  if (process.env.ORDER_STATUS_STRICT === 'false' && nxt !== OrderDetailStatus.CARED) {
    return nxt;
  }

  if (nxt === OrderDetailStatus.CARED && !opts?.allowCared) {
    throw new BadRequestException(
      'Trạng thái "Đã thăm hỏi" chỉ được gán qua chức năng Chăm sóc đơn hàng',
    );
  }

  if (!TRANSITIONS[cur].includes(nxt)) {
    throw new BadRequestException(
      `Không thể chuyển trạng thái từ "${cur}" sang "${nxt}"`,
    );
  }

  return nxt;
}
