export type WeeklyPromotion = {
  type: "weekly";
  day_of_week: number;      // 0 = Chủ nhật, 1 = Thứ 2, ..., 6 = Thứ 7
  time_of_day: string;      // định dạng "HH:mm:ss"
};