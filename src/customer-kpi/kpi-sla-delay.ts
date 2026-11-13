/**
 * Số phút trễ so với hạn SLA 2h.
 *
 * - Đã phản hồi: `responded_time - sla_deadline`.
 * - Chưa phản hồi: tính tới hiện tại (độ trễ tiếp tục tăng).
 *
 * Không bao giờ âm; chỉ dùng cho dòng đã vi phạm nên luôn > 0 trên thực tế.
 */
export function slaDelayMinutes(row: {
  sla_deadline: Date | string;
  responded_time: Date | string | null;
}): number {
  const deadline = new Date(row.sla_deadline).getTime();
  const end = row.responded_time
    ? new Date(row.responded_time).getTime()
    : Date.now();
  if (!Number.isFinite(deadline) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - deadline) / 60000));
}
