import { AccountActionsService } from '../src/auth/account-actions.service';
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { UsersService } from '../src/users/users.service';

const admin: AuthUser = { id: 'admin-1', email: 'admin@example.test', displayName: 'Admin', departmentId: 'dept-1', tokenVersion: 1, roles: ['ADMIN'], approverDepartmentIds: [], mustChangePassword: false };

describe('user pagination', () => {
  it('counts before paging IDs and joins access metadata only for selected users', async () => {
    const query = vi.fn(async (sql: string) => sql.includes('COUNT(*)') ? { rows: [{ total: 212 }] } : { rows: [] });
    const service = new UsersService({ query } as unknown as Pool, {} as AccountActionsService);
    const result = await service.listPage(admin, { page: '3', pageSize: '25', status: 'ACTIVE', search: 'Finance' });
    expect(result).toEqual({ items: [], total: 212, page: 3, pageSize: 25 });
    expect(query.mock.calls[0][0]).toContain('u.status=$1 AND (u.display_name ILIKE $2');
    expect(query.mock.calls[0][1]).toEqual(['ACTIVE', '%Finance%']);
    expect(query.mock.calls[1][0]).toContain('ORDER BY u.display_name,u.id LIMIT $3 OFFSET $4');
    expect(query.mock.calls[1][1]).toEqual(['ACTIVE', '%Finance%', 25, 50]);
  });

  it('requires Admin and rejects malformed filters before querying', async () => {
    const query = vi.fn();
    const service = new UsersService({ query } as unknown as Pool, {} as AccountActionsService);
    await expect(service.listPage({ ...admin, roles: ['USER'] }, { page: '1' })).rejects.toThrow();
    await expect(service.listPage(admin, { pageSize: '101' })).rejects.toThrow();
    await expect(service.listPage(admin, { status: 'UNKNOWN' })).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });

  it('looks up the exact user before count and paging, including an ID outside the first page', async () => {
    const query=vi.fn(async()=>({rows:[]}));const service=new UsersService({query} as unknown as Pool, {} as AccountActionsService);
    const id='11111111-2222-3333-4444-555555555555';
    await service.listPage(admin,{page:'1',pageSize:'1',userId:id,status:'ACTIVE'});
    expect(query.mock.calls[0][0]).toContain('WHERE u.id=$1::uuid AND u.status=$2');
    expect(query.mock.calls[0][1]).toEqual([id,'ACTIVE']);
    expect(query.mock.calls[1][1]).toEqual([id,'ACTIVE',1,0]);
  });

  it('matches email exactly with bound parameters rather than partial search', async () => {
    const query=vi.fn(async()=>({rows:[]}));const service=new UsersService({query} as unknown as Pool, {} as AccountActionsService);
    await service.listPage(admin,{pageSize:'1',email:'  PERSON@example.test  '});
    expect(query.mock.calls[0][0]).toContain('WHERE LOWER(u.email)=$1');
    expect(query.mock.calls[0][0]).not.toContain('PERSON');
    expect(query.mock.calls[0][1]).toEqual(['person@example.test']);
  });

  it('rejects malformed or repeated exact filters and checks permission before DB access', async () => {
    const query=vi.fn();const service=new UsersService({query} as unknown as Pool, {} as AccountActionsService);
    for(const filters of [{userId:'bad'},{userId:['11111111-2222-3333-4444-555555555555']},{email:'bad'},{email:['person@example.test']},{email:'x'.repeat(255)+'@example.test'}]){
      await expect(service.listPage(admin,filters as unknown as Record<string,string>)).rejects.toThrow();
    }
    await expect(service.listPage({...admin,roles:['USER']},{email:'person@example.test'})).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
