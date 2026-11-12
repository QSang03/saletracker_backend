import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { Notification } from '../notifications/notification.entity';
import { Department } from '../departments/department.entity';
import { Debt } from '../debts/debt.entity';
import { CustomerSuggestionsCronjob } from './customer-kpi-suggestions.cronjob';
import { Customer } from './customer.entity';
import { CustomerAssignment } from './customer-assignment.entity';
import { CustomerZalo } from './customer-zalo.entity';
import { CustomerZaloScanResult } from './customer-zalo-scan-result.entity';
import { ZaloPythonApiClient } from './zalo-python-api.client';
import { CustomerActivityDaily } from './customer-activity-daily.entity';
import {
  CustomerAppointment,
  CustomerAppointmentSyncState,
} from './customer-appointment.entity';
import { CustomerAppointmentsService } from './customer-appointments.service';
import { CustomerAppointmentsController } from './customer-appointments.controller';
import { CustomerResponseDaily } from './customer-response-daily.entity';
import { KpiDefinition } from './kpi-definition.entity';
import { KpiTarget } from './kpi-target.entity';
import { KpiCriterionOverride } from './kpi-criterion-overrides.entity';
import { CustomerImportSession } from './customer-import-session.entity';
import { CustomerImportChange } from './customer-import-change.entity';
import { CustomerImportBackup } from './customer-import-backup.entity';
import { ApprovalRequest } from './approval-request.entity';
import { ApprovalRequestCustomerItem } from './approval-request-customer-item.entity';
import { ApprovalRequestTargetItem } from './approval-request-target-item.entity';
import { NkmSaleMap } from './nkm-sale-map.entity';
import { NkmSyncLog } from './nkm-sync-log.entity';
import { NkmGroupMap } from './nkm-group-map.entity';
import { CustomerRevenueDaily } from './customer-revenue-daily.entity';
import { SaleRevenueTarget } from './sale-revenue-target.entity';
import { DeptRevenueTarget } from './dept-revenue-target.entity';
import { KpiMonthlyResult } from './kpi-monthly-result.entity';
import { KpiQuarterlySettlement } from './kpi-quarterly-settlement.entity';
import { KpiSlaInterval } from './kpi-sla-interval.entity';
import { KpiSlaViolation } from './kpi-sla-violation.entity';
import { KpiAppeal } from './kpi-appeal.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import { OrderDetail } from '../order-details/order-detail.entity';
import { Order } from '../orders/order.entity';
import { CustomersController } from './customers.controller';
import { CustomerAssignmentsController } from './customer-assignments.controller';
import { CustomerKpiReportsController } from './customer-kpi-reports.controller';
import { KpiAppealsController } from './kpi-appeals.controller';
import { CustomerKpiDefinitionsController } from './customer-kpi-definitions.controller';
import { CustomerKpiTargetsController } from './customer-kpi-targets.controller';
import { ApprovalRequestsController } from './approval-requests.controller';
import { KpiCriterionOverridesController } from './kpi-criterion-overrides.controller';
import { NkmMappingController } from './nkm-mapping.controller';
import { CustomersService } from './customers.service';
import { CustomerAssignmentsService } from './customer-assignments.service';
import { CustomerKpiScoringService } from './customer-kpi-scoring.service';
import { CustomerKpiReportsService } from './customer-kpi-reports.service';
import { CustomerKpiDefinitionsService } from './customer-kpi-definitions.service';
import { CustomerKpiTargetsService } from './customer-kpi-targets.service';
import { ApprovalRequestsService } from './approval-requests.service';
import { KpiCriterionOverridesService } from './kpi-criterion-overrides.service';
import { NkmApiClient } from './nkm-api.client';
import { NkmMappingService } from './nkm-mapping.service';
import { NkmSyncService } from './nkm-sync.service';
import { NkmSyncCronjob } from './nkm-sync.cronjob';
import { KpiScopeService } from './kpi-scope.service';
import { WorkingDaysService } from './working-days.service';
import { KpiSaleDirectoryService } from './kpi-sale-directory.service';
import { KpiCoverageService } from './kpi-coverage.service';
import { KpiCoverageCronjob } from './kpi-coverage.cronjob';
import { KpiCareFunnelService } from './kpi-care-funnel.service';
import { KpiSlaService } from './kpi-sla.service';
import { KpiAppealService } from './kpi-appeal.service';
import { KpiCustomerInteractionService } from './kpi-customer-interaction.service';

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
      CustomerZaloScanResult,
      CustomerActivityDaily,
      CustomerAppointment,
      CustomerAppointmentSyncState,
      CustomerResponseDaily,
      KpiDefinition,
      KpiTarget,
      KpiCriterionOverride,
      CustomerImportSession,
      CustomerImportChange,
      CustomerImportBackup,
      ApprovalRequest,
      ApprovalRequestCustomerItem,
      ApprovalRequestTargetItem,
      // Tiêu chí doanh số theo API NKM (thiết kế THIET-KE-DOANH-SO-API-NKM.md)
      NkmSaleMap,
      NkmSyncLog,
      NkmGroupMap,
      CustomerRevenueDaily,
      SaleRevenueTarget,
      DeptRevenueTarget,
      KpiMonthlyResult,
      KpiQuarterlySettlement,
      KpiSlaInterval,
      KpiSlaViolation,
      KpiAppeal,
      SystemConfig,
      // Đơn Zalo (Sale Tracker) — CHỈ ĐỌC cho tiêu chí 6 "Gợi ý đơn hàng".
      // Entity đã có metadata từ OrderModule/OrderDetailModule; khai báo lại ở
      // đây để module khách hàng tự inject repository, không import chéo module.
      OrderDetail,
      Order,
      User,
      Department,
      Debt,
      Notification,
    ]),
  ],
  controllers: [
    CustomerAppointmentsController,
    CustomersController,
    CustomerAssignmentsController,
    CustomerKpiReportsController,
    KpiAppealsController,
    CustomerKpiDefinitionsController,
    CustomerKpiTargetsController,
    ApprovalRequestsController,
    KpiCriterionOverridesController,
    NkmMappingController,
  ],
  providers: [
    CustomerAppointmentsService,
    ZaloPythonApiClient,
    CustomersService,
    CustomerAssignmentsService,
    CustomerKpiScoringService,
    CustomerKpiReportsService,
    CustomerKpiDefinitionsService,
    CustomerKpiTargetsService,
    ApprovalRequestsService,
    KpiCriterionOverridesService,
    CustomerSuggestionsCronjob,
    NkmApiClient,
    NkmMappingService,
    NkmSyncService,
    NkmSyncCronjob,
    KpiScopeService,
    WorkingDaysService,
    KpiSaleDirectoryService,
    KpiCoverageService,
    KpiCoverageCronjob,
    KpiCareFunnelService,
    KpiSlaService,
    KpiAppealService,
    KpiCustomerInteractionService,
  ],
})
export class CustomerKpiModule {}
