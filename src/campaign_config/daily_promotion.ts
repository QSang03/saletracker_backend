export type DailyPromotion = {
  type: "hourly";
  start_time: string; // định dạng "HH:mm:ss"
  end_time: string;   // định dạng "HH:mm:ss"
  remind_after_minutes: number;
};