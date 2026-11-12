import type { DashboardData,DashboardSummary } from '../../dashboardTypes';
import type { AssetResponse } from './assets';

export interface DashboardSummaryResponse extends Omit<DashboardSummary,'metrics'> {
  // PostgreSQL numeric aggregates can be strings; the API client normalizes them.
  metrics:Record<string,number|string>;
}
export interface DashboardResponse extends DashboardSummaryResponse {
  trend:DashboardData['trend']; composition:DashboardData['composition'];
  trendTimeZone?: DashboardData['trendTimeZone'];
  lifecycle?:Omit<NonNullable<DashboardData['lifecycle']>,'priority'>&{priority:AssetResponse|null};
}
