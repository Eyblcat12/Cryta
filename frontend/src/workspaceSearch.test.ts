import { describe,expect,it } from 'vitest';
import { workspaceSearch,workspaceSearchUrl } from './workspaceSearch';
describe('contextual workspace search',()=>{
  it('searches the current supported page instead of changing to the role default',()=>{
    expect(workspaceSearch('users','ADMIN',['ADMIN']).path).toBe('/users');
    expect(workspaceSearch('assets','ADMIN',['ADMIN']).path).toBe('/assets');
    expect(workspaceSearch('assets','APPROVER',['APPROVER']).path).toBe('/assets');
    expect(workspaceSearch('requests','USER',['USER']).path).toBe('/requests');
    expect(workspaceSearch('approval-history','APPROVER',['APPROVER']).path).toBe('/approvals/history');
  });
  it('gives a specific fallback for pages without search and respects Admin SoD',()=>{
    expect(workspaceSearch('policies','ADMIN',['ADMIN'])).toEqual({path:'/audit',label:'Tìm Audit Log'});
    expect(workspaceSearch('access','ADMIN',['ADMIN']).path).toBe('/users');
    expect(workspaceSearch('dashboard','APPROVER',['ADMIN','APPROVER']).path).toBe('/approvals/history');
  });
  it('preserves current filters/pageSize and resets page only on the target list',()=>{
    const url=workspaceSearchUrl('/assets',{pathname:'/assets',search:'?status=ACTIVE&pageSize=50&page=3'},' TLS ');
    const params=new URL('https://local.test'+url).searchParams;
    expect(params.get('status')).toBe('ACTIVE');expect(params.get('pageSize')).toBe('50');expect(params.has('page')).toBe(false);expect(params.get('q')).toBe('TLS');
    expect(workspaceSearchUrl('/assets',{pathname:'/assets/id',search:'?source=bookmark'},'TLS')).toBe('/assets?q=TLS');
  });
});
