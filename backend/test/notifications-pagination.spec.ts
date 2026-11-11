import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { NotificationsService } from '../src/notifications/notifications.service';

describe('notification pagination', () => {
  it('scopes count and page to recipient, channel and unread state', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 212 }] } : { rows: [] });
    const service = new NotificationsService({ query } as unknown as Pool);
    const result = await service.list('user-1', { page: '2', pageSize: '10', read: 'false' });
    expect(result).toEqual({ items: [], total: 212, page: 2, pageSize: 10 });
    expect(query.mock.calls[0][0]).toContain("n.recipient_id=$1 AND n.channel='IN_APP' AND n.read_at IS NULL");
    expect(query.mock.calls[1][0]).toContain('ORDER BY n.created_at DESC,n.id DESC LIMIT $2 OFFSET $3');
    expect(query.mock.calls[1][1]).toEqual(['user-1', 10, 10]);
  });

  it('rejects bad filters before querying', async () => {
    const query = vi.fn();
    const service = new NotificationsService({ query } as unknown as Pool);
    await expect(service.list('user-1', { page: '0' })).rejects.toThrow();
    await expect(service.list('user-1', { read: 'unread' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
