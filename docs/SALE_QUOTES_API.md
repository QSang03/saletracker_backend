# SaleTracker – Báo giá & Cấu hình máy ráp (Backend API)

> Phiên bản: 2.1 – 2026-10-26
> Module: `src/sale-quotes`
> Base URL: `{NEXT_PUBLIC_API_URL}` (ví dụ `http://localhost:4000`)
> Auth: Bearer token, dùng chung cơ chế đăng nhập hiện tại.

---

## 1. Phạm vi

Backend phục vụ **3 phân hệ**:

1. **Báo giá chuẩn nhiều dòng**
   - Tạo báo giá gồm nhiều sản phẩm.
   - Copy text đúng cú pháp SaleTracker/Zalo.
   - Các mode: `standard` (nhiều dòng), `single` (một dòng), `build` (có SL/thành tiền), `customer` (gửi khách, giá đã cộng markup).
   - Xuất Excel nội bộ hoặc gửi khách.

2. **Báo giá nhanh**
   - Tìm sản phẩm từ bảng `products` đã đồng bộ giá/tồn kho.
   - Tạo case báo giá gồm nhiều sản phẩm.
   - Hỗ trợ dòng thay thế / tương đương.
   - Copy text đúng cú pháp Zalo như file HTML gốc.
   - Xuất Excel báo giá nhanh.

3. **Cấu hình máy ráp**
   - Tạo cấu hình gồm nhiều linh kiện.
   - Lưu thông số kỹ thuật dạng `{label, value}`.
   - Chia sẻ cấu hình cho sale khác dùng.
   - Copy text Zalo và xuất Excel.

**Không còn trong phạm vi:** Spec sản phẩm, lịch sử biến động giá, giá sàn/giá bán cố định, tra cứu hóa đơn, đếm lượt copy.

---

## 2. Bảng dữ liệu: 7 bảng

| # | Bảng | Vai trò |
|---|---|---|
| 1 | `sale_quote_settings` | Cấu hình riêng từng user: quy tắc giá, bảo hành mặc định, tình trạng mặc định, ghi chú, suffix Zalo |
| 2 | `sale_quotes` | Header báo giá chuẩn |
| 3 | `sale_quote_items` | Dòng báo giá chuẩn |
| 4 | `sale_quick_quote_cases` | Header case báo giá nhanh |
| 5 | `sale_quick_quote_items` | Từng dòng sản phẩm/yêu cầu trong case |
| 6 | `sale_builds` | Header cấu hình máy ráp + specs động |
| 7 | `sale_build_items` | Linh kiện trong cấu hình |

Quan hệ:

```text
sale_quote_settings (1 user ↔ 1 cấu hình)

sale_quotes             1 ─── n sale_quote_items
sale_quick_quote_cases  1 ─── n sale_quick_quote_items
sale_builds             1 ─── n sale_build_items
```

Nguyên tắc snapshot: `productCode`, `pn`, `name`, `warranty`, `costPrice` được lưu tại thời điểm tạo. Sản phẩm đổi giá/tên sau này **không làm thay đổi** báo giá/case/cấu hình cũ.

---

## 3. Phân quyền

Tất cả endpoint dùng `AuthGuard`.

| Vai trò | Quyền |
|---|---|
| Sale thường | CRUD báo giá/case/cấu hình của mình; đọc cấu hình có `isShared = true` |
| `admin` | Đọc tất cả, sửa/xoá tất cả |
| `view` | Chỉ đọc tất cả; mọi thao tác ghi bị chặn `403` |
| `PM` | Như sale thường (phạm vi này không cần quyền quản lý giá) |

Quy tắc:

- Báo giá và case báo giá nhanh luôn riêng tư (trừ admin/view).
- Cấu hình máy ráp có `isShared`; sale khác đọc được nhưng không sửa được.
- Sale không đọc được dữ liệu riêng của người khác: trả `404` để không lộ sự tồn tại.
- Admin/view gửi `mine=true` để chỉ xem của mình.

---

## 4. Quy ước chung

- Response JSON trực tiếp, không bọc envelope.
- Phân trang: `{ "data": [...], "total": 0, "page": 1, "pageSize": 20 }`.
- Tiền là `number` VNĐ; `null` = chưa có giá (`CALL`).
- `pageSize` tối đa 100.
- Lỗi: `{ "statusCode": 400, "message": "...", "error": "Bad Request" }`.

---

## 5. API Reference

### 5.1. Cấu hình người dùng

#### `GET /sale-quotes/settings`

```json
{
  "id": null,
  "userId": 12,
  "pricingRules": {
    "lowPriceThreshold": 1000000,
    "lowPriceMargin": 20000,
    "highPriceMarkupPercent": 2,
    "customerMarkupPercent": 10,
    "roundTo": 1000
  },
  "defaultWarranty": "",
  "defaultStatusText": "CHECK KHO NHẬP 1 BUỔI / 1 NGÀY",
  "defaultGlobalNote": "",
  "zaloSuffix": "",
  "createdAt": null,
  "updatedAt": null
}
```

#### `PATCH /sale-quotes/settings`

```json
{
  "defaultWarranty": "12 tháng",
  "defaultStatusText": "SẴN HÀNG",
  "defaultGlobalNote": "Giá đã bao gồm VAT.",
  "zaloSuffix": "Hotline: 0909 xxx xxx",
  "pricingRules": {
    "lowPriceMargin": 20000,
    "highPriceMarkupPercent": 2,
    "customerMarkupPercent": 10,
    "roundTo": 1000
  }
}
```

Cấu hình áp dụng cho cả **báo giá chuẩn**, **báo giá nhanh** và **máy ráp**.

---

### 5.2. Danh mục sản phẩm

#### `GET /sale-quotes/catalog`

| Param | Kiểu | Mô tả |
|---|---|---|
| `search` | string | Tìm theo mã, tên, mô tả, hãng, nhóm |
| `brand` | string | Lọc theo hãng (LIKE) |
| `categoryId` | number | Lọc theo category |
| `inStock` | boolean | `true` → chỉ sản phẩm có `stock > 0` |
| `page` | number | Mặc định 1 |
| `pageSize` | number | Mặc định 20, tối đa 100 |
| `sort` | string | `name_asc`, `price_asc`, `price_desc`, `stock_desc`, `updated_desc` |

Ví dụ:

```http
GET /sale-quotes/catalog?search=i5%2013400&inStock=true&page=1&pageSize=20
```

Response:

```json
{
  "data": [
    {
      "id": 1234,
      "productCode": "CPU_I5_13400F",
      "productName": "CPU Intel Core i5 13400F",
      "descriptionText": "CPU Intel Core i5 13400F ...",
      "brand": { "id": 3, "name": "INTEL" },
      "category": { "id": 9, "catName": "LINH KIỆN" },
      "costPrice": 4000000,
      "suggestedPrice": 4080000,
      "displayPrice": 4080000,
      "marginAmount": 80000,
      "marginPercent": 2,
      "warranty": null,
      "stock": 12,
      "isInStock": true,
      "isActive": true,
      "syncedAt": "2026-10-26T06:00:00.000Z",
      "updatedAt": "2026-10-26T06:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20,
  "pricingRules": {
    "lowPriceThreshold": 1000000,
    "lowPriceMargin": 20000,
    "highPriceMarkupPercent": 2,
    "customerMarkupPercent": 10,
    "roundTo": 1000
  }
}
```

- `costPrice`: giá vốn đồng bộ từ API.
- `suggestedPrice` / `displayPrice`: giá bán đề xuất.
- `warranty`: API sản phẩm không trả bảo hành nên là `null`; dùng `defaultWarranty` hoặc nhập tay.
- `stock`, `isInStock`: tồn kho từ cron 6 giờ.

#### `GET /sale-quotes/catalog/:id`

Trả chi tiết + `descriptionHtml`:

```json
{
  "id": 1234,
  "productCode": "CPU_I5_13400F",
  "productName": "CPU Intel Core i5 13400F",
  "descriptionText": "CPU Intel Core i5 13400F ...",
  "descriptionHtml": "<h2>...</h2>",
  "costPrice": 4000000,
  "suggestedPrice": 4080000,
  "displayPrice": 4080000,
  "stock": 12,
  "isInStock": true
}
```

#### `POST /sale-quotes/pricing/preview`

Tính thử giá:

```json
{
  "items": [
    { "productId": 1234, "quantity": 2 },
    { "costPrice": 500000, "quantity": 1 }
  ]
}
```

```json
{
  "pricingRules": { "...": "..." },
  "items": [
    {
      "productId": 1234,
      "productCode": "CPU_I5_13400F",
      "productName": "CPU Intel Core i5 13400F",
      "costPrice": 4000000,
      "suggestedPrice": 4080000,
      "customerPrice": 4488000,
      "marginAmount": 80000,
      "marginPercent": 2,
      "quantity": 2
    }
  ]
}
```

---

### 5.3. Báo giá chuẩn nhiều dòng

#### `POST /sale-quotes/quotes`

```json
{
  "title": "Báo giá laptop tháng 10",
  "customerName": "Anh A",
  "customerPhone": "0909123456",
  "customerAddress": "Hà Nội",
  "status": "draft",
  "mode": "standard",
  "globalNote": "Giá đã bao gồm VAT.",
  "zaloSuffix": "Hotline: 0909 xxx xxx",
  "items": [
    {
      "productId": 1234,
      "quantity": 1,
      "warranty": "12"
    },
    {
      "productId": 5678,
      "quantity": 2,
      "unitPrice": 2500000,
      "statusText": "SẴN HÀNG"
    }
  ]
}
```

Quy tắc tạo dòng:

- Có `productId`: backend tự lấy `productCode`, `productName`, `costPrice`.
- Không có `unitPrice`: dùng giá đề xuất từ `costPrice`.
- Không có `warranty`: lấy `defaultWarranty`.
- Không có `statusText`: lấy `defaultStatusText`.
- `isManual` mặc định `true` nếu không có `productId`.
- `lineTotal = unitPrice * quantity`.

Giá trị hợp lệ:

- `status`: `draft`, `sent`, `won`, `lost`, `cancelled`
- `mode`: `standard`, `build`, `single`, `customer`

#### `GET /sale-quotes/quotes`

| Param | Mô tả |
|---|---|
| `status` | Lọc trạng thái |
| `mode` | Lọc kiểu text |
| `search` | Mã báo giá, tiêu đề, tên/SĐT khách |
| `mine` | `true` → chỉ của mình |
| `saleUserId` | Admin/view lọc theo sale |
| `dateFrom`, `dateTo` | Lọc theo `created_at` |
| `page`, `pageSize` | Phân trang, tối đa 100 |

Response list có `itemCount`:

```json
{
  "data": [
    {
      "id": 10,
      "quoteCode": "BG-261026-ABCD",
      "title": "Báo giá laptop tháng 10",
      "customerName": "Anh A",
      "customerPhone": "0909123456",
      "status": "draft",
      "mode": "standard",
      "totalAmount": 20400000,
      "hasUnpricedItems": false,
      "saleUser": { "id": 12, "fullName": "Nguyễn Văn Sale", "username": "sale01" },
      "itemCount": 2,
      "createdAt": "2026-10-26T08:00:00.000Z",
      "updatedAt": "2026-10-26T08:05:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 20
}
```

#### `GET /sale-quotes/quotes/:id`

```json
{
  "id": 10,
  "quoteCode": "BG-261026-ABCD",
  "title": "Báo giá laptop tháng 10",
  "customerName": "Anh A",
  "customerPhone": "0909123456",
  "customerAddress": "Hà Nội",
  "saleUserId": 12,
  "saleUser": { "id": 12, "fullName": "Nguyễn Văn Sale", "username": "sale01" },
  "status": "draft",
  "mode": "standard",
  "globalNote": "Giá đã bao gồm VAT.",
  "zaloSuffix": "",
  "totalAmount": 15300000,
  "hasUnpricedItems": false,
  "metadata": null,
  "sentAt": null,
  "items": [
    {
      "id": 21,
      "quoteId": 10,
      "productId": 1234,
      "productCode": "S1_ABC",
      "pn": "ABC-123",
      "name": "Laptop ABC",
      "description": "i5/16GB",
      "warranty": "12",
      "costPrice": 15000000,
      "unitPrice": 15300000,
      "quantity": 1,
      "lineTotal": 15300000,
      "statusText": ";SẴN HÀNG",
      "note": null,
      "sortOrder": 0,
      "isManual": false,
      "metadata": null,
      "customerPrice": 16830000,
      "createdAt": "2026-10-26T08:00:00.000Z",
      "updatedAt": "2026-10-26T08:00:00.000Z"
    }
  ],
  "customerTotal": 16830000,
  "pricingRules": { "...": "..." },
  "createdAt": "2026-10-26T08:00:00.000Z",
  "updatedAt": "2026-10-26T08:05:00.000Z"
}
```

#### `PATCH /sale-quotes/quotes/:id`

```json
{
  "title": "Báo giá laptop – bản 2",
  "status": "sent",
  "mode": "build",
  "globalNote": "Giao trong ngày.",
  "zaloSuffix": ""
}
```

#### `DELETE /sale-quotes/quotes/:id`

Soft delete.

#### `POST /sale-quotes/quotes/:id/duplicate`

Nhân bản báo giá, gán cho user hiện tại, trạng thái `draft`, tiêu đề thêm `(Bản sao)`.

#### `POST /sale-quotes/quotes/:id/items`

```json
{
  "productId": 1234,
  "quantity": 2,
  "unitPrice": 4200000,
  "warranty": "36",
  "statusText": "SẴN HÀNG",
  "note": "Hàng mới về"
}
```

Hoặc dòng thủ công:

```json
{
  "name": "Công lắp đặt",
  "pn": "",
  "quantity": 1,
  "unitPrice": 500000,
  "isManual": true
}
```

#### `PATCH /sale-quotes/quotes/:id/items/:itemId`

```json
{
  "unitPrice": 4150000,
  "quantity": 3,
  "statusText": "GẦN HẾT HÀNG"
}
```

Backend tự tính lại `lineTotal`, `totalAmount`, `hasUnpricedItems`.

#### `DELETE /sale-quotes/quotes/:id/items/:itemId`

Xoá dòng và tính lại tổng.

#### `POST /sale-quotes/quotes/:id/items/reorder`

```json
{ "itemIds": [23, 21, 22] }
```

#### `GET /sale-quotes/quotes/:id/text`

| Param | Mô tả |
|---|---|
| `mode` | Ghi đè mode: `standard`, `build`, `single`, `customer` |
| `zaloSuffix` | Ghi đè suffix Zalo |

```json
{
  "text": "1-S1_ABC\t;\tABC-123\tLaptop ABC\tBH 12 tháng\t;\t15.300.000\t;SẴN HÀNG\n\n...",
  "mode": "standard",
  "itemCount": 2,
  "totalAmount": 20400000,
  "charCount": 186
}
```

FE chỉ cần `navigator.clipboard.writeText(res.text)`.

#### `GET /sale-quotes/quotes/:id/export?type=internal|customer`

File `.xlsx`:
- `internal`: có giá vốn, giá bán, thành tiền, tình trạng.
- `customer`: giá đã cộng `customerMarkupPercent` (mặc định 10%), có disclaimer.

---

### 5.4. Báo giá nhanh (Quick cases)

#### `POST /sale-quotes/quick-cases`

```json
{
  "title": "Khách hỏi cấu hình văn phòng",
  "customerName": "Chị B",
  "customerPhone": "0912345678",
  "globalNote": "Giá đã bao gồm VAT.",
  "status": "draft",
  "items": [
    {
      "requestText": "i5 13400F",
      "matchType": "custom",
      "productId": 1234,
      "quantity": 1,
      "warranty": "36",
      "statusText": "SẴN HÀNG"
    },
    {
      "requestText": "RTX 4060",
      "matchType": "replacement",
      "description": "VGA Asus RTX 4060 8GB",
      "salePrice": 8500000,
      "quantity": 1,
      "warranty": "36",
      "statusText": "CHECK KHO CHỜ NHẬP HÀNG"
    }
  ]
}
```

Quy tắc:

- Có `productId`: backend lấy `productCode`, `productName` (đổ vào `description`), `costPrice`.
- Không có `salePrice`: dùng giá đề xuất.
- Không có `warranty`/`statusText`: dùng default trong settings.
- `lineTotal = salePrice * quantity`.
- `matchType`: `exact`, `replacement`, `equivalent`, `custom`.

#### `POST /sale-quotes/quick-cases/bulk`

```json
{
  "title": "Khách gửi 3 món",
  "rawText": "i5 13400F\nRTX 4060\n16GB DDR4",
  "globalNote": "Giá đã bao gồm VAT."
}
```

Mỗi dòng thành một item `matchType = custom`, chưa gán sản phẩm.

#### `GET /sale-quotes/quick-cases`

| Param | Mô tả |
|---|---|
| `status` | Lọc trạng thái |
| `search` | Tiêu đề, tên/SĐT khách |
| `mine` | Chỉ của mình |
| `page`, `pageSize` | Phân trang |

#### `GET /sale-quotes/quick-cases/:id`

Trả chi tiết case + items + `pricingRules`; mỗi item có `customerPrice`.

#### `PATCH /sale-quotes/quick-cases/:id`

Cập nhật `title`, `customerName`, `customerPhone`, `globalNote`, `status`, `metadata`.

#### `DELETE /sale-quotes/quick-cases/:id`

Soft delete.

#### `POST /sale-quotes/quick-cases/:id/duplicate`

Nhân bản case.

#### Item endpoints

- `POST /sale-quotes/quick-cases/:id/items`
- `PATCH /sale-quotes/quick-cases/:id/items/:itemId`
- `DELETE /sale-quotes/quick-cases/:id/items/:itemId`
- `POST /sale-quotes/quick-cases/:id/items/reorder`

#### `GET /sale-quotes/quick-cases/:id/text?zaloSuffix=...`

Trả text Zalo. `globalNote` được nối cuối text, sau đó `zaloSuffix`.

#### `GET /sale-quotes/quick-cases/:id/export?type=internal|customer`

File Excel báo giá nhanh.

---

### 5.5. Cấu hình máy ráp (Builds)

#### `POST /sale-quotes/builds`

```json
{
  "name": "PC Gaming i5 – RTX 4060",
  "folder": "Báo Giá Theo Yêu Cầu",
  "description": "Cấu hình tầm trung",
  "isShared": true,
  "isTemplate": false,
  "specs": [
    { "label": "CPU", "value": "i5 13400F" },
    { "label": "RAM", "value": "16GB DDR4" },
    { "label": "VGA", "value": "RTX 4060 8GB" }
  ],
  "items": [
    { "productId": 1234, "quantity": 1, "warranty": "36" },
    { "productId": 5678, "quantity": 2, "warranty": "36" }
  ]
}
```

Quy tắc dòng:

- `costPrice`: giá vốn từ sản phẩm.
- `salePrice`: nếu không gửi thì lấy giá đề xuất.
- `lineTotal = salePrice * quantity`.
- Không có `warranty` → `defaultWarranty`.

#### `GET /sale-quotes/builds`

| Param | Mô tả |
|---|---|
| `folder` | Lọc thư mục |
| `search` | Tìm theo tên/mô tả |
| `mine` | Chỉ của mình |
| `includeShared` | Mặc định `true`; `false` để chỉ lấy của mình |
| `page`, `pageSize` | Phân trang |

#### `GET /sale-quotes/builds/folders`

```json
[
  { "folder": "Báo Giá Theo Yêu Cầu", "count": 5 },
  { "folder": "Máy Ráp Build Sẵn", "count": 12 }
]
```

#### `GET /sale-quotes/builds/:id`

Trả chi tiết, `items` có thêm `customerPrice`, `specs` là `{label, value}[]`.

#### `PATCH /sale-quotes/builds/:id`

Cập nhật `name`, `folder`, `description`, `specs`, `isShared`, `isTemplate`, `sortOrder`.

#### `DELETE /sale-quotes/builds/:id`

Soft delete.

#### `POST /sale-quotes/builds/:id/duplicate`

Nhân bản, gán owner hiện tại, `isShared = false`.

#### Item endpoints

- `POST /sale-quotes/builds/:id/items`
- `PATCH /sale-quotes/builds/:id/items/:itemId`
- `DELETE /sale-quotes/builds/:id/items/:itemId`
- `POST /sale-quotes/builds/:id/items/reorder`

Body item:

```json
{
  "productId": 1234,
  "quantity": 1,
  "salePrice": 4200000,
  "warranty": "36",
  "statusText": "SẴN HÀNG"
}
```

#### `GET /sale-quotes/builds/:id/text?includeSpecs=true&zaloSuffix=...`

Trả text copy Zalo. Nếu `includeSpecs=true`, nối thêm phần thông số kỹ thuật.

#### `GET /sale-quotes/builds/:id/export?type=internal|customer`

File Excel cấu hình máy ráp.

---

## 6. Quy tắc tính giá

Mặc định trong `sale_quote_settings.pricing_rules`:

```json
{
  "lowPriceThreshold": 1000000,
  "lowPriceMargin": 20000,
  "highPriceMarkupPercent": 2,
  "customerMarkupPercent": 10,
  "roundTo": 1000
}
```

1. `costPrice` null/`<= 0` → `null` (`CALL`).
2. `costPrice < lowPriceThreshold` → `costPrice + lowPriceMargin`.
3. Ngược lại → `costPrice * (1 + highPriceMarkupPercent / 100)`.
4. Làm tròn theo `roundTo`.
5. `customerPrice = salePrice * (1 + customerMarkupPercent / 100)`, làm tròn `roundTo`.

Ví dụ:

| Giá vốn | Giá bán đề xuất | Giá khách (10%) |
|---|---|---|
| 500.000 | 520.000 | 572.000 |
| 1.000.000 | 1.020.000 | 1.122.000 |
| 15.000.000 | 15.300.000 | 16.830.000 |

Ghi chú: file HTML gốc random 20.000–30.000 cho hàng dưới 1 triệu; backend dùng **20.000 cố định** để giá tái lập được. Có thể đổi `lowPriceMargin` trong settings.

---

## 7. Cú pháp text

Backend trả text đã format sẵn. FE **không tự ghép lại**.

Ký hiệu: `\t` = tab, `\n` = xuống dòng.

### 7.1. Báo giá chuẩn nhiều dòng (`mode = standard`)

```json
"1-S1_ABC\t;\tABC-123\tLaptop ABC\tBH 12 tháng\t;\t15.300.000\t;SẴN HÀNG\n\n2-S1_DEF\t;\tDEF-456\tMàn hình DEF\tBH 24 tháng\t;\t2.550.000\t;GẦN HẾT HÀNG"
```

Cấu trúc:

```text
{STT}-{MÃ HT}<TAB>;<TAB>{P/N}<TAB>{TÊN}<TAB>{BH}<TAB>;<TAB>{GIÁ}<TAB>{TÌNH TRẠNG}
```

- Nếu P/N rỗng/trùng tên/nằm trong tên → chỉ in tên.
- Có mô tả ngắn → nối ` - {mô tả}`.
- Tình trạng luôn có `;` phía trước.
- Không có giá → `CALL`.
- Chỉ nối `zaloSuffix`, không nối `globalNote` (giống file gốc).

### 7.2. Một dòng (`mode = single`)

```json
"S1_ABC\t;\tABC-123\tLaptop ABC\tBH 12 tháng\t;\t15.300.000\t;SẴN HÀNG"
```

Không có số thứ tự, chỉ dòng đầu tiên.

### 7.3. Có số lượng (`mode = build`)

```json
"1-S1_ABC\t;\tABC-123\tLaptop ABC\tBH 12 tháng\t;\tĐơn giá: 15.300.000 fv\t;\tSL: 1\t;\tThành tiền: 15.300.000 ₫\t;SẴN HÀNG\n\n2-S1_DEF\t;\tDEF-456\tMàn hình DEF\tBH 24 tháng\t;\tĐơn giá: 2.550.000 fv\t;\tSL: 2\t;\tThành tiền: 5.100.000 ₫\t;GẦN HẾT HÀNG\n\nTổng cộng:\t\t\t\t\t\t20.400.000 ₫"
```

### 7.4. Báo giá cho khách (`mode = customer`)

```text
*BÁO GIÁ THÁNG 10*

1. ABC-123 | Laptop ABC - i5/16GB
   BH: BH 12 tháng | SL: 1 | Giá: 16.830.000 ₫

2. DEF-456 | Màn hình DEF
   BH: BH 24 tháng | SL: 2 | Giá: 2.805.000 ₫

Tổng cộng: 22.440.000 ₫
```

### 7.5. Báo giá nhanh

```json
"*KHÁCH HỎI CẤU HÌNH VĂN PHÒNG*\n\n1. CPU_I5_13400F\t;\tCPU Intel Core i5 13400F\tBH 36 tháng\t;\t4.080.000 fv - SL: 2 (Tổng: 8.160.000 fv)\t;SẴN HÀNG\n\n2. RTX 4060\n↳ (Thay thế): VGA_RTX4060\t;\tVGA Asus RTX 4060\tBH 36 tháng\t;\t8.500.000 fv\t;CHECK KHO CHỜ NHẬP HÀNG\nGiá đã bao gồm VAT."
```

Quy tắc:

- Dòng thường: `{STT}. {MÃ}<TAB>;<TAB>{DIỄN GIẢI}<TAB>{BH}<TAB>;<TAB>{GIÁ} fv{ - SL: n}{ (Tổng: ... fv)}<TAB>;{TÌNH TRẠNG}`
- Dòng thay thế: dòng 1 là yêu cầu khách, dòng 2 `↳ (Thay thế):`.
- `SL` chỉ hiện khi `> 1`.
- Cuối text: `globalNote`, sau đó `zaloSuffix`.

### 7.6. Cấu hình máy ráp

```json
"1-CPU_I5_13400F\t;\t13400F\tCPU Intel i5 13400F\tBH 36 tháng\t;\tĐơn giá: 4.080.000 fv\t;\tSL: 1\t;\tThành tiền: 4.080.000 ₫\t;SẴN HÀNG\n\n2-VGA_RTX4060\t;\tRTX4060\tVGA Asus RTX 4060\tBH 36 tháng\t;\tĐơn giá: 8.500.000 fv\t;\tSL: 2\t;\tThành tiền: 17.000.000 ₫\t;GẦN HẾT HÀNG\n\nTổng cộng:\t\t\t\t\t\t21.080.000 ₫"
```

Nếu `includeSpecs=true`, nối thêm:

```text
*THÔNG SỐ KỸ THUẬT:*
- CPU: i5 13400F
- VGA: RTX 4060
```

### 7.7. Quy tắc bảo hành

- `12` → `BH 12 tháng`
- `24` → `BH 24 tháng`
- `36` → `BH 36 tháng`
- `3` → `BH 3 năm`
- `3 YEAR` → `BH 3 YEAR`
- Rỗng → `""`

---

## 8. TypeScript interfaces cho FE

```ts
export type QuoteStatus = 'draft' | 'sent' | 'won' | 'lost' | 'cancelled';
export type QuoteMode = 'standard' | 'build' | 'single' | 'customer';
export type MatchType = 'exact' | 'replacement' | 'equivalent' | 'custom';

export interface PricingRules {
  lowPriceThreshold: number;
  lowPriceMargin: number;
  highPriceMarkupPercent: number;
  customerMarkupPercent: number;
  roundTo: number;
}

export interface SaleQuoteSettings {
  id: number | null;
  userId: number;
  pricingRules: PricingRules;
  defaultWarranty: string;
  defaultStatusText: string;
  defaultGlobalNote: string;
  zaloSuffix: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CatalogProduct {
  id: number;
  productCode: string;
  productName: string;
  descriptionText: string;
  brand: { id: number; name: string } | null;
  category: { id: number; catName: string } | null;
  costPrice: number | null;
  suggestedPrice: number | null;
  displayPrice: number | null;
  marginAmount: number | null;
  marginPercent: number | null;
  warranty: string | null;
  stock: number;
  isInStock: boolean;
  isActive: boolean;
  syncedAt: string | null;
  updatedAt: string;
}

export interface SaleQuoteItem {
  id: number;
  quoteId: number;
  productId: number | null;
  productCode: string | null;
  pn: string | null;
  name: string | null;
  description: string | null;
  warranty: string | null;
  costPrice: number | null;
  unitPrice: number | null;
  quantity: number;
  lineTotal: number | null;
  statusText: string | null;
  note: string | null;
  sortOrder: number;
  isManual: boolean;
  metadata: Record<string, any> | null;
  customerPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleQuote {
  id: number;
  quoteCode: string;
  title: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  saleUserId: number;
  saleUser?: { id: number; fullName?: string; username: string };
  status: QuoteStatus;
  mode: QuoteMode;
  globalNote: string | null;
  zaloSuffix: string | null;
  totalAmount: number;
  hasUnpricedItems: boolean;
  metadata: Record<string, any> | null;
  sentAt: string | null;
  items: SaleQuoteItem[];
  customerTotal: number;
  pricingRules: PricingRules;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaleQuickCaseItem {
  id: number;
  caseId: number;
  requestText: string | null;
  matchType: MatchType;
  productId: number | null;
  productCode: string | null;
  pn: string | null;
  description: string | null;
  warranty: string | null;
  costPrice: number | null;
  salePrice: number | null;
  quantity: number;
  lineTotal: number | null;
  statusText: string | null;
  note: string | null;
  sortOrder: number;
  customerPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleQuickCase {
  id: number;
  ownerUserId: number;
  ownerUser?: { id: number; fullName?: string; username: string };
  title: string | null;
  customerName: string | null;
  customerPhone: string | null;
  globalNote: string | null;
  status: QuoteStatus;
  totalAmount: number;
  hasUnpricedItems: boolean;
  metadata: Record<string, any> | null;
  items: SaleQuickCaseItem[];
  pricingRules: PricingRules;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SaleBuildItem {
  id: number;
  buildId: number;
  productId: number | null;
  productCode: string | null;
  pn: string | null;
  name: string | null;
  description: string | null;
  warranty: string | null;
  costPrice: number | null;
  salePrice: number | null;
  quantity: number;
  lineTotal: number | null;
  statusText: string | null;
  note: string | null;
  sortOrder: number;
  isManual: boolean;
  customerPrice: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleBuild {
  id: number;
  ownerUserId: number;
  ownerUser?: { id: number; fullName?: string; username: string };
  name: string;
  folder: string;
  description: string | null;
  specs: Array<{ label: string; value: string }> | null;
  isShared: boolean;
  isTemplate: boolean;
  totalAmount: number;
  hasUnpricedItems: boolean;
  sortOrder: number;
  items: SaleBuildItem[];
  pricingRules: PricingRules;
  itemCount?: number;
  createdAt: string;
  updatedAt: string;
}
```

---

## 9. Kế hoạch triển khai FE

### 9.1. Route và tab

Một route mới, ví dụ `/dashboard/(sale)/quote-tool`, gồm 3 tab:

| Tab | Module HTML | API chính |
|---|---|---|
| Báo giá | Báo Giá Tổng Hợp | `/quotes`, `/quotes/:id/items`, `/quotes/:id/text`, `/quotes/:id/export` |
| Báo giá nhanh | Công Cụ Báo Giá Nhanh Zalo | `/quick-cases`, `/quick-cases/bulk`, `/catalog`, `/pricing/preview` |
| Máy ráp | Danh Mục Máy Ráp | `/builds`, `/builds/:id/items`, `/catalog` |

### 9.2. Component

**Tab Báo giá:**

- `QuoteList`: danh sách, filter trạng thái, tìm kiếm.
- `QuoteEditor`: header khách hàng + bảng dòng.
- `QuoteTextPreview`: chọn mode `standard`/`single`/`build`/`customer`, gọi `/text`, copy.
- `QuoteExport`: `/export?type=internal|customer`.

**Tab Báo giá nhanh:**

- `QuickCaseList`: danh sách case.
- `QuickCaseEditor`: header + bảng dòng yêu cầu/sản phẩm.
- `BulkInput`: textarea nhiều dòng → `/quick-cases/bulk`.
- `QuickCaseTextPreview`, `QuickCaseExport`.

**Tab Máy ráp:**

- `BuildList`: card grid theo folder.
- `BuildEditor`: header + bảng linh kiện + `SpecsEditor`.
- Copy text (kèm/không kèm specs), export Excel.

**Dùng chung:**

- `ProductPicker`: search debounce 250ms, hiển thị giá vốn/giá bán/tồn kho.
- `MoneyInput`: hiển thị `1.000.000`, parse về number.
- `SettingsDialog`: pricing rules, default warranty/status, suffix Zalo.

### 9.3. API client

```ts
import { api } from '@/lib/api';

export const saleQuotesApi = {
  getSettings: () => api.get('/sale-quotes/settings').then(r => r.data),
  updateSettings: (data: any) =>
    api.patch('/sale-quotes/settings', data).then(r => r.data),

  searchCatalog: (params: any) =>
    api.get('/sale-quotes/catalog', { params }).then(r => r.data),
  previewPricing: (items: any[]) =>
    api.post('/sale-quotes/pricing/preview', { items }).then(r => r.data),

  createQuote: (data: any) =>
    api.post('/sale-quotes/quotes', data).then(r => r.data),
  getQuotes: (params: any) =>
    api.get('/sale-quotes/quotes', { params }).then(r => r.data),
  updateQuoteItem: (quoteId: number, itemId: number, data: any) =>
    api.patch(`/sale-quotes/quotes/${quoteId}/items/${itemId}`, data).then(r => r.data),
  getQuoteText: (id: number, params?: any) =>
    api.get(`/sale-quotes/quotes/${id}/text`, { params }).then(r => r.data),

  createQuickCase: (data: any) =>
    api.post('/sale-quotes/quick-cases', data).then(r => r.data),
  createQuickCaseBulk: (data: any) =>
    api.post('/sale-quotes/quick-cases/bulk', data).then(r => r.data),
  getQuickCases: (params: any) =>
    api.get('/sale-quotes/quick-cases', { params }).then(r => r.data),
  updateQuickCaseItem: (caseId: number, itemId: number, data: any) =>
    api.patch(`/sale-quotes/quick-cases/${caseId}/items/${itemId}`, data).then(r => r.data),
  getQuickCaseText: (id: number, params?: any) =>
    api.get(`/sale-quotes/quick-cases/${id}/text`, { params }).then(r => r.data),

  createBuild: (data: any) =>
    api.post('/sale-quotes/builds', data).then(r => r.data),
  getBuilds: (params: any) =>
    api.get('/sale-quotes/builds', { params }).then(r => r.data),
  getBuildFolders: () =>
    api.get('/sale-quotes/builds/folders').then(r => r.data),
  updateBuildItem: (buildId: number, itemId: number, data: any) =>
    api.patch(`/sale-quotes/builds/${buildId}/items/${itemId}`, data).then(r => r.data),
  getBuildText: (id: number, params?: any) =>
    api.get(`/sale-quotes/builds/${id}/text`, { params }).then(r => r.data),
};
```

Xuất Excel:

```ts
const res = await api.get(`/sale-quotes/quotes/${id}/export`, {
  params: { type: 'customer' },
  responseType: 'blob',
});
const url = URL.createObjectURL(res.data);
const a = document.createElement('a');
a.href = url;
a.download = `bao-gia-${id}.xlsx`;
a.click();
URL.revokeObjectURL(url);
```

### 9.4. Checklist FE

- [ ] Types trong `types/sale-quotes.ts`.
- [ ] API client.
- [ ] Tab Báo giá: list, tạo mới, sửa dòng, chọn mode text, copy, export.
- [ ] Tab Báo giá nhanh: list, tạo mới, nhập nhiều dòng, map sản phẩm, copy, export.
- [ ] Tab Máy ráp: list theo folder, tạo/sửa, specs động, copy, export.
- [ ] ProductPicker dùng chung.
- [ ] Settings dialog.
- [ ] Phân quyền UI: `view` chỉ đọc, admin xem tất cả.
- [ ] Test copy lên Zalo/SaleTracker thật.

---

## 10. Edge cases

1. **Sản phẩm trùng `product_code`**: catalog có thể trả nhiều dòng cùng mã; quote/case/build lưu `product_id` + snapshot nên vẫn chính xác.
2. **Không có giá**: `costPrice = null` → `CALL`; vẫn thêm được.
3. **Tồn kho 0**: `stock = 0`, `isInStock = false`; `statusText` mặc định `CHECK KHO NHẬP 1 BUỔI / 1 NGÀY`.
4. **Sản phẩm ngừng đồng bộ**: `is_active = false` → không còn trong catalog; quote/case/build cũ vẫn giữ snapshot.
5. **Xoá mềm**: quote/case/build dùng `deleted_at`; list/find tự loại trừ.
6. **Chia sẻ**: chỉ build có `isShared`; quote và case luôn riêng tư.
7. **Giá khách**: luôn tính lại từ giá bán + `customerMarkupPercent`; không lưu DB.
8. **Text copy**: backend trả tab thật; FE dùng `<pre>` hoặc `white-space: pre-wrap`.
9. **Sửa sản phẩm trong dòng**: nếu gửi `productId` mới mà không gửi giá, backend tự tính lại giá đề xuất.
10. **Nhập nhiều dòng**: `rawText` tách theo `\n`; dòng trống bị bỏ qua.

---

## 11. Triển khai

### 11.1. Điều kiện

- Backend trỏ đúng database.
- `synchronize: true` đang bật.
- Backup database trước khi restart.

### 11.2. Restart

```bash
cd U:/saletracker_backend
npm run build
npm run start:prod
```

TypeORM tự tạo 7 bảng:

```sql
SHOW TABLES LIKE 'sale_%';
```

Kỳ vọng (trong module này):

```text
sale_build_items
sale_builds
sale_quick_quote_cases
sale_quick_quote_items
sale_quote_items
sale_quote_settings
sale_quotes
```

Nếu trước đó đã từng chạy phiên bản 12 bảng, có thể xoá các bảng không dùng:

```sql
DROP TABLE IF EXISTS sale_copy_logs;
DROP TABLE IF EXISTS sale_invoice_items;
DROP TABLE IF EXISTS sale_price_history;
DROP TABLE IF EXISTS sale_price_overrides;
DROP TABLE IF EXISTS sale_product_specs;
```

Chỉ chạy `DROP` sau khi chắc chắn các bảng đó không có dữ liệu thật.

### 11.3. Kiểm tra nhanh

```bash
TOKEN="..."

# Settings
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/sale-quotes/settings

# Catalog
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/sale-quotes/catalog?search=i5&page=1&pageSize=5"

# Tạo báo giá chuẩn
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Test","items":[{"productId":1234,"quantity":1}]}' \
  http://localhost:4000/sale-quotes/quotes

# Lấy text báo giá
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/sale-quotes/quotes/1/text

# Tạo case báo giá nhanh
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Test","items":[{"productId":1234,"requestText":"i5","quantity":1}]}' \
  http://localhost:4000/sale-quotes/quick-cases

# Tạo cấu hình máy ráp
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"PC Test","items":[{"productId":1234,"quantity":1}]}' \
  http://localhost:4000/sale-quotes/builds
```

### 11.4. Cron giá/tồn kho

- Cron hiện tại: `CRON_PRODUCT_TIME=0 */6 * * *`.
- Cập nhật `products.price`, `products.stock`, `products.is_in_stock`.
- Module này chỉ đọc `products`, không ghi.
- Log: `logs/productv2cronjobservice-YYYY-MM-DD.log`.

---

## 12. Checklist kiểm thử

1. Tạo báo giá 2 dòng, copy mode `standard` đúng format.
2. Mode `single` chỉ có dòng đầu, không số thứ tự.
3. Mode `build` có `Đơn giá`, `SL`, `Thành tiền`, `Tổng cộng`.
4. Mode `customer` giá đã cộng 10%, không có tình trạng kho.
5. Export Excel quote `internal`/`customer` mở được.
6. Tạo case báo giá nhanh 2 sản phẩm → text Zalo đúng.
7. Dòng không có giá → text có `CALL`.
8. `quantity = 2` → text có `- SL: 2` và `(Tổng: ... fv)`.
9. Dòng `replacement` → text có `↳ (Thay thế):`.
10. `globalNote`/`zaloSuffix` nối đúng quy tắc từng mode.
11. Sale B không thấy quote/case của Sale A (`404`).
12. Build `isShared = true` → Sale B thấy nhưng không sửa được.
13. Role `view` gọi POST/PATCH/DELETE → `403`.
14. Admin thấy tất cả.
15. Build có specs → copy text kèm `*THÔNG SỐ KỸ THUẬT:*`.
16. Build export Excel có phần specs.
17. Sản phẩm `is_active = false` không còn trong catalog.
18. Cron 6 giờ cập nhật giá/tồn kho → catalog trả giá mới.

---

## 13. Phase 2 (nếu cần)

- Upload/ảnh sản phẩm cho quote/case/build.
- Chuyển báo giá thành đơn hàng.
- Realtime khi nhiều sale sửa cùng build.
- AI parse yêu cầu khách thành dòng báo giá.
