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

const FIELDS = [
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
];

function convertDates(obj: any, seen = new WeakSet<any>()): any {
  // Handle undefined/null case
  if (obj === undefined || obj === null) {
    return obj === undefined ? {} : null;
  }
  
  // Skip Buffer/ArrayBuffer/Uint8Array/Streams to avoid corrupting binary responses
  if (
    typeof Buffer !== 'undefined' && Buffer.isBuffer(obj) ||
    obj instanceof ArrayBuffer ||
    obj instanceof Uint8Array ||
    (typeof obj === 'object' && typeof (obj as any).pipe === 'function')
  ) {
    return obj;
  }

  // Prevent infinite recursion on circular structures
  if (typeof obj === 'object') {
    if (seen.has(obj)) {
      return obj;
    }
    seen.add(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => convertDates(item, seen));
  }
  
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (
        FIELDS.includes(key) &&
        (value instanceof Date ||
          (typeof value === 'string' && !isNaN(Date.parse(value))))
      ) {
        result[key] = dayjs(value)
          .tz('Asia/Ho_Chi_Minh')
          .format('YYYY-MM-DD HH:mm:ss');
      } else if (typeof value === 'object' && value !== null) {
        result[key] = convertDates(value, seen);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
  return obj;
}

@Injectable()
export class DatetimeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    return next.handle().pipe(
      map((data) => {
        // Log để debug
        if (data === undefined || data === null) {
          console.warn(`[DatetimeInterceptor] Undefined/null response for ${request.method} ${request.url}`);
        }
        
        // Fix: ensure không bao giờ return undefined
        if (data === undefined) {
          return {};
        }
        
        return convertDates(data);
      })
    );
  }
}
