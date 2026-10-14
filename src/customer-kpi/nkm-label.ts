/**
 * Cắt nhãn nhân viên NKM. Nhãn do API quý trả về và file tra mã đều dùng cùng
 * một dạng: `NKDS33-NGUYỄN CHÍ ĐẠO` — mã nhân viên nằm TRƯỚC dấu `-` ĐẦU TIÊN.
 *
 * Tách riêng chỗ này vì cả client API lẫn service nạp bảng tra đều cần, và quy
 * tắc "dấu gạch đầu tiên" phải nhất quán: họ tên có thể chứa nhiều dấu gạch
 * (`NKDS12-ĐÀO-CẨM TÚ`) mà cắt sai chỗ là nối nhầm mã nhân viên.
 */

/** `NKDS12-ĐÀO CẨM TÚ` → `NKDS12` (không có dấu gạch thì coi cả nhãn là mã). */
export const employeeCodeOfLabel = (label: string): string => {
  const raw = (label ?? '').trim();
  const dash = raw.indexOf('-');
  return (dash > 0 ? raw.slice(0, dash) : raw).trim().toUpperCase();
};

/** `NKDS12-ĐÀO CẨM TÚ` → `ĐÀO CẨM TÚ`; không có phần tên → `null`. */
export const saleNameOfLabel = (label: string): string | null => {
  const raw = (label ?? '').trim();
  const dash = raw.indexOf('-');
  const name = dash > 0 ? raw.slice(dash + 1).trim() : '';
  return name || null;
};
