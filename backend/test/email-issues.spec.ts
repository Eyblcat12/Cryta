import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { NotificationsController } from '../src/notifications/notifications.controller';
import { NotificationsService } from '../src/notifications/notifications.service';
import type { EmailTestService } from '../src/notifications/email-test.service';

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', departmentId: 'dept-1', tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false };

describe('email delivery issues', () => {
  it('restricts the read-only list to Admin', async () => {
    const service = { deliveryIssues: vi.fn() } as unknown as NotificationsService;
    const controller = new NotificationsController(service, {} as EmailTestService);
    expect(() => controller.issues({ ...admin, roles: ['USER'] }, {})).toThrow();
    expect((service.deliveryIssues as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('pages only problematic email statuses without exposing raw SMTP errors', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 55 }] } : { rows: [{ id: 'n-1', type: 'REQUEST_APPROVED', delivery_status: 'RECONCILIATION_REQUIRED', attempt_count: 1, recipient_email: 'u@example.test', error_message: 'sensitive diagnostic' }] });
    const service = new NotificationsService({ query } as unknown as Pool);
    const result = await service.deliveryIssues({ page: '2', pageSize: '20', status: 'RECONCILIATION_REQUIRED' });
    expect(result).toMatchObject({ total: 55, page: 2, items: [{ id: 'n-1', recipientEmail: 'u@example.test' }] });
    expect(JSON.stringify(result)).not.toContain('sensitive diagnostic');
    expect(query.mock.calls[0][0]).toContain("n.channel='EMAIL' AND n.delivery_status IN ('FAILED','RECONCILIATION_REQUIRED') AND n.delivery_status=$1");
    expect(query.mock.calls[1][0]).toContain('ORDER BY n.created_at DESC,n.id DESC LIMIT $2 OFFSET $3');
    expect(query.mock.calls[1][1]).toEqual(['RECONCILIATION_REQUIRED', 20, 20]);
  });
});
