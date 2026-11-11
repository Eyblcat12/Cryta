import { canOpenView, workspaceView } from './routes';
import type { UserRole } from './types';

const priority:readonly UserRole[]=['ADMIN','APPROVER','USER'];

export function safeSessionReturn(value:unknown):string|null {
  if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020#]/.test(value))return null;
  const path=value.split('?')[0];
  try{
    for(const part of path.split('/').slice(1)){
      const decoded=decodeURIComponent(part);
      if(decoded==='.'||decoded==='..'||/[/\\%\u0000-\u001f]/.test(decoded))return null;
    }
    const url=new URL(value,'https://crypta.invalid');
    if(url.origin!=='https://crypta.invalid'||url.pathname!==path)return null;
  }catch{return null}
  const view=workspaceView(path);
  return ['forbidden','not-found'].includes(view)||path==='/'||path==='/login'?null:value;
}

export function sessionDestination(roles:readonly UserRole[],requested:unknown):{role:UserRole;path:string} {
  const path=safeSessionReturn(requested);
  const ordered=priority.filter(role=>roles.includes(role));
  const compatible=path?ordered.find(role=>canOpenView(role,workspaceView(path.split('?')[0]),roles)):undefined;
  return {role:compatible??ordered[0]??'USER',path:compatible&&path?path:'/dashboard'};
}

export function sessionPermissions(user:{id:string;roles:UserRole[];departmentId:string;approverDepartmentIds:string[];mustChangePassword:boolean}) {
  return JSON.stringify([user.id,[...user.roles].sort(),user.departmentId,[...user.approverDepartmentIds].sort(),user.mustChangePassword]);
}
