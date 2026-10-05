import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Customer } from './customer.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerZalo } from './customer-zalo.entity';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import { CustomerResponseDaily } from './customer-response-daily.entity';
import { KpiDefinition } from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import { CustomerImportSession } from './customer-import-session.entity';
import { CustomerImportChange } from './customer-import-change.entity';
import { CustomerImportBackup } from './customer-import-backup.entity';
import { ApprovalRequest } from './approval-request.entity';
import { ApprovalRequestCustomerItem } from './approval-request-customer-item.entity';
import { ApprovalRequestTargetItem } from './approval-request-target-item.entity';
import { CustomersController } from './customers.controller';
import { CustomerAssignmentsController } from './customer-assignments.controller';
import { CustomerKpiReportsController } from './customer-kpi-reports.controller';
import { CustomerKpiDefinitionsController } from './customer-kpi-definitions.controller';
import { CustomerKpiTargetsController } from './customer-kpi-targets.controller';
import { ApprovalRequestsController } from './approval-requests.controller';
import { CustomersService } from './customers.service';
import { CustomerAssignmentsService } from './customer-assignments.service';
import { CustomerKpiReportsService } from './customer-kpi-reports.service';
import { CustomerKpiDefinitionsService } from './customer-kpi-definitions.service';
import { CustomerKpiTargetsService } from './customer-kpi-targets.service';
import { ApprovalRequestsService } from './approval-requests.service';

/**
 * Module khách hàng & KPI (thiết kế: BAO-CAO-KPI-KHACH-HANG.md).
 *
 * TypeORM chạy synchronize: true — khai báo entity ở đây là bảng được tạo tự
 * động trong MySQL nguyenkim_autozalo_v2, không cần migration.
 *
 * Phạm vi xem báo cáo do scopeUserIds/resolveCustomerScope của module tự quản
 * theo vai trò khach-hang — KHÔNG dùng resolveScope của sale-response vì trang
 * đó yêu cầu role 'analysis' (luật riêng của báo cáo dữ liệu Zalo).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Customer,
      CustomerAssignment,
      CustomerZalo,
      CustomerActivityDaily,
      CustomerResponseDaily,
      KpiDefinition,
      KpiTarget,
      CustomerImportSession,
      CustomerImportChange,
      CustomerImportBackup,
      ApprovalRequest,
      ApprovalRequestCustomerItem,
      ApprovalRequestTargetItem,
      User,
    ]),
  ],
  controllers: [
    CustomersController,
    CustomerAssignmentsController,
    CustomerKpiReportsController,
    CustomerKpiDefinitionsController,
    CustomerKpiTargetsController,
    ApprovalRequestsController,
  ],
  providers: [
    CustomersService,
    CustomerAssignmentsService,
    CustomerKpiReportsService,
    CustomerKpiDefinitionsService,
    CustomerKpiTargetsService,
    ApprovalRequestsService,
  ],
})
export class CustomerKpiModule {}
