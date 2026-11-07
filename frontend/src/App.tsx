import {
CheckCircle2,
X
} from 'lucide-react';
import { useCallback,useEffect,useRef,useState } from 'react';
import { useBeforeUnload,useLocation,useNavigate } from 'react-router';
import { api } from './api';
import { LoginScreen } from './LoginScreen';
import { canOpenView,pageTitles,workspaceView } from './routes';
import { useRouteMotion } from './useRouteMotion';

import { AppShell } from './AppShell';
import { detailReturn } from './detailNavigation';
import { initialRevisions } from './workspaceRefresh';
import { useWorkspaceMutations } from './useWorkspaceMutations';
import { dismissMutation,mutationSuccess } from './workspaceMutations';
import type { WorkspaceResource } from './workspaceRefresh';
import { CreateUserDialog,DecisionDialog,HelpDialog,PasswordChangeDialog } from './WorkspaceDialogs';
import type { WorkspacePageContext } from './WorkspacePage';
import type { RequestType,Theme } from './WorkspaceUi';
import { useAuthSession } from './useAuthSession';
import { workspaceSearch,workspaceSearchUrl } from './workspaceSearch';
import { schedulePageTitleFocus } from './pageFocus';
function App() {
  const location=useLocation();
  const navigate=useNavigate();
  const view=workspaceView(location.pathname);
  const [theme, setTheme] = useState<Theme>(() =>
    (window.localStorage.getItem('crypta-theme') as Theme | null) ?? 'light',
  );
  const [mobileNav, setMobileNav] = useState(false);
  const clearSessionRef=useRef<()=>void>(()=>{});
  const session=useAuthSession(()=>clearSessionRef.current());
  const {sessionState,user,role,authNotice}=session;
  const [roleMenu, setRoleMenu] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [decisionModal, setDecisionModal] = useState<{ action: 'APPROVE' | 'REJECT'; requestId: string; version:number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [createUserModal,setCreateUserModal]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [revisions,setRevisions]=useState(initialRevisions);
  const operations=useWorkspaceMutations();
  const handledMutations=useRef(new Set<string>());
  const unresolved=operations.some(item=>item.owner===user?.id&&item.phase!=='confirmed');
  useBeforeUnload(useCallback(event=>{if(unresolved){event.preventDefault();event.returnValue=''}},[unresolved]));
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const routeAllowed = sessionState === 'READY' && !!user && !user.mustChangePassword
    && view !== 'forbidden' && view !== 'not-found' && canOpenView(role, view,user.roles);
  const isDetailRoute = view!=='request-new'&&/^\/(assets|requests)\/[^/]+\/?$/.test(location.pathname);
  const mainMotionRef = useRouteMotion({
    scope: `${sessionState}:${user?.id ?? ''}:${role}:${session.revision}:${!!user?.mustChangePassword}`,
    page: view,
    enabled: routeAllowed && !isDetailRoute && !['forbidden', 'not-found'].includes(view)
      && import.meta.env.VITE_ROUTE_MOTION !== 'off',
  });
  const clearSessionData = () => {
    handledMutations.current.clear();
    setRevisions(initialRevisions);setDecisionModal(null);setCreateUserModal(false);
    setHelpOpen(false);setRoleMenu(false);setMobileNav(false);setToast(null);setGlobalQuery('');
  };
  clearSessionRef.current=clearSessionData;
  const revalidateData=async(resources:readonly WorkspaceResource[])=>{
    setRevisions(current=>{const next={...current};for(const resource of new Set(resources))next[resource]++;return next});
  };
  useEffect(()=>{
    if(sessionState!=='READY'||!user||user.mustChangePassword)return;
    for(const item of operations){
      if(item.owner!==user.id||item.phase==='pending')continue;
      const key=`${item.id}:${item.phase}:${item.reviewedAt??0}`;
      if(handledMutations.current.has(key))continue;
      handledMutations.current.add(key);void revalidateData(item.resources);
      if(item.phase==='confirmed'){setToast(mutationSuccess[item.kind]);dismissMutation(item.id)}
    }
  },[operations,sessionState,user?.id,user?.mustChangePassword]);

  useEffect(()=>{
    if(sessionState!=='READY'||!user||user.mustChangePassword)return;
    if(!canOpenView(role,view,user.roles)&&view!=='forbidden'){navigate('/forbidden',{replace:true,state:{from:location.pathname}})}
  },[location.pathname,navigate,role,sessionState,user,view]);

  // A blocked navigation has not committed a new location yet, so drafts stay open.
  useEffect(()=>{setCreateUserModal(false);setDecisionModal(null)},[location.pathname,location.search]);

  useEffect(()=>{
    document.title=user?.mustChangePassword?'Đổi mật khẩu · Crypta':`${pageTitles[view]} · Crypta`;
    if(sessionState!=='READY'||!user||user.mustChangePassword||isDetailRoute)return;
    return schedulePageTitleFocus();
  },[sessionState,user?.id,user?.mustChangePassword,role,session.revision,view,isDetailRoute]);

  const closeDetail=()=>{
    if(user&&detailReturn(location.state,user.id,role)){navigate(-1);return}
    navigate(view==='assets'?'/assets':role==='APPROVER'?'/approvals':'/requests',{replace:true});
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('crypta-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        globalSearchRef.current?.focus();
      }
      if (event.key === 'Escape') setRoleMenu(false);
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  const openRequest = (type: RequestType = 'CREATE', assetId?: string) => {
    const params=new URLSearchParams();
    if(type!=='CREATE')params.set('type',type);
    if(assetId)params.set('assetId',assetId);
    navigate(`/requests/new${params.size?`?${params}`:''}`);
  };

  const changeRole=session.changeRole;

  const submitGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = globalQuery.trim();
    if (!value) return;
    if(!user)return;
    navigate(workspaceSearchUrl(workspaceSearch(view,role,user.roles).path,location,value));
  };

  if(sessionState==='LOADING') return <main className="session-loading" role="status"><span className="loading-spinner"/><strong>Đang khôi phục phiên an toàn…</strong></main>;
  if(sessionState==='UNAVAILABLE')return <main className="session-loading"><div role="alert"><strong>Chưa thể xác minh phiên đăng nhập</strong><p>{session.restoreError}</p></div><button className="secondary-button" onClick={session.retryRestore}>Thử khôi phục phiên</button></main>;
  if(sessionState==='GUEST'||!user) return <LoginScreen notice={authNotice} onLogin={session.acceptUser}/>;
  if(user.mustChangePassword)return <PasswordChangeDialog onLogout={session.logout} onSuccess={session.changePassword}/>;
  const context:WorkspacePageContext={view,role,user,routeAllowed,scope:`${user.id}:${role}:${session.revision}`,revisions,onCloseDetail:closeDetail,openRequest,onReload:revalidateData,onNotify:setToast,onCreateUser:()=>setCreateUserModal(true),onSessionAccepted:session.acceptUser,onDecision:(action,requestId,version)=>setDecisionModal({action,requestId,version})};
  return <AppShell key={context.scope} context={context} theme={theme} setTheme={setTheme} mobileNav={mobileNav} setMobileNav={setMobileNav} roleMenu={roleMenu} setRoleMenu={setRoleMenu} globalQuery={globalQuery} setGlobalQuery={setGlobalQuery} globalSearchRef={globalSearchRef} mainMotionRef={mainMotionRef} submitGlobalSearch={submitGlobalSearch} changeRole={changeRole} setHelpOpen={setHelpOpen} onLogout={session.logout}>
      {decisionModal && <DecisionDialog action={decisionModal.action} requestId={decisionModal.requestId} onClose={() => setDecisionModal(null)} onSuccess={async(action, requestId,note) => {
        const submittedModal=decisionModal;
        await api.decide(requestId,{decision:action==='APPROVE'?'APPROVED':'REJECTED',comment:note||undefined,version:String(submittedModal.version)});setDecisionModal(current=>current===submittedModal?null:current);
      }} />}
      {createUserModal&&<CreateUserDialog invitation={user.accountActionsEnabled===true} onClose={()=>setCreateUserModal(false)} onSuccess={async()=>{setCreateUserModal(false)}}/>}
      {helpOpen&&<HelpDialog onClose={()=>setHelpOpen(false)}/>}
      {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={16} /></button></div>}
  </AppShell>;
}

export default App;
