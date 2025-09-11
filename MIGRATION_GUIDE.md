# Hướng dẫn Migration Permissions

## Vấn đề
Database hiện tại có permissions theo cú pháp cũ (ví dụ: `pm_hp`, `pm_laptop`) nhưng code mới cần cú pháp `pm_cat_*` và `pm_brand_*`.

## Giải pháp
Tạo script migration để chuyển đổi permissions từ cú pháp cũ sang mới.

## Cách chạy migration

### Bước 1: Cấu hình database
Tạo file `.env` trong thư mục `backend` với nội dung:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=your_password
DB_NAME=nkc_autozalo
```

### Bước 2: Chạy migration
```bash
cd backend
npm run migrate:permissions
```

### Phương pháp 2: Chạy trực tiếp
```bash
cd backend
node scripts/simple-migration.js
```

### Phương pháp 3: Sử dụng API endpoint
1. Đảm bảo backend đang chạy
2. Đăng nhập để lấy JWT token
3. Gọi API:
```bash
curl -X POST http://localhost:3000/seed/migrate-permissions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt-token>"
```

## Những gì migration sẽ làm

1. **Tìm permissions cũ**: Tìm tất cả permissions có format `pm_*` nhưng không có `pm_cat_*` hoặc `pm_brand_*`

2. **Mapping với brands/categories**: 
   - So sánh slug của permission với slug của brands và categories
   - Nếu match với brand → chuyển thành `pm_brand_${slug}`
   - Nếu match với category → chuyển thành `pm_cat_${slug}`

3. **Tạo permissions mới**: Tạo permissions mới cho các brands và categories chưa có

4. **Xóa permissions cũ**: Xóa permissions cũ sau khi đã migrate

## Ví dụ migration

**Trước migration:**
- `pm_hp` → `pm_brand_hp`
- `pm_laptop` → `pm_cat_laptop`
- `pm_dell` → `pm_brand_dell`

**Sau migration:**
- Tất cả permissions sẽ có format `pm_cat_*` hoặc `pm_brand_*`
- Logic frontend sẽ hoạt động đúng với cú pháp mới

## Lưu ý
- Migration sẽ không ảnh hưởng đến dữ liệu khác
- Chỉ thay đổi tên permissions, không thay đổi ID
- Có thể chạy nhiều lần mà không gây lỗi
