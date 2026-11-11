import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { describe, it, expect, vi } from 'vitest';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

function setup(mustChangePassword:boolean, allowed=false, tokenVersion=1) {
  const request={headers:{authorization:'Bearer test'}};
  type Dependencies = ConstructorParameters<typeof JwtAuthGuard>;
  const guard=new JwtAuthGuard(
    {verifyAsync:vi.fn().mockResolvedValue({sub:'user',tokenVersion})} as unknown as Dependencies[0],
    {getUserById:vi.fn().mockResolvedValue({id:'user',tokenVersion:1,mustChangePassword})} as unknown as Dependencies[1],
    {getAllAndOverride:()=>allowed} as unknown as Dependencies[2],
  );
  const context={switchToHttp:()=>({getRequest:()=>request}),getHandler:()=>()=>{},getClass:()=>class {}} as unknown as ExecutionContext;
  return ()=>guard.canActivate(context);
}
describe('mandatory password change',()=>{
  it('blocks business endpoints before password change',async()=>{await expect(setup(true)()).rejects.toMatchObject({response:{code:'PASSWORD_CHANGE_REQUIRED'}})});
  it('allows password recovery endpoints',async()=>{await expect(setup(true,true)()).resolves.toBe(true)});
  it('allows normal accounts',async()=>{await expect(setup(false)()).resolves.toBe(true)});
  it('does not allow revoked tokens even on password endpoints',async()=>{await expect(setup(true,true,0)()).rejects.toMatchObject({response:{code:'SESSION_REVOKED'}})});
});
