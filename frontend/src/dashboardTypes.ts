import type { Asset,UserRole } from './types';
export interface DashboardSummary {
  role: UserRole;
  metrics: Record<string,number>;
  services?: {email:'ENABLED'|'DISABLED';cryptoProvider:string;expiryScan:string};
}
export interface DashboardData extends DashboardSummary {
  trend: Array<{period:string;value:number}>;
  trendTimeZone?: string;
  composition: Array<{label:string;value:number}>;
  lifecycle?: {live:number;within30:number;within180:number;after180:number;priority:Asset|null};
}
