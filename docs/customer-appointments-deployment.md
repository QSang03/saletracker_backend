# Triển khai đồng bộ lịch hẹn và KPI gặp khách

## Cấu hình server

```dotenv
CUSTOMER_APPOINTMENTS_ENABLED=true
CUSTOMER_APPOINTMENTS_URL=http://192.168.245.188:3031/api/report/sales
CUSTOMER_APPOINTMENTS_API_KEY=<key do bên nguồn cấp>
```

Không commit key, không cung cấp key cho FE. ENABLED chỉ điều khiển cron; API đồng bộ tay vẫn cần key và quyền khach-hang/import. Mặc định cron tắt cho đến khi cấu hình, chạy mỗi 5 phút khi bật.

Không có ngày chuyển đổi trong cách chấm. Tiêu chí 3 xét lịch completed + check-in trong toàn bộ kỳ báo cáo, kể cả lịch trước ngày triển khai. Nếu prod đã thêm CUSTOMER_APPOINTMENTS_CUTOVER theo hướng dẫn cũ thì xóa biến đó; phiên bản hiện tại không đọc biến này và không dùng tin regex cũ để chấm bất kỳ kỳ nào.

Nguồn trả datetime không offset. Bản tích hợp quy ước Asia/Ho_Chi_Minh giống KPI hiện tại; không dùng timezone máy chủ để parse lịch. Cần xác nhận quy ước này với bên nguồn khi nghiệm thu.

Thời điểm đồng bộ được lưu dạng ISO UTC có Z (varchar) để không lệch theo cấu hình dateStrings/timezone của MySQL driver; giờ hẹn/check-in nguồn giữ wall-clock Việt Nam và so sánh theo chuỗi ngày hợp lệ.

## Schema và khởi động

Repo đang dùng TypeORM synchronize=true, quét **/*.entity.{ts,js}. Hai bảng mới customer_appointments và customer_appointment_sync_state được tạo từ customer-appointment.entity.ts khi server khởi động; không cần thao tác SQL production thủ công. Đảm bảo quy trình deploy build sạch để dist không còn file lỗi thời. Không khởi động phiên bản mới vào DB thật chỉ để thử nghiệm.

OnModuleInit xóa riêng cấu hình kpi/movement_report_pattern. Seed đã bỏ cấu hình đó. Định nghĩa KPI giữ metric movement_report, tự cập nhật mô tả còn chứa tên config cũ; không đổi ngưỡng hay tên admin tùy chỉnh. Bảng customer_movement_reports giữ nguyên như kho lịch sử, không còn parser/writer hoặc consumer chấm KPI trong code hiện tại.

Python checkout không có regex writer để gỡ. Khi deploy, rà worker ngoài checkout nếu có; dừng writer legacy. Tin báo cáo được ghi nhầm không ảnh hưởng điểm ở bất kỳ kỳ nào. Không xóa lịch sử hoặc drop bảng movement.

## Kiểm chứng trước khi mở sử dụng

1. Build và chạy test cục bộ `npm run build`, `npm run test:customer-appointments`, `npm run test:customer-kpi-scoring`. Python chạy `python -m src.services.common.test_customer_kpi_rollup`. Bộ integration tổng `test:customer-kpi` có tạo/xóa fixture và cần server + DB thử nghiệm + Python; không chạy vào production để kiểm tra tính năng này.
2. Cấu hình URL/key đúng môi trường, khởi động backend để tạo schema. Cấp quyền khach-hang/read cho người xem, import cho người được đồng bộ thủ công.
3. Gọi POST /customer-appointments/sync bằng JWT có quyền import. Kiểm tra GET /customer-appointments/sync-status: success, stale=false. Không chấm fail khi chưa sync lần đầu hoặc lần thành công đã quá 15 phút.
4. Đối chiếu user 57 → NKDS55 → slp_code 251 với nguồn. Kiểm tra lịch bằng GET danh sách/chi tiết, ảnh bằng JWT, giới hạn sale và phòng ban.
5. Kiểm tra KPI khách và sale với completed + check-in, lịch chưa hoàn thành, chuyển trạng thái hủy, cùng mã khác SAP, toàn bộ quý và lịch trước ngày triển khai và export. Mapping sai/thiếu không tự tạo user/khách/phân công.
6. Python chỉ cần cập nhật tài liệu/health check, giữ nguyên job rollup. Chạy script check_customer_appointments_health.py sau khi NestJS đã sync, dùng cùng main DB.

## Cách đồng bộ và lỗi

Job tải toàn bộ báo cáo không filter để bao gồm lịch tương lai và sửa đổi kỳ cũ, tránh phụ thuộc filter ngày chưa có contract. Kiểm tra total_sales, total_appointments, tổng từng sale, ID trùng, datetime, status và filters trước khi ghi. Nếu nhà cung cấp thêm phân trang, cần cập nhật client; không chấp nhận response có số dòng lệch tổng. Nếu nguồn âm thầm giới hạn cả tổng lẫn dữ liệu thì kiểm tra hiện tại không thể phát hiện, cần xác nhận với bên nguồn. Dữ liệu lớn dần cần hỗ trợ phân trang/cursor chính thức trước khi vượt giới hạn.

Timeout 20 giây/request, tối đa 3 lần có backoff ngắn. MySQL GET_LOCK trên cùng connection ngăn cron và đồng bộ tay chạy chồng giữa nhiều instance. Ghi lịch và last_success trong một transaction. Lỗi mạng/response/schema giữ nguyên dữ liệu cũ, state lỗi. Không lưu response/key/error nguồn vào log. Web vẫn xem dữ liệu đã có với cảnh báo freshness; KPI trả no_data khi sync quá 15 phút.

Không có sale_code: bỏ qua theo phạm vi đã thống nhất. Có code nhưng chưa nối duy nhất tới user: giữ lịch chưa map, không hiện cho sale khác. Có user nhưng thiếu/không rõ khách: lịch vẫn xem được theo sale và báo mappingStatus; KPI tương ứng không kết luận fail. Cặp mã khách + ERP/SAP được ưu tiên, chỉ fallback mã khách khi thiếu ERP và có đúng một ứng viên. Companions không được ghi nhận KPI.

Nguồn đã lưu nay vắng khỏi toàn bộ response: giữ bản ghi với mapping_status=source_missing và synced_at cũ, không suy ra bị xóa. Tạm dừng dùng làm bằng chứng KPI; lịch trở lại sẽ tự phục hồi mapping/trạng thái. Sửa mapping khiến một mã nguồn cũ chuyển sang user khác: mapping_conflict, cần vận hành kiểm tra bảng đối chiếu và liên kết cũ; không tự chuyển lịch. Source updated_at lùi làm toàn bộ lần đồng bộ thất bại để tránh ghi đè bằng phiên bản cũ.

Lịch completed + check-in được tính theo ngày check-in, mọi purpose, không loại theo alert/đến trễ/thời lượng. Approved/checked_in chưa tính. KPI giữ công thức cũ; quyền ghi đè tiêu chí hiện có vẫn áp dụng. Lịch hẹn không thay cho tin Zalo ở monthly_contact/suggestion_ack.

Đã phát hiện trong báo cáo toàn nguồn có customer.code=null dù status=completed. Giữ lịch dưới sale, customer_code='', customer_id=null và unmatched_customer. Không ghép bằng tên/điện thoại. Lịch completed có check-in nhưng không có mã khách khiến TC3 trong kỳ đó của các phân công thuộc sale trả no_data vì không biết khách nào đã được gặp. Lịch chưa hoàn thành thiếu mã khách không làm mất khả năng chấm KPI. Tab theo customerId không thể hiện lịch chưa xác định khách, phải đối chiếu ở danh sách sale. Cần bên nguồn bổ sung mã để tự khớp ở lần sync sau.

## Rollback

Tắt cron bằng ENABLED=false không đổi nguồn chấm KPI và sau 15 phút sẽ làm dữ liệu stale. Không dùng việc tắt cron làm rollback nghiệp vụ. Nếu rollback code, giữ hai bảng lịch; bản cũ có thể đọc regex nên phải kiểm soát công bố báo cáo trong thời gian rollback. Không khôi phục cấu hình regex để che lỗi. Phiên bản hiện tại tính lại TC3 trong mọi kỳ theo lịch API; khác biệt với báo cáo đã tính từ cú pháp cũ là hệ quả của việc thay nguồn bằng chứng, không thay khoảng kỳ.
