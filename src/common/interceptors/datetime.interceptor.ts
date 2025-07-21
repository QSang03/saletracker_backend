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

const FIELDS = ['createdAt', 'updatedAt', 'lastLogin', 'lastOnlineAt', 'deletedAt'];

function convertDates(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(convertDates);
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
        result[key] = convertDates(value);
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
    return next.handle().pipe(map((data) => convertDates(data)));
  }
}
