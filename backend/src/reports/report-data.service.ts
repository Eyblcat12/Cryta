import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { AssetsService } from '../assets/assets.service';
import { listAudit } from '../audit/audit.controller';
import type { AuthUser } from '../common/auth-user';
import { RequestsService } from '../requests/requests.service';

export const reportDatasets = ['ASSETS', 'REQUESTS', 'AUDIT'] as const;
export const reportFormats = ['CSV', 'PDF'] as const;
export type ReportDataset = typeof reportDatasets[number];
export type ReportFormat = typeof reportFormats[number];
export type ReportFilters = Record<string, string>;
export type ReportScope = { mode: 'OWN' | 'DEPARTMENTS' | 'GLOBAL'; departments: string[] };

export const reportLimits: Record<ReportFormat, number> = { CSV: 10_000, PDF: 1_000 };
const orderFilters = ['sortBy', 'sortOrder'];
const filterKeys: Record<ReportDataset, ReadonlySet<string>> = {
  ASSETS: new Set(['status', 'search', 'ownedOnly', 'eligible', 'approvalScope', ...orderFilters]),
  REQUESTS: new Set(['status', 'type', 'emergency', 'search', 'excludePending', 'createdByMe', 'approvalScope', 'departmentId', 'from', 'to', ...orderFilters]),
  AUDIT: new Set(['search', 'actor', 'action', 'entity', 'outcome', 'requestId', 'correlationId', 'from', 'to', ...orderFilters]),
};
const titles: Record<ReportDataset, string> = {
  ASSETS: 'Danh mục tài sản', REQUESTS: 'Danh sách yêu cầu', AUDIT: 'Nhật ký kiểm toán',
};
const headers: Record<ReportDataset, string[]> = {
  ASSETS: ['Mã tài sản', 'Loại', 'Đơn vị', 'Trạng thái', 'Hiệu lực từ', 'Hết hạn'],
  REQUESTS: ['Mã yêu cầu', 'Loại', 'Đơn vị', 'Trạng thái', 'Khẩn cấp', 'Thời điểm gửi', 'Hoàn tất'],
  AUDIT: ['Mã sự kiện', 'Hành động', 'Loại đối tượng', 'Kết quả', 'Thời điểm'],
};

export function reportFilters(dataset: ReportDataset, input: Record<string, unknown> = {}): ReportFilters {
  const values = Object.entries(input);
  if (values.some(([key, value]) => !filterKeys[dataset].has(key) || typeof value !== 'string' || value.length > 100)) {
    throw new BadRequestException({ code: 'REPORT_FILTER_INVALID', message: 'Bộ lọc báo cáo không hợp lệ.' });
  }
  return Object.fromEntries(values) as ReportFilters;
}

export function reportScope(user: AuthUser, dataset: ReportDataset, filters: ReportFilters): ReportScope {
  if (dataset === 'AUDIT' && !user.roles.includes('ADMIN')) {
    throw new ForbiddenException({ code: 'ADMIN_REQUIRED', message: 'Chỉ Security Admin được xuất Audit Log.' });
  }
  if (filters.approvalScope === 'true' && !user.roles.includes('APPROVER')) {
    throw new ForbiddenException({ code: 'APPROVER_REQUIRED', message: 'Bạn cần quyền phê duyệt để dùng bộ lọc này.' });
  }
  if ((dataset === 'ASSETS' && filters.ownedOnly === 'true') || (dataset === 'REQUESTS' && filters.createdByMe === 'true')) {
    return { mode: 'OWN', departments: [] };
  }
  if (user.roles.includes('ADMIN') && filters.approvalScope !== 'true') return { mode: 'GLOBAL', departments: [] };
  if (user.roles.includes('APPROVER')) return { mode: 'DEPARTMENTS', departments: [...user.approverDepartmentIds].sort() };
  return { mode: 'OWN', departments: [] };
}

export function sameReportScope(left: ReportScope, right: ReportScope) {
  return left.mode === right.mode && left.departments.join(',') === right.departments.join(',');
}

export function reportTimeZone() {
  const timeZone = process.env.APP_TIME_ZONE ?? 'Asia/Ho_Chi_Minh';
  new Intl.DateTimeFormat('vi-VN', { timeZone });
  return timeZone;
}

type Reader = Pick<Pool, 'query'>;
type SourceRow = Record<string, unknown>;
export type ReportData = { title: string; headers: string[]; rows: string[][]; total: number; timeZone: string };

@Injectable()
export class ReportDataService {
  constructor(private readonly assets: AssetsService, private readonly requests: RequestsService) {}

  async read(reader: Reader, user: AuthUser, dataset: ReportDataset, filters: ReportFilters, limit: number): Promise<ReportData> {
    const query = { ...filters, page: '1', pageSize: String(limit) };
    const result = dataset === 'ASSETS' ? await this.assets.list(user, query, reader, limit)
      : dataset === 'REQUESTS' ? await this.requests.list(user, query, reader, limit)
        : await listAudit(reader, user, query, limit);
    if (Array.isArray(result)) throw new Error('REPORT_LIST_UNEXPECTED');
    const timeZone = reportTimeZone();
    const formatter = new Intl.DateTimeFormat('vi-VN', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
    const date = (value: unknown) => value instanceof Date || typeof value === 'string'
      ? formatter.format(new Date(value)) : '';
    const rowFor = (row: SourceRow): unknown[] => {
      if (dataset === 'ASSETS') return [row.code, row.type, row.departmentName, row.status, date(row.validFrom), date(row.expiresAt)];
      if (dataset === 'REQUESTS') return [row.id, row.type, row.departmentName, row.status, row.emergency ? 'Có' : 'Không',
        date(row.submittedAt), date(row.completedAt)];
      return [row.id, row.action, row.entityType, row.outcome, date(row.occurredAt)];
    };
    return { title: titles[dataset], headers: headers[dataset], total: result.total, timeZone,
      rows: result.items.map(row => rowFor(row).map(cell => cell == null ? '' : String(cell))) };
  }
}
