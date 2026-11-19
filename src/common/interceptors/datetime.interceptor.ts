import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const FIELDS_SET = new Set([
  'createdAt',
  'updatedAt',
  'lastLogin',
  'lastOnlineAt',
  'deletedAt',
  'statistic_date',
  'issue_date',
  'due_date',
  'pay_later',
  'original_created_at',
  'original_updated_at',
  'created_at',
  'updated_at',
  'send_at',
  'first_remind_at',
  'second_remind_at',
  'added_at',
  'sent_at',
  'customer_replied_at',
  'staff_handled_at',
  'schedule_start_date',
  'schedule_end_date',
  'start_date',
  'end_date',
  'start_time',
  'end_time',
  'occurred_at',
]);

// Bỏ qua các key chứa dữ liệu bảng thô cực lớn (như rawData của Excel, metadata cột)
// giúp giữ nguyên dữ liệu gốc và không tốn RAM duyệt vô ích hàng chục nghìn ô dữ liệu
const SKIP_KEYS_SET = new Set([
  'rawData',
  'raw_data',
  'excelColumns',
  'mappedColumns',
  'allExcelColumns',
  'previewRows',
  'buffer',
  'tokens',
]);

/**
 * Định dạng ngày giờ trực tiếp tại chỗ (In-Place Mutation).
 * Không clone hay tạo mới đối tượng {} giúp triệt tiêu hoàn toàn áp lực RAM (OOM).
 */
function convertDatesInPlace(
  obj: any,
  depth = 0,
  seen = new WeakSet<any>(),
): any {
  // Bỏ qua nếu là null, undefined hoặc kiểu nguyên thủy
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  // Khống chế độ sâu tối đa 6 cấp (quá đủ cho REST API, chống đệ quy quá sâu)
  if (depth > 6) {
    return obj;
  }

  // Giữ nguyên Date nếu không nằm trong danh sách cần đổi
  if (obj instanceof Date) {
    return obj;
  }

  // Bỏ qua Buffer/ArrayBuffer/Uint8Array/Streams để tránh corrupt dữ liệu nhị phân
  if (
    (typeof Buffer !== 'undefined' && Buffer.isBuffer(obj)) ||
    obj instanceof ArrayBuffer ||
    obj instanceof Uint8Array ||
    typeof obj.pipe === 'function'
  ) {
    return obj;
  }

  // Chống đệ quy vô hạn khi gặp tham chiếu tròn (circular reference)
  if (seen.has(obj)) {
    return obj;
  }
  seen.add(obj);

  // Xử lý Mảng: duyệt và sửa in-place từng phần tử
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      convertDatesInPlace(obj[i], depth + 1, seen);
    }
    return obj;
  }

  // Xử lý Đối tượng: gán đè trực tiếp lên thuộc tính, KHÔNG tạo object mới
  for (const key of Object.keys(obj)) {
    // Bỏ qua các key dữ liệu thô lớn
    if (SKIP_KEYS_SET.has(key)) {
      continue;
    }

    const value = obj[key];
    if (value === null || value === undefined) {
      continue;
    }

    if (
      FIELDS_SET.has(key) &&
      (value instanceof Date ||
        (typeof value === 'string' &&
          value.length >= 10 &&
          !isNaN(Date.parse(value))))
    ) {
      obj[key] = dayjs(value)
        .tz('Asia/Ho_Chi_Minh')
        .format('YYYY-MM-DD HH:mm:ss');
    } else if (typeof value === 'object') {
      convertDatesInPlace(value, depth + 1, seen);
    }
  }

  return obj;
}

@Injectable()
export class DatetimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Chỉ áp dụng cho các HTTP REST request thông thường, bỏ qua WebSocket / RPC
    if (context.getType() !== 'http') {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        // Đảm bảo không return undefined
        if (data === undefined || data === null) {
          return data === undefined ? {} : null;
        }

        return convertDatesInPlace(data);
      }),
    );
  }
}
