// Transaction Statistics Interface for optimized backend computation

export interface TransactionStatsParams {
  period: 'day' | 'week' | 'quarter' | 'custom';
  dateFrom?: string; // YYYY-MM-DD format
  dateTo?: string;   // YYYY-MM-DD format
  employees?: string; // comma-separated employee IDs
  departments?: string; // comma-separated department IDs
  user: any; // for permission filtering
}

export interface SummaryStats {
  // Current period stats
  chaoBan: number; // completed + quoted
  completed: number;
  quoted: number;
  demand: number;
  pending: number;
  confirmed: number;
  totalRevenue: number;
  avgOrderValue: number;
  conversionRate: number; // completed / (completed + quoted) * 100
  
  // Working days stats
  gdToday: number;
  gdYesterday: number;
  gd2DaysAgo: number;
  
  // Previous period stats for comparison
  prevChaoBan: number;
  prevCompleted: number;
  prevQuoted: number;
  prevDemand: number;
  prevPending: number;
  prevTotalRevenue: number;
  prevAvgOrderValue: number;
  prevConversionRate: number;
}

export interface ChartDataPoint {
  name: string; // period name (e.g., "01/09/2025" or "Tuần 01/09-06/09")
  timestamp: number;
  demand: number;
  completed: number;
  quoted: number;
  pending: number;
  confirmed: number;
}

export interface CustomerStat {
  name: string;
  total: number;
  completed: number;
  quoted: number;
  pending: number;
  demand: number;
  confirmed: number;
}

export interface EmployeeStat {
  id: number;
  name: string;
  orders: number;
  customers: number; // unique customers count
  completed: number;
  quoted: number;
  conversion: number; // percentage
}

export interface ExpiredStats {
  expiredToday: number;
  overdue: number;
}

export interface TransactionStatsResponse {
  summary: SummaryStats;
  chartData: ChartDataPoint[];
  customerStats: CustomerStat[];
  employeeStats: EmployeeStat[];
  expiredStats: ExpiredStats;
  
  // Meta info
  totalRecords: number;
  dateRange: {
    from: string;
    to: string;
  };
  previousDateRange: {
    from: string;
    to: string;
  };
}

// Detail data for bar chart click
export interface TransactionDetailParams {
  period: 'day' | 'week' | 'quarter' | 'custom';
  dateFrom?: string;
  dateTo?: string;
  timestamp: number; // specific period timestamp
  status?: string; // filter by specific status
  user: any;
  page?: number; // pagination page number (default: 1)
  limit?: number; // items per page (default: 20)
}

export interface TransactionDetailItem {
  id: number;
  order_id: number;
  customer_name: string;
  employee_name: string;
  product_name: string;
  status: string;
  unit_price: number;
  quantity: number;
  total_value: number;
  created_at: string;
  order_created_at?: string;
}

// Helper types for internal calculations
export interface WorkingDaysInfo {
  day0: Date; // most recent working day
  day1: Date; // 1 day before
  day2: Date; // 2 days before
}

export interface DateRangePair {
  current: { from: Date; to: Date };
  previous: { from: Date; to: Date };
}