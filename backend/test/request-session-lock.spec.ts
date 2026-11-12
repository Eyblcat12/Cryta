import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AuthUser } from '../src/common/auth-user';
import { RequestsService } from '../src/requests/requests.service';
import type { NotificationsService } from '../src/notifications/notifications.service';
const user:AuthUser={id:'owner',email:'owner@example.test',displayName:'Owner',departmentId:'old',tokenVersion:1,roles:['USER'],approverDepartmentIds:[],mustChangePassword:false};
describe('request mutation authority after account changes',()=>{
  for(const action of ['create','save','submit','cancel','decide'])it.each([
    ['missing',null],['inactive',{status:'INACTIVE',token_version:1,is_active:true}],
    ['version changed',{status:'ACTIVE',token_version:2,is_active:true}],['inactive department',{status:'ACTIVE',token_version:1,is_active:false}],
  ])(`blocks ${action} when the actor is %s`,async(_name,row)=>{
    const query=vi.fn(async(sql:string)=>({rows:sql.includes('SELECT u.status,u.token_version')&&row?[row]:[],rowCount:row?1:0})),release=vi.fn();
    const service=new RequestsService({connect:async()=>({query,release})} as unknown as Pool,{} as NotificationsService);
    const result=action==='create'?service.create(user,{type:'CREATE',policyVersionId:'policy',reason:'Valid request reason',parameters:{},emergency:false}):action==='save'?service.saveDraft(user,'request',{type:'CREATE'}):action==='submit'?service.submitDraft(user,'request',1):action==='cancel'?service.cancel(user,'request'):service.decide(user,'request',{decision:'APPROVED',version:'1'});
    await expect(result).rejects.toMatchObject({status:401,response:{code:'SESSION_REVOKED'}});
    expect(query.mock.calls.some(([sql])=>/^(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');expect(release).toHaveBeenCalledOnce();
  });
});
