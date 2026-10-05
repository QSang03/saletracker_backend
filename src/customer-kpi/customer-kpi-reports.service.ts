import { Injectable, NotImplementedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomersService } from './customers.service';

/**
 * Báo cáo KPI. Engine chấm điểm (đọc kpi_definitions + customer_activity_daily
 * rồi tính lúc đọc) thuộc Mục 4 — hôm nay chỉ mở chi tiết khách hàng, vốn là
 * số liệu đọc thẳng từ bảng tổng hợp.
 */
@Injectable()
export class CustomerKpiReportsService {
  constructor(
    @InjectRepository(CustomerAssignment)
    private readonly assignmentRepo: Repository<CustomerAssignment>,
    private readonly customersService: CustomersService,
  ) {}

  async getCustomerDetail(assignmentId: number, from: string, to: string, user: any) {
    // findOne đã kiểm tra tồn tại + phạm vi
    const detail = await this.customersService.findOne(assignmentId, user);
    const daily = await this.customersService.getResponseDaily(
      assignmentId,
      from,
      to,
      user,
    );

    return {
      customer: detail.customer,
      assignment: {
        assignmentId: detail.assignmentId,
        departmentSlug: detail.departmentSlug,
        customerTier: detail.customerTier,
        sale: detail.sale,
      },
      zaloAccounts: detail.zaloAccounts,
      ...daily,
    };
  }

  async overview(query: any, user: any) {
    void query;
    void user;
    throw new NotImplementedException(
      'Engine chấm điểm KPI (tính lúc đọc từ kpi_definitions + customer_activity_daily) sẽ xây ở Mục 4',
    );
  }

  async bySale(query: any, user: any) {
    void query;
    void user;
    throw new NotImplementedException(
      'Bảng KH × tiêu chí sẽ xây ở Mục 4, cùng engine chấm điểm',
    );
  }

  async suggestions(saleId: number | undefined, user: any) {
    void saleId;
    void user;
    throw new NotImplementedException(
      'Gợi ý thực hiện (Mục 4 — công việc con 5) sẽ xây ở Mục 4',
    );
  }

  /** Xuất báo cáo tổng hợp ra file Excel phục vụ tính thưởng (Mục 4 — cv 6). */
  async exportReport(saleId: number | undefined, from: string, to: string, user: any) {
    void saleId;
    void from;
    void to;
    void user;
    throw new NotImplementedException(
      'Xuất báo cáo ra file Excel sẽ xây ở Mục 4 (công việc con 6)',
    );
  }
}
