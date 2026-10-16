import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * Trigger nhật ký cho các bảng khách hàng — mọi ghi vào `customers`,
 * `customer_assignments`, `customer_zalo` (sửa tay của admin/trưởng phòng,
 * apply/rollback import, matcher Zalo của Mục 3...) đều được chép vào
 * `database_change_log` theo đúng mẫu seed-debt-trigger.service.ts.
 *
 * Khác bảng nợ: dòng phân công bị XOÁ CỨNG trong luồng sửa tay (xoá khách khi
 * hết phân công) và khi apply thay đổi "xoá" của import, nên thêm trigger
 * AFTER DELETE cho `customer_assignments`. `customers`/`customer_zalo` không có
 * luồng xoá cứng nào trong code (xoá khách là status='deleted' — UPDATE đã log).
 *
 * Trigger UPDATE chỉ log khi các field nghiệp vụ được track đổi thật
 * (whitelist) — cập nhật chạy `updated_at` thôi thì không sinh dòng log.
 * `customer_code`/`sap_code`/`zalo_contact_id` là danh tính, không track.
 *
 * Lỗi tạo trigger chỉ log ❌, KHÔNG rethrow làm sập boot: đây là cơ chế quan
 * sát, không được chặn nghiệp vụ (khác SeedDebtTriggerService có rethrow).
 */
@Injectable()
export class SeedCustomerTriggerService {
  private readonly logger = new Logger(SeedCustomerTriggerService.name);

  private static readonly TRIGGER_NAMES = [
    'customers_after_insert',
    'customers_after_update',
    'customer_assignments_after_insert',
    'customer_assignments_after_update',
    'customer_assignments_after_delete',
    'customer_zalo_after_insert',
    'customer_zalo_after_update',
    'kpi_targets_after_insert',
    'kpi_targets_after_update',
    'kpi_targets_after_delete',
    'kpi_criterion_overrides_after_insert',
    'kpi_criterion_overrides_after_update',
    'kpi_criterion_overrides_after_delete',
    'approval_requests_after_insert',
    'approval_requests_after_update',
  ];

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async seedCustomerTriggers(): Promise<void> {
    try {
      // Drop rồi tạo lại mỗi lần khởi động — SQL của trigger luôn khớp code
      const existing = await this.dataSource.query(
        `SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE()
           AND TRIGGER_NAME IN (${SeedCustomerTriggerService.TRIGGER_NAMES.map((t) => `'${t}'`).join(',')})`,
      );
      for (const row of existing) {
        await this.dataSource.query(`DROP TRIGGER \`${row.TRIGGER_NAME}\``);
      }
      // MySQL cần một nhịp sau khi drop trước khi tạo lại cùng tên
      if (existing.length > 0) {
        await new Promise((res) => setTimeout(res, 300));
      }

      await this.dataSource.query(this.customersInsertTrigger());
      await this.dataSource.query(this.customersUpdateTrigger());
      await this.dataSource.query(this.assignmentsInsertTrigger());
      await this.dataSource.query(this.assignmentsUpdateTrigger());
      await this.dataSource.query(this.assignmentsDeleteTrigger());
      await this.dataSource.query(this.zaloInsertTrigger());
      await this.dataSource.query(this.zaloUpdateTrigger());
      await this.dataSource.query(this.kpiTargetsInsertTrigger());
      await this.dataSource.query(this.kpiTargetsUpdateTrigger());
      await this.dataSource.query(this.kpiTargetsDeleteTrigger());
      await this.dataSource.query(this.overridesInsertTrigger());
      await this.dataSource.query(this.overridesUpdateTrigger());
      await this.dataSource.query(this.overridesDeleteTrigger());
      await this.dataSource.query(this.approvalRequestsInsertTrigger());
      await this.dataSource.query(this.approvalRequestsUpdateTrigger());

      this.logger.log(
        `✅ [SeedCustomerTrigger] ${SeedCustomerTriggerService.TRIGGER_NAMES.length} trigger nhật ký bảng khách hàng đã sẵn sàng`,
      );
    } catch (error) {
      this.logger.error(
        `❌ [SeedCustomerTrigger] Không tạo được trigger nhật ký khách hàng: ${error.message}`,
      );
    }
  }

  // ─── customers ────────────────────────────────────────────────────────────

  private customersInsertTrigger(): string {
    return `
      CREATE TRIGGER \`customers_after_insert\`
      AFTER INSERT ON \`customers\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'customers', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'customer_code', NEW.customer_code,
            'sap_code', NEW.sap_code,
            'customer_name', NEW.customer_name,
            'customer_role', NEW.customer_role,
            'credit_days', NEW.credit_days,
            'status', NEW.status,
            'import_session_id', NEW.import_session_id,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private customersUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`customers_after_update\`
      AFTER UPDATE ON \`customers\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- customer_name: nullable
        IF OLD.customer_name != NEW.customer_name OR (OLD.customer_name IS NULL AND NEW.customer_name IS NOT NULL) OR (OLD.customer_name IS NOT NULL AND NEW.customer_name IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_name');
        END IF;

        -- customer_role: nullable enum CHINH/PHU
        IF OLD.customer_role != NEW.customer_role OR (OLD.customer_role IS NULL AND NEW.customer_role IS NOT NULL) OR (OLD.customer_role IS NOT NULL AND NEW.customer_role IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_role');
        END IF;

        -- credit_days: nullable int — số ngày công nợ (cột HẠN MỨC), không phải tiền
        IF OLD.credit_days != NEW.credit_days OR (OLD.credit_days IS NULL AND NEW.credit_days IS NOT NULL) OR (OLD.credit_days IS NOT NULL AND NEW.credit_days IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'credit_days');
        END IF;

        -- status: active/inactive/deleted — xoá mềm cũng hiện trong nhật ký
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;

        -- NOTE: customer_code/sap_code là danh tính khách (không track),
        -- import_session_id chỉ để truy vết, created_at/updated_at là timestamp

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'customers', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'customer_code', OLD.customer_code,
              'sap_code', OLD.sap_code,
              'customer_name', OLD.customer_name,
              'customer_role', OLD.customer_role,
              'credit_days', OLD.credit_days,
              'status', OLD.status,
              'created_at', OLD.created_at,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'customer_code', NEW.customer_code,
              'sap_code', NEW.sap_code,
              'customer_name', NEW.customer_name,
              'customer_role', NEW.customer_role,
              'credit_days', NEW.credit_days,
              'status', NEW.status,
              'created_at', NEW.created_at,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // ─── customer_assignments ─────────────────────────────────────────────────

  private assignmentsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`customer_assignments_after_insert\`
      AFTER INSERT ON \`customer_assignments\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'customer_assignments', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'customer_id', NEW.customer_id,
            'sale_id', NEW.sale_id,
            'zalo_account_id', NEW.zalo_account_id,
            'department_slug', NEW.department_slug,
            'customer_tier', NEW.customer_tier,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private assignmentsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`customer_assignments_after_update\`
      AFTER UPDATE ON \`customer_assignments\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- sale_id: đổi Sale phụ trách
        IF OLD.sale_id != NEW.sale_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'sale_id');
        END IF;

        -- zalo_account_id: nullable
        IF OLD.zalo_account_id != NEW.zalo_account_id OR (OLD.zalo_account_id IS NULL AND NEW.zalo_account_id IS NOT NULL) OR (OLD.zalo_account_id IS NOT NULL AND NEW.zalo_account_id IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'zalo_account_id');
        END IF;

        -- department_slug: đổi phòng ban phụ trách
        IF OLD.department_slug != NEW.department_slug THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'department_slug');
        END IF;

        -- customer_tier: KEY/NON
        IF OLD.customer_tier != NEW.customer_tier THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_tier');
        END IF;

        -- NOTE: customer_id là danh tính phân công (không track)

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'customer_assignments', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'customer_id', OLD.customer_id,
              'sale_id', OLD.sale_id,
              'zalo_account_id', OLD.zalo_account_id,
              'department_slug', OLD.department_slug,
              'customer_tier', OLD.customer_tier,
              'created_at', OLD.created_at,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'customer_id', NEW.customer_id,
              'sale_id', NEW.sale_id,
              'zalo_account_id', NEW.zalo_account_id,
              'department_slug', NEW.department_slug,
              'customer_tier', NEW.customer_tier,
              'created_at', NEW.created_at,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  private assignmentsDeleteTrigger(): string {
    return `
      CREATE TRIGGER \`customer_assignments_after_delete\`
      AFTER DELETE ON \`customer_assignments\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`triggered_at\`
        ) VALUES (
          'customer_assignments', OLD.id, 'DELETE',
          JSON_OBJECT(
            'id', OLD.id,
            'customer_id', OLD.customer_id,
            'sale_id', OLD.sale_id,
            'zalo_account_id', OLD.zalo_account_id,
            'department_slug', OLD.department_slug,
            'customer_tier', OLD.customer_tier,
            'created_at', OLD.created_at,
            'updated_at', OLD.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  // ─── customer_zalo ────────────────────────────────────────────────────────

  private zaloInsertTrigger(): string {
    return `
      CREATE TRIGGER \`customer_zalo_after_insert\`
      AFTER INSERT ON \`customer_zalo\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'customer_zalo', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'assignment_id', NEW.assignment_id,
            'zalo_account_id', NEW.zalo_account_id,
            'zalo_contact_id', NEW.zalo_contact_id,
            'matched_name', NEW.matched_name,
            'matched_position', NEW.matched_position,
            'match_method', NEW.match_method,
            'is_active', NEW.is_active,
            'last_verified_at', NEW.last_verified_at,
            'created_at', NEW.created_at,
            'updated_at', NEW.updated_at
          ),
          NOW()
        );
      END
    `;
  }

  private zaloUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`customer_zalo_after_update\`
      AFTER UPDATE ON \`customer_zalo\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- assignment_id: gắn nhầm/đổi chỗ
        IF OLD.assignment_id != NEW.assignment_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'assignment_id');
        END IF;

        -- zalo_account_id: nullable
        IF OLD.zalo_account_id != NEW.zalo_account_id OR (OLD.zalo_account_id IS NULL AND NEW.zalo_account_id IS NOT NULL) OR (OLD.zalo_account_id IS NOT NULL AND NEW.zalo_account_id IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'zalo_account_id');
        END IF;

        -- matched_name: nullable
        IF OLD.matched_name != NEW.matched_name OR (OLD.matched_name IS NULL AND NEW.matched_name IS NOT NULL) OR (OLD.matched_name IS NOT NULL AND NEW.matched_name IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'matched_name');
        END IF;

        -- matched_position: nullable enum
        IF OLD.matched_position != NEW.matched_position OR (OLD.matched_position IS NULL AND NEW.matched_position IS NOT NULL) OR (OLD.matched_position IS NOT NULL AND NEW.matched_position IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'matched_position');
        END IF;

        -- match_method: auto_code/manual — sửa tay phải ghi đè được job
        IF OLD.match_method != NEW.match_method THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'match_method');
        END IF;

        -- is_active: bản ghi trùng đặt false
        IF OLD.is_active != NEW.is_active THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'is_active');
        END IF;

        -- NOTE: zalo_contact_id là danh tính liên hệ (không track);
        -- last_verified_at là timestamp máy chạy job, không track để job xác
        -- thực lại mỗi 5 phút không làm ngập nhật ký

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'customer_zalo', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'assignment_id', OLD.assignment_id,
              'zalo_account_id', OLD.zalo_account_id,
              'zalo_contact_id', OLD.zalo_contact_id,
              'matched_name', OLD.matched_name,
              'matched_position', OLD.matched_position,
              'match_method', OLD.match_method,
              'is_active', OLD.is_active,
              'last_verified_at', OLD.last_verified_at,
              'created_at', OLD.created_at,
              'updated_at', OLD.updated_at
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'assignment_id', NEW.assignment_id,
              'zalo_account_id', NEW.zalo_account_id,
              'zalo_contact_id', NEW.zalo_contact_id,
              'matched_name', NEW.matched_name,
              'matched_position', NEW.matched_position,
              'match_method', NEW.match_method,
              'is_active', NEW.is_active,
              'last_verified_at', NEW.last_verified_at,
              'created_at', NEW.created_at,
              'updated_at', NEW.updated_at
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  // ─── kpi_targets ──────────────────────────────────────────────────────────

  private kpiTargetsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_targets_after_insert\`
      AFTER INSERT ON \`kpi_targets\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'kpi_targets', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'criterion_key', NEW.criterion_key,
            'period_month', NEW.period_month,
            'sale_id', NEW.sale_id,
            'customer_id', NEW.customer_id,
            'target_value', NEW.target_value,
            'created_by', NEW.created_by,
            'created_at', NEW.created_at
          ),
          NOW()
        );
      END
    `;
  }

  private kpiTargetsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_targets_after_update\`
      AFTER UPDATE ON \`kpi_targets\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- target_value: giá trị chỉ tiêu (upsert gán lại cũng phải hiện)
        IF OLD.target_value != NEW.target_value THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'target_value');
        END IF;

        -- sale_id: đổi người nhận chỉ tiêu
        IF OLD.sale_id != NEW.sale_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'sale_id');
        END IF;

        -- customer_id: đổi mức chỉ tiêu (cả danh sách <-> từng khách)
        IF OLD.customer_id != NEW.customer_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_id');
        END IF;

        -- period_month: đổi tháng áp dụng
        IF OLD.period_month != NEW.period_month THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'period_month');
        END IF;

        -- NOTE: criterion_key là danh tính tiêu chí, created_by không đổi — không track

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'kpi_targets', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'criterion_key', OLD.criterion_key,
              'period_month', OLD.period_month,
              'sale_id', OLD.sale_id,
              'customer_id', OLD.customer_id,
              'target_value', OLD.target_value,
              'created_by', OLD.created_by
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'criterion_key', NEW.criterion_key,
              'period_month', NEW.period_month,
              'sale_id', NEW.sale_id,
              'customer_id', NEW.customer_id,
              'target_value', NEW.target_value,
              'created_by', NEW.created_by
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  private kpiTargetsDeleteTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_targets_after_delete\`
      AFTER DELETE ON \`kpi_targets\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`triggered_at\`
        ) VALUES (
          'kpi_targets', OLD.id, 'DELETE',
          JSON_OBJECT(
            'id', OLD.id,
            'criterion_key', OLD.criterion_key,
            'period_month', OLD.period_month,
            'sale_id', OLD.sale_id,
            'customer_id', OLD.customer_id,
            'target_value', OLD.target_value,
            'created_by', OLD.created_by
          ),
          NOW()
        );
      END
    `;
  }

  // ─── kpi_criterion_overrides ─────────────────────────────────────────────

  private overridesInsertTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_criterion_overrides_after_insert\`
      AFTER INSERT ON \`kpi_criterion_overrides\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'kpi_criterion_overrides', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'criterion_key', NEW.criterion_key,
            'period_month', NEW.period_month,
            'sale_id', NEW.sale_id,
            'customer_id', NEW.customer_id,
            'forced_status', NEW.forced_status,
            'reason', NEW.reason,
            'created_by', NEW.created_by,
            'created_at', NEW.created_at
          ),
          NOW()
        );
      END
    `;
  }

  private overridesUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_criterion_overrides_after_update\`
      AFTER UPDATE ON \`kpi_criterion_overrides\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- sale_id: đổi người bị ghi đè
        IF OLD.sale_id != NEW.sale_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'sale_id');
        END IF;

        -- customer_id: đổi mức ghi đè (cả danh sách <-> từng khách)
        IF OLD.customer_id != NEW.customer_id THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'customer_id');
        END IF;

        -- period_month: đổi tháng áp dụng
        IF OLD.period_month != NEW.period_month THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'period_month');
        END IF;

        -- reason: lý do đổi (upsert của FE ghi lại lý do mới)
        IF NOT (OLD.reason <=> NEW.reason) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'reason');
        END IF;

        -- created_by: đổi người ghi đè
        IF NOT (OLD.created_by <=> NEW.created_by) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'created_by');
        END IF;

        -- NOTE: criterion_key là danh tính tiêu chí, forced_status chỉ có 'fail' — không track

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'kpi_criterion_overrides', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'criterion_key', OLD.criterion_key,
              'period_month', OLD.period_month,
              'sale_id', OLD.sale_id,
              'customer_id', OLD.customer_id,
              'reason', OLD.reason,
              'created_by', OLD.created_by
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'criterion_key', NEW.criterion_key,
              'period_month', NEW.period_month,
              'sale_id', NEW.sale_id,
              'customer_id', NEW.customer_id,
              'reason', NEW.reason,
              'created_by', NEW.created_by
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }

  private overridesDeleteTrigger(): string {
    return `
      CREATE TRIGGER \`kpi_criterion_overrides_after_delete\`
      AFTER DELETE ON \`kpi_criterion_overrides\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`triggered_at\`
        ) VALUES (
          'kpi_criterion_overrides', OLD.id, 'DELETE',
          JSON_OBJECT(
            'id', OLD.id,
            'criterion_key', OLD.criterion_key,
            'period_month', OLD.period_month,
            'sale_id', OLD.sale_id,
            'customer_id', OLD.customer_id,
            'reason', OLD.reason,
            'created_by', OLD.created_by
          ),
          NOW()
        );
      END
    `;
  }

  // ─── approval_requests ────────────────────────────────────────────────────

  private approvalRequestsInsertTrigger(): string {
    return `
      CREATE TRIGGER \`approval_requests_after_insert\`
      AFTER INSERT ON \`approval_requests\`
      FOR EACH ROW
      BEGIN
        INSERT INTO \`database_change_log\` (
          \`table_name\`, \`record_id\`, \`action\`, \`new_values\`, \`triggered_at\`
        ) VALUES (
          'approval_requests', NEW.id, 'INSERT',
          JSON_OBJECT(
            'id', NEW.id,
            'request_type', NEW.request_type,
            'requested_by', NEW.requested_by,
            'target_user_id', NEW.target_user_id,
            'status', NEW.status,
            'note', NEW.note,
            'created_at', NEW.created_at
          ),
          NOW()
        );
      END
    `;
  }

  private approvalRequestsUpdateTrigger(): string {
    return `
      CREATE TRIGGER \`approval_requests_after_update\`
      AFTER UPDATE ON \`approval_requests\`
      FOR EACH ROW
      BEGIN
        DECLARE changed_fields JSON DEFAULT JSON_ARRAY();

        -- duyệt/từ chối: status luôn đổi cùng decided_by/decided_at
        IF OLD.status != NEW.status THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'status');
        END IF;

        -- decided_by: nullable — ai quyết định
        IF OLD.decided_by != NEW.decided_by OR (OLD.decided_by IS NULL AND NEW.decided_by IS NOT NULL) OR (OLD.decided_by IS NOT NULL AND NEW.decided_by IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'decided_by');
        END IF;

        -- reject_reason: nullable — lý do từ chối
        IF OLD.reject_reason != NEW.reject_reason OR (OLD.reject_reason IS NULL AND NEW.reject_reason IS NOT NULL) OR (OLD.reject_reason IS NOT NULL AND NEW.reject_reason IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'reject_reason');
        END IF;

        -- target_user_id: nullable — sale bị tác động
        IF OLD.target_user_id != NEW.target_user_id OR (OLD.target_user_id IS NULL AND NEW.target_user_id IS NOT NULL) OR (OLD.target_user_id IS NOT NULL AND NEW.target_user_id IS NULL) THEN
          SET changed_fields = JSON_ARRAY_APPEND(changed_fields, '$', 'target_user_id');
        END IF;

        -- NOTE: nội dung mục đề xuất nằm ở approval_request_*_items (không track)

        IF JSON_LENGTH(changed_fields) > 0 THEN
          INSERT INTO \`database_change_log\` (
            \`table_name\`, \`record_id\`, \`action\`, \`old_values\`, \`new_values\`, \`changed_fields\`, \`triggered_at\`
          ) VALUES (
            'approval_requests', NEW.id, 'UPDATE',
            JSON_OBJECT(
              'id', OLD.id,
              'request_type', OLD.request_type,
              'requested_by', OLD.requested_by,
              'target_user_id', OLD.target_user_id,
              'status', OLD.status,
              'decided_by', OLD.decided_by,
              'decided_at', OLD.decided_at,
              'reject_reason', OLD.reject_reason
            ),
            JSON_OBJECT(
              'id', NEW.id,
              'request_type', NEW.request_type,
              'requested_by', NEW.requested_by,
              'target_user_id', NEW.target_user_id,
              'status', NEW.status,
              'decided_by', NEW.decided_by,
              'decided_at', NEW.decided_at,
              'reject_reason', NEW.reject_reason
            ),
            changed_fields,
            NOW()
          );
        END IF;
      END
    `;
  }
}
