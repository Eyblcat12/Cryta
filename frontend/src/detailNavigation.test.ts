import { describe, expect, it } from 'vitest';
import { detailReturn } from './detailNavigation';

describe('detail return context',()=>{
  it('preserves query/page only for the same user and role',()=>{
    const state={returnTo:'/assets?q=TLS&status=EXPIRED&page=3',userId:'owner',role:'USER'};
    expect(detailReturn(state,'owner','USER')).toBe(state.returnTo);
    expect(detailReturn(state,'other','USER')).toBeNull();
    expect(detailReturn(state,'owner','ADMIN')).toBeNull();
  });
  it.each(['https://example.test','//example.test','/login','/assets/id','/users','/assets/../users','/approvals'])('refuses unrelated User destinations: %s',path=>{
    expect(detailReturn({returnTo:path,userId:'owner',role:'USER'},'owner','USER')).toBeNull();
  });
  it('handles direct-link and malformed state safely',()=>{
    for(const state of [null,undefined,'/assets',{}, {returnTo:42,userId:'owner',role:'USER'}]) expect(detailReturn(state,'owner','USER')).toBeNull();
    expect(detailReturn({returnTo:'/approvals/history?page=5',userId:'manager',role:'APPROVER'},'manager','APPROVER')).toBe('/approvals/history?page=5');
  });
  it('returns an Approver to the filtered catalog after navigating lineage and request links',()=>{
    const state={returnTo:'/assets?q=RSA&page=2&status=SUPERSEDED',userId:'manager',role:'APPROVER'};
    expect(detailReturn(state,'manager','APPROVER')).toBe(state.returnTo);
    expect(detailReturn(state,'other','APPROVER')).toBeNull();
    expect(detailReturn(state,'manager','USER')).toBeNull();
  });
});
