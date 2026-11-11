export type ReportDataset = 'ASSETS' | 'REQUESTS' | 'AUDIT';
export type ReportFormat = 'CSV' | 'PDF';
export type ReportFilters = Record<string, string | undefined>;
export type ReportScope = { mode: 'OWN' | 'DEPARTMENTS' | 'GLOBAL'; departments: string[] };
export type ReportPreview = { total: number; timeZone: string; scope: ReportScope; limits: Record<ReportFormat, number> };
export type ReportJob = {
  id: string;
  dataset: ReportDataset;
  format: ReportFormat;
  scope: ReportScope;
  state: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  rowCount: number | null;
  failureCode: string | null;
};
