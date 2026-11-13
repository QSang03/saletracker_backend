import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from './customer.entity';

/**
 * Tra tên khách để hiển thị trên báo cáo KPI.
 *
 * `customers.customer_name` chỉ có một phần (đa số trống); tên thật thường nằm
 * ở `customer_zalo.matched_name` do Python đồng bộ. Vì vậy ưu tiên tên chính
 * thức, fallback tên Zalo đầu tiên đang active.
 */
@Injectable()
export class KpiCustomerNamesService {
  constructor(
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
  ) {}

  async load(customerCodes: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (customerCodes.length === 0) return result;

    const placeholders = customerCodes.map(() => '?').join(',');
    const rows: Array<{
      customer_code: string;
      customer_name: string | null;
      matched_name: string | null;
    }> = await this.customerRepo.manager.query(
      `SELECT c.customer_code, c.customer_name, z.matched_name
       FROM customers c
       LEFT JOIN customer_assignments a ON a.customer_id = c.id
       LEFT JOIN customer_zalo z ON z.assignment_id = a.id AND z.is_active = 1
       WHERE c.customer_code IN (${placeholders})
       ORDER BY z.id ASC`,
      customerCodes,
    );
    for (const row of rows) {
      if (row.customer_name) {
        result.set(row.customer_code, row.customer_name);
      } else if (!result.has(row.customer_code) && row.matched_name) {
        result.set(row.customer_code, row.matched_name);
      }
    }
    return result;
  }
}
