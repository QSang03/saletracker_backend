/**
 * Multer/busboy đọc header `filename` của request multipart dạng latin1, nên
 * tên file tiếng Việt gửi UTF-8 bị vỡ thành mojibake
 * ("DSKH KDS_CHÍNH PHá»¤_KEY NON.xlsx" thay vì "...CHÍNH PHỤ...") và lưu sai
 * như thế vào DB. Chuyển ngược byte về UTF-8 khi chuỗi chỉ chứa ký tự latin1
 * và giải mã không sinh ký tự lỗi; các trường hợp còn lại (tên ASCII, hoặc
 * chuỗi latin1 thật không phải UTF-8) giữ nguyên.
 */
export function decodeUploadedFileName(rawName: string): string {
  if (!rawName || !/[\u0080-\u00ff]/.test(rawName)) return rawName;
  const decoded = Buffer.from(rawName, 'latin1').toString('utf8');
  // Chuỗi không giải mã được UTF-8 hợp lệ → toString sinh U+FFFD → giữ nguyên
  return decoded.includes('\ufffd') ? rawName : decoded;
}
