import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../src/common/auth-user';
import { encodeReportCsv } from '../src/reports/report-csv';
import { reportFilters, reportScope } from '../src/reports/report-data.service';
import { encodeReportPdf } from '../src/reports/report-pdf';

const actor: AuthUser = {
  id: 'actor', email: 'actor@example.test', displayName: 'Tên người dùng', departmentId: 'd1',
  tokenVersion: 1, roles: ['ADMIN', 'APPROVER'], approverDepartmentIds: ['d2', 'd1'], mustChangePassword: false,
};

describe('Report export boundaries', () => {
  it('uses the selected view scope and rejects role escalation or arbitrary filters', () => {
    expect(reportScope(actor, 'ASSETS', {})).toEqual({ mode: 'GLOBAL', departments: [] });
    expect(reportScope(actor, 'ASSETS', { approvalScope: 'true' })).toEqual({ mode: 'DEPARTMENTS', departments: ['d1', 'd2'] });
    expect(reportScope(actor, 'REQUESTS', { createdByMe: 'true' })).toEqual({ mode: 'OWN', departments: [] });
    expect(() => reportScope({ ...actor, roles: ['USER'] }, 'AUDIT', {})).toThrow();
    expect(() => reportScope({ ...actor, roles: ['ADMIN'] }, 'ASSETS', { approvalScope: 'true' })).toThrow();
    expect(() => reportFilters('ASSETS', { ownerId: actor.id })).toThrow();
    expect(() => reportFilters('ASSETS', { pageSize: '10000' })).toThrow();
    expect(() => reportFilters('REQUESTS', { status: ['PENDING'] })).toThrow();
  });

  it('exports UTF-8 CSV with explicit text for spreadsheet formula prefixes', () => {
    const values = ['=1+1', ' +2', '\u0000-1', '＠SUM(1)', '\u200b＝1', 'Mã "A", B', 'Hàng\ntrên'];
    const csv = encodeReportCsv({ title: 'Tài sản', headers: ['Cột'], rows: values.map(value => [value]),
      total: values.length, timeZone: 'Asia/Ho_Chi_Minh' }).toString('utf8');
    expect(csv.split('\r\n')).toEqual(['\uFEFF"Cột"', '"Văn bản: =1+1"', '"Văn bản:  +2"', '"Văn bản:  -1"',
      '"Văn bản: ＠SUM(1)"', '"Văn bản:  ＝1"', '"Mã ""A"", B"', '"Hàng trên"', '']);
  });

  it('embeds the report font and creates bounded multiple pages', async () => {
    const file = await encodeReportPdf({ title: 'Nhật ký kiểm toán', headers: ['Mã sự kiện', 'Đơn vị'],
      rows: Array.from({ length: 55 }, (_, index) => [String(index), 'Đơn vị Công nghệ thông tin']),
      total: 55, timeZone: 'Asia/Ho_Chi_Minh' });
    const raw = file.toString('latin1');
    expect(raw.startsWith('%PDF')).toBe(true);
    expect(raw).toContain('/FontFile2');
    expect([...raw.matchAll(/\/Type \/Page\b/g)].length).toBeGreaterThan(1);
    expect([...raw.matchAll(/\/Type \/Page\b/g)].length).toBeLessThan(8);
  });
});
