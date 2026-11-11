import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation, useNavigate } from 'react-router';
import { api, ApiError, subscribeSession } from './api';
import { safeSessionReturn, sessionDestination, sessionPermissions } from './sessionRouting';
import type { AuthUser, UserRole } from './types';

export function useAuthSession(onClear:()=>void) {
  const location=useLocation();
  const navigate=useNavigate();
  const [user,setUser]=useState<AuthUser|null>(null);
  const [role,setRole]=useState<UserRole>('USER');
  const [sessionState,setSessionState]=useState<'LOADING'|'GUEST'|'READY'|'UNAVAILABLE'>('LOADING');
  const [restoreError,setRestoreError]=useState('');
  const [restoreAttempt,setRestoreAttempt]=useState(0);
  const [authNotice,setAuthNotice]=useState('');
  const [revision,setRevision]=useState(0);
  const live=useRef({user,role,sessionState,location,onClear});
  live.current={user,role,sessionState,location,onClear};
  const requested=()=>live.current.location.pathname==='/login'
    ?safeSessionReturn(live.current.location.state?.returnTo)
    :safeSessionReturn(live.current.location.pathname+live.current.location.search);
  const acceptUser=(current:AuthUser)=>{
    const destination=sessionDestination(current.roles,requested());
    onClear();setAuthNotice('');setRevision(value=>value+1);setUser(current);setRole(destination.role);setSessionState('READY');
    if(!current.mustChangePassword)navigate(destination.path,{replace:true,state:null});
  };
  const guest=(notice:string,path:string|null,loading=false)=>{
    // Remove page/form blockers before forced session navigation. It cannot be canceled.
    flushSync(()=>{live.current.onClear();setUser(null);setRevision(value=>value+1);setSessionState(loading?'LOADING':'GUEST');setAuthNotice(notice)});
    navigate('/login',{replace:true,state:path?{returnTo:path}:null});
  };
  useEffect(()=>{
    let current=true;
    const unsubscribe=subscribeSession(event=>{
      if(!current)return;
      if(event.type==='expired'){
        guest('Phiên đăng nhập đã hết hạn hoặc bị thu hồi. Hãy đăng nhập lại để tiếp tục.',requested());return;
      }
      const previous=live.current;
      if(previous.sessionState!=='READY'||!previous.user)return;
      if(sessionPermissions(previous.user)!==sessionPermissions(event.user)){
        const destination=sessionDestination(event.user.roles,requested());
        flushSync(()=>{previous.onClear();setRevision(value=>value+1);setUser(event.user);setRole(destination.role)});
        if(!event.user.mustChangePassword)navigate(destination.path,{replace:true,state:null});
      }else setUser(event.user);
    });
    const oidc=new URLSearchParams(location.search).get('oidc');
    const restoring=location.pathname==='/login'&&(oidc==='complete'||oidc==='denied')
      ?Promise.resolve(null):api.restore();
    void restoring.then(restored=>{
      if(!current)return;
      if(!restored){setSessionState('GUEST');return}
      const destination=sessionDestination(restored.roles,requested());
      setUser(restored);setRole(destination.role);setSessionState('READY');
      if(!restored.mustChangePassword&&(location.pathname==='/'||location.pathname==='/login'))navigate(destination.path,{replace:true,state:null});
    }).catch(error=>{
      if(!current)return;
      if(error instanceof ApiError&&error.status===401){setSessionState('GUEST');return}
      setRestoreError(error instanceof ApiError?error.message:'Không thể xác minh phiên. Hãy thử lại khi kết nối ổn định.');setSessionState('UNAVAILABLE');
    });
    return()=>{current=false;unsubscribe()};
  },[restoreAttempt]);

  useEffect(()=>{
    if(sessionState!=='READY'||!user||user.mustChangePassword)return;
    if(location.pathname==='/'||location.pathname==='/login'){
      navigate(sessionDestination(user.roles,requested()).path,{replace:true,state:null});
    }
  },[sessionState,user?.id,user?.mustChangePassword,location.pathname]);

  const requestedRole=location.pathname==='/dashboard'?location.state?.switchRole:undefined;
  const switchingRole=!!user&&requestedRole!==role&&user.roles.includes(requestedRole);
  useEffect(()=>{
    if(!switchingRole||!user)return;
    api.abandonWorkspaceRequests();
    onClear();setRole(requestedRole);setRevision(value=>value+1);
    navigate('/dashboard',{replace:true,state:null});
  },[switchingRole,requestedRole,user?.id]);

  const logout=async()=>{
    const path=requested();
    const pending=api.logout();
    guest('',path,true);
    try{const result=await pending;if(result?.redirect)window.location.assign(result.redirect)}
    catch{setAuthNotice('Phiên trên trình duyệt đã kết thúc. Hãy thử lại khi kết nối ổn định nếu cần xác nhận đăng xuất.')}
    finally{setSessionState('GUEST')}
  };
  const changePassword=async(currentPassword:string,newPassword:string)=>{
    const path=requested();
    await api.changePassword(currentPassword,newPassword);
    guest('Hãy đăng nhập lại bằng mật khẩu mới.',path);
  };
  const changeRole=(nextRole:UserRole)=>{
    if(!user?.roles.includes(nextRole)||nextRole===role)return;
    // The form blocker owns this navigation; an "Ở lại" leaves role and URL unchanged.
    navigate('/dashboard',{state:{switchRole:nextRole}});
  };
  const retryRestore=()=>{setRestoreError('');setSessionState('LOADING');setRestoreAttempt(value=>value+1)};
  return {user,role,sessionState:switchingRole?'LOADING' as const:sessionState,authNotice,restoreError,retryRestore,revision,acceptUser,logout,changePassword,changeRole};
}
