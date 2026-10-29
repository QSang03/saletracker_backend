-- ============================================================================
-- CHẠY TRÊN MYSQL PRODUCTION TRƯỚC KHI KHỞI ĐỘNG BACKEND PHIÊN BẢN MỚI
-- (schema: autozalo_v2_main). Chạy từng bước theo thứ tự; mỗi bước đều có
-- câu kiểm tra để biết có cần chạy hay không. KHÔNG chạy file này trên dev.
--
-- Bối cảnh: backend bật TypeORM synchronize: true nên mọi thay đổi schema do
-- entity quyết định. Ba bước dưới đây xử lý các vướng mắc chỉ xuất hiện trên
-- production (dev đã có sẵn bảng/cột nên không lộ).
-- ============================================================================

USE `autozalo_v2_main`;

-- ----------------------------------------------------------------------------
-- BƯỚC 1 (BẮT BUỘC): gỡ FK di sản customer_message_history.customer_id -> customers.id
--
-- Vì sao: entity `Customer` khai id kiểu int nhưng prod đang là bigint unsigned.
-- TypeORM sẽ ALTER `customers.id` sang int; MySQL từ chối nếu cột còn được một FK
-- trỏ tới -> ER_FK_COLUMN_CANNOT_CHANGE_CHILD -> backend không boot được.
-- Bảng `customer_message_history` là di sản (0 dòng, không code nào đọc/ghi;
-- code hiện tại dùng `auto_greeting_customer_message_history`).
--
-- Kiểm tra trước: FK còn tồn tại thì mới cần chạy ALTER bên dưới.
-- (Câu lệnh dưới đây tự kiểm tra nên chạy lại nhiều lần đều an toàn.)
-- ----------------------------------------------------------------------------
SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'customer_message_history'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    AND CONSTRAINT_NAME = 'FK_7154b8a3bc8a3964b9702c55f47'
);
SET @ddl := IF(@fk_exists > 0,
  'ALTER TABLE `customer_message_history` DROP FOREIGN KEY `FK_7154b8a3bc8a3964b9702c55f47`',
  'DO 0');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- BƯỚC 2 (NÊN CHẠY): bổ sung dòng typeorm_metadata còn thiếu cho
-- order_details.conversation_end.
--
-- Vì sao: TypeORM so biểu thức cột generated giữa entity và giá trị nó tự lưu ở
-- bảng typeorm_metadata. Cột conversation_end không có dòng nào trong
-- typeorm_metadata nên mọi lần boot đều coi là "khác" -> DROP INDEX
-- idx_conversation_duration + ALTER TABLE order_details (bảng ~615k dòng) +
-- CREATE INDEX lại. Bổ sung đúng chuỗi bên dưới thì sync hết churn (đã kiểm
-- chứng: 0 query còn lại ở các lần boot sau).
-- Câu lệnh tự bỏ qua nếu dòng đã tồn tại.
-- ----------------------------------------------------------------------------
INSERT INTO `typeorm_metadata` (`type`, `name`, `value`, `table`, `schema`)
SELECT 'GENERATED_COLUMN', 'conversation_end', '
      CASE
        WHEN JSON_TYPE(JSON_EXTRACT(metadata, ''$.messages'')) = ''ARRAY''
             AND JSON_LENGTH(JSON_EXTRACT(metadata, ''$.messages'')) > 0
        THEN STR_TO_DATE(
               LEFT(
                 JSON_UNQUOTE(
                   JSON_EXTRACT(
                     metadata,
                     CONCAT(''$.messages['',
                            JSON_LENGTH(JSON_EXTRACT(metadata, ''$.messages'')) - 1,
                            ''].timestamp'')
                   )
                 ),
                 19
               ),
               ''%Y-%m-%dT%H:%i:%s''
             )
        ELSE NULL
      END
    ', 'order_details', DATABASE()
WHERE NOT EXISTS (
  SELECT 1 FROM (
    SELECT 1 FROM `typeorm_metadata`
    WHERE `type` = 'GENERATED_COLUMN' AND `name` = 'conversation_end'
      AND `table` = 'order_details' AND `schema` = DATABASE()
  ) AS existing
);

-- ----------------------------------------------------------------------------
-- BƯỚC 3 (TÙY CHỌN - cân nhắc trước khi chạy): chốt watermark đo thời gian
-- phản hồi để service Python không quét lại toàn bộ lịch sử zalo_messages.
--
-- Vì sao: SaleResponseMeasureService đọc tin theo `zalo_messages.id > watermark`,
-- watermark lấy từ system_config 'sale_response_watermark'; chưa có key này thì
-- mặc định = 0 -> lần chạy đầu sau khi bảng được tạo sẽ quét TOÀN BỘ
-- (~869k tin ở prod) và ghi khoảng chờ cho cả lịch sử.
--   - Muốn đo từ hiện tại trở đi: chạy câu INSERT dưới (đặt = id tin mới nhất).
--   - Muốn backfill lịch sử: BỎ QUA bước này (service sẽ tự chạy từ đầu).
-- ----------------------------------------------------------------------------
-- INSERT INTO `system_config` (`name`, `display_name`, `value`, `type`, `section`, `status`, `created_at`, `updated_at`)
-- SELECT 'sale_response_watermark', 'Watermark đo thời gian phản hồi', CAST(MAX(id) AS CHAR), 'string', 'system', 1, NOW(), NOW()
-- FROM `autozalo_v2_zalo`.`zalo_messages`
-- WHERE NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM `system_config` WHERE `name` = 'sale_response_watermark') AS s);

-- ----------------------------------------------------------------------------
-- KIỂM TRA SAU KHI CHẠY
-- ----------------------------------------------------------------------------
-- 1) FK đã gỡ:
--    SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
--    WHERE TABLE_SCHEMA='autozalo_v2_main' AND REFERENCED_TABLE_NAME='customers';
--    -> còn 0 (FK _customer_message_history_ đã gỡ)
-- 2) Dòng metadata đã có, value khớp entity:
--    SELECT `name`, LENGTH(`value`) FROM `typeorm_metadata`
--    WHERE `table`='order_details' ORDER BY `name`;
--    -> 5 dòng: conversation_end, conversation_start, expiry_days,
--       meta_customer_id, meta_is_group

-- ----------------------------------------------------------------------------
-- BƯỚC 4 (BẮT BUỘC): bỏ status pending/confirmed, thêm cột dự án + chăm sóc
--
-- Vì sao: entity mới chỉ còn enum
--   quoted | cared | completed | demand | rejected
-- Nếu còn dòng pending/confirmed, ALTER enum sẽ lỗi Data truncated (strict mode).
-- Chạy bước này TRƯỚC khi start backend mới. Nên dừng Python/Nest ghi đơn
-- trong lúc chạy (maintenance window ngắn) hoặc deploy Python normalization trước.
--
-- LƯU Ý: đây là thao tác một lần. Nếu cột đã tồn tại (deploy lại), bỏ qua phần
-- ADD COLUMN/ADD INDEX tương ứng.
-- ----------------------------------------------------------------------------
UPDATE `order_details` SET `status` = 'quoted'    WHERE `status` = 'pending';
UPDATE `order_details` SET `status` = 'completed' WHERE `status` = 'confirmed';

-- Kiểm tra trước khi ALTER: chỉ còn 5 giá trị
SELECT `status`, COUNT(*) AS `count`
FROM `order_details`
GROUP BY `status`;

ALTER TABLE `order_details`
  MODIFY COLUMN `status` ENUM('quoted','cared','completed','demand','rejected')
    NOT NULL DEFAULT 'quoted',
  ADD COLUMN `is_project` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `projected_at` TIMESTAMP NULL,
  ADD COLUMN `projected_by` INT NULL,
  ADD COLUMN `care_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN `first_cared_at` TIMESTAMP NULL,
  ADD COLUMN `last_cared_at` TIMESTAMP NULL,
  ADD INDEX `idx_order_details_is_project` (`is_project`, `created_at`);

-- 3) Kiểm tra sau ALTER:
--    SHOW COLUMNS FROM order_details LIKE 'status';
--    -> enum('quoted','cared','completed','demand','rejected')
--    SELECT status, COUNT(*) FROM order_details GROUP BY status;
--    -> không còn pending/confirmed
--    SELECT COUNT(*) FROM order_details WHERE is_project = 1;
