import { BadRequestException } from '@nestjs/common';
import { OrderDetailStatus } from './order-detail.entity';
import {
  assertStatusTransition,
  MANUAL_BULK_TARGET_STATUSES,
  normalizeOrderStatus,
  normalizeOrderStatusOrNull,
  OrderStatusValue,
} from './order-status.constants';

export type BulkStatusSkipCode =
  | 'invalid_transition'
  | 'not_found_or_forbidden'
  | 'hidden_order'
  | 'concurrent_change';

export interface BulkStatusSkipped {
  id: number;
  code: BulkStatusSkipCode;
  reason: string;
}

export interface BulkStatusRow {
  id: number;
  status: string;
}

export interface BulkStatusPlanItem {
  id: number;
  /** Status đã chuẩn hóa (legacy pending/confirmed được map). */
  fromStatus: OrderStatusValue;
  /** Giá trị status thật trong DB, dùng cho WHERE điều kiện chống race. */
  dbStatus: string;
}

export interface BulkStatusTransitionPlan {
  toStatus: OrderStatusValue;
  updatable: BulkStatusPlanItem[];
  unchangedIds: number[];
  skipped: BulkStatusSkipped[];
}

export interface BulkStatusUpdateResult {
  requested: number;
  target_status: string;
  updated: number;
  unchanged: number;
  updated_ids: number[];
  unchanged_ids: number[];
  skipped: BulkStatusSkipped[];
}

/**
 * Lập kế hoạch đổi status cho từng row, không chạm DB.
 * - Dòng cùng status: no-op (unchanged).
 * - Dòng sai transition: skipped `invalid_transition`.
 * - Target care-only hoặc ngoài danh sách cho phép: ném 400 cho cả request.
 */
export function planBulkStatusTransition(
  rows: BulkStatusRow[],
  target: string,
): BulkStatusTransitionPlan {
  const toStatus = normalizeOrderStatus(target);

  if (
    toStatus === OrderDetailStatus.CARED ||
    toStatus === OrderDetailStatus.DEMAND_CARED
  ) {
    const label =
      toStatus === OrderDetailStatus.CARED
        ? 'Đã thăm hỏi'
        : 'Đã thăm hỏi nhu cầu';
    throw new BadRequestException(
      `Trạng thái "${label}" chỉ được gán qua chức năng Chăm sóc đơn hàng`,
    );
  }

  if (!MANUAL_BULK_TARGET_STATUSES.includes(toStatus)) {
    throw new BadRequestException(
      `Trạng thái đích không hợp lệ: ${target}. Chỉ hỗ trợ ${MANUAL_BULK_TARGET_STATUSES.join(', ')}`,
    );
  }

  const updatable: BulkStatusPlanItem[] = [];
  const unchangedIds: number[] = [];
  const skipped: BulkStatusSkipped[] = [];

  for (const row of rows) {
    const id = Number(row.id);
    const currentStatus = normalizeOrderStatusOrNull(row.status);

    if (!currentStatus) {
      skipped.push({
        id,
        code: 'invalid_transition',
        reason: `Trạng thái hiện tại không hợp lệ: ${row.status}`,
      });
      continue;
    }

    if (currentStatus === toStatus) {
      unchangedIds.push(id);
      continue;
    }

    try {
      assertStatusTransition(currentStatus, toStatus, { allowCared: false });
      updatable.push({
        id,
        fromStatus: currentStatus,
        dbStatus: String(row.status),
      });
    } catch (error: any) {
      skipped.push({
        id,
        code: 'invalid_transition',
        reason: error?.message || 'Chuyển trạng thái không hợp lệ',
      });
    }
  }

  return { toStatus, updatable, unchangedIds, skipped };
}
