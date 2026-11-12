import {
Bell,
Check,
ChevronDown,
CircleHelp,
ClipboardList,
Database,
FileText,
KeyRound,
LayoutDashboard,
LogOut,
Menu,
Moon,
MoreHorizontal,
Plus,
Search,
Send,
Settings,
ShieldAlert,
ShieldCheck,
Sun,
Users,
X
} from 'lucide-react';
import type { ReactNode } from 'react';
import { NavLink,useNavigate } from 'react-router';
import { useLocation } from 'react-router';
import { useCallback,useEffect,useLayoutEffect,useRef } from 'react';
import type { UserRole } from './types';

import { Outlet } from 'react-router';
import { WorkspaceMutationNotices } from './MutationNotice';
import { useWorkspaceScroll } from './useWorkspaceScroll';
import type { WorkspacePageContext } from './WorkspacePage';
import type { Theme } from './WorkspaceUi';
import { roleMeta } from './WorkspaceUi';
import { api } from './api';
import { workspaceSearch } from './workspaceSearch';
import { useResource } from './useResource';
import { useDelayedPending } from './useDelayedPending';
type AppShellProps = {
  context: WorkspacePageContext;
  theme: Theme; setTheme: (theme: Theme) => void;
  mobileNav: boolean; setMobileNav: (open: boolean) => void;
  roleMenu: boolean; setRoleMenu: React.Dispatch<React.SetStateAction<boolean>>;
  globalQuery: string; setGlobalQuery: (query: string) => void;
  globalSearchRef: React.RefObject<HTMLInputElement>;
  mainMotionRef: React.RefObject<HTMLElement>;
  submitGlobalSearch: (event: React.FormEvent) => void;
  changeRole: (role: UserRole) => void;
  setHelpOpen: (open: boolean) => void;
  onLogout: () => Promise<void>;
  children: ReactNode;
};
export function AppShell({ context, theme, setTheme, mobileNav, setMobileNav, roleMenu, setRoleMenu, globalQuery, setGlobalQuery, globalSearchRef, mainMotionRef, submitGlobalSearch, changeRole, setHelpOpen, onLogout, children }: AppShellProps) {
  const navigate = useNavigate();
  const location=useLocation();
  const sidebarRef=useRef<HTMLDivElement>(null);
  const workspaceRef=useRef<HTMLDivElement>(null);
  const overlaysRef=useRef<HTMLDivElement>(null);
  const skipLinkRef=useRef<HTMLAnchorElement>(null);
  const mobileTriggerRef=useRef<HTMLButtonElement>(null);
  const currentPath=useRef(location.pathname);
  const menuOpenedAt=useRef<string|null>(null);
  const restoreMobileTrigger=useRef(false);
  const dismissMobileNav=useCallback(()=>{restoreMobileTrigger.current=true;setMobileNav(false)},[setMobileNav]);
  useLayoutEffect(()=>{currentPath.current=location.pathname},[location.pathname]);
  useLayoutEffect(()=>{
    if(mobileNav)menuOpenedAt.current=currentPath.current;
    const media=window.matchMedia('(max-width: 820px)');
    const update=()=>{
      const sidebar=sidebarRef.current;
      const workspace=workspaceRef.current;
      const overlays=overlaysRef.current;
      const skipLink=skipLinkRef.current;
      if(!sidebar||!workspace||!overlays||!skipLink)return;
      const open=media.matches&&mobileNav;
      if(open){
        sidebar.inert=false;
        sidebar.removeAttribute('aria-hidden');
        sidebar.setAttribute('role','dialog');
        sidebar.setAttribute('aria-modal','true');
        if(!sidebar.contains(document.activeElement))sidebar.querySelector<HTMLElement>('nav a[href]')?.focus({preventScroll:true});
      }
      for(const background of [workspace,overlays,skipLink]){
        background.inert=open;
        if(open)background.setAttribute('aria-hidden','true');
        else background.removeAttribute('aria-hidden');
      }
      if(open)return;
      sidebar.setAttribute('role','complementary');
      sidebar.removeAttribute('aria-modal');
      const samePage=menuOpenedAt.current===null||menuOpenedAt.current===currentPath.current;
      if(media.matches&&(restoreMobileTrigger.current||(samePage&&sidebar.contains(document.activeElement))))
        mobileTriggerRef.current?.focus({preventScroll:true});
      sidebar.inert=media.matches&&!mobileNav;
      if(media.matches&&!mobileNav)sidebar.setAttribute('aria-hidden','true');
      else sidebar.removeAttribute('aria-hidden');
      if(!mobileNav){menuOpenedAt.current=null;restoreMobileTrigger.current=false}
      if(!media.matches&&mobileNav)setMobileNav(false);
    };
    update();media.addEventListener('change',update);return()=>{media.removeEventListener('change',update)};
  },[mobileNav,setMobileNav]);
  useEffect(()=>{
    if(!mobileNav)return;
    const controls=()=>Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled])')??[]);
    const keydown=(event:KeyboardEvent)=>{
      if(event.key!=='Tab'&&event.key!=='Escape')return;
      const activeDialog=Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"]')).at(-1);
      if(activeDialog!==sidebarRef.current)return;
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissMobileNav();return}
      const items=controls(),first=items[0],last=items.at(-1);
      if(!sidebarRef.current?.contains(document.activeElement)||(event.shiftKey&&document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){
        event.preventDefault();(event.shiftKey?last:first)?.focus();
      }
    };
    const onHistoryNavigation=()=>setMobileNav(false);
    document.addEventListener('keydown',keydown,true);
    window.addEventListener('popstate',onHistoryNavigation);
    return()=>{document.removeEventListener('keydown',keydown,true);window.removeEventListener('popstate',onHistoryNavigation)};
  },[mobileNav,dismissMobileNav,setMobileNav]);
  useLayoutEffect(()=>{setMobileNav(false);setRoleMenu(false)},[location.key,setMobileNav,setRoleMenu]);
  const { user, role } = context;
  const searchTarget=workspaceSearch(context.view,role,user.roles);
  const summary=useResource(`${context.scope}:summary`,signal=>api.dashboardSummary(role,signal),context.revisions.summary);
  const unread=useResource(`${context.scope}:unread`,signal=>api.notificationPage({page:1,pageSize:1,read:false},signal),context.revisions.notifications);
  const navAssetCount=summary.data?.metrics.total_assets??summary.data?.metrics.total??null;
  const navPendingRequestCount=summary.data?.metrics.pending??null;
  const unreadNotificationCount=unread.data?.total??null;
  const showDataPending=useDelayedPending(summary.loading||unread.loading,context.scope);
  const pageContext={...context,summary,unreadNotificationCount};
  useWorkspaceScroll(`${user.id}:${role}`);
  const initials = user.displayName.split(/\s+/).slice(-2).map(part => part[0]).join('').toUpperCase();
  const currentRole = {...roleMeta[role],name:user.displayName,initials,department:user.departmentName ?? 'Chưa có phòng ban'};
  return (
    <div className="app-shell">
      <a ref={skipLinkRef} className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      <div ref={sidebarRef} id="workspace-navigation" className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} role="complementary" aria-label="Điều hướng chính">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><ShieldCheck size={21} /></span>
          <span className="brand-name">Crypta</span>
          <span className="brand-env">Secure</span>
          {mobileNav && <button className="icon-button" aria-label="Đóng điều hướng" onClick={dismissMobileNav}><X size={19}/></button>}
        </div>

        <nav className="nav-groups" onClick={event=>{
          if(mobileNav&&event.defaultPrevented&&event.target instanceof Element&&event.target.closest('a[href]'))setMobileNav(false);
        }}>
          <div className="nav-group">
            <p className="nav-label">Không gian làm việc</p>
            <NavLink to="/dashboard" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
              <LayoutDashboard size={19} /> Tổng quan
            </NavLink>
            {role === 'USER' && <>
              <NavLink to="/assets" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <KeyRound size={19} /> Tài sản của tôi <span className="nav-count">{navAssetCount??'—'}</span>
              </NavLink>
              <NavLink to="/requests" end={context.view==='request-new'} className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <FileText size={19} /> Yêu cầu <span className="nav-count nav-count-warn">{navPendingRequestCount??'—'}</span>
              </NavLink>
              {!user.roles.includes('ADMIN')&&<NavLink to="/requests/new" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <Plus size={19} /> Tạo yêu cầu
              </NavLink>}
            </>}
            {role === 'APPROVER' && <>
              <NavLink to="/assets" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <KeyRound size={19} /> Tài sản trong phạm vi
              </NavLink>
              {!user.roles.includes('ADMIN')&&<NavLink to="/approvals" end className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <ClipboardList size={19} /> Hàng chờ phê duyệt <span className="nav-count nav-count-warn">{navPendingRequestCount??'—'}</span>
              </NavLink>}
              <NavLink to="/approvals/history" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <FileText size={19} /> Lịch sử quyết định
              </NavLink>
            </>}
            {role === 'ADMIN' && <>
              <NavLink to="/assets" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <Database size={19} /> Tài sản toàn hệ thống <span className="nav-count">{navAssetCount??'—'}</span>
              </NavLink>
              <NavLink to="/policies" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <Settings size={19} /> Chính sách
              </NavLink>
              <NavLink to="/users" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <Users size={19} /> Người dùng &amp; vai trò
              </NavLink>
              <NavLink to="/audit" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <ClipboardList size={19} /> Audit Log
              </NavLink>
              <NavLink to="/operations/email" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <Send size={19} /> Vận hành email
              </NavLink>
              <NavLink to="/operations/provider" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
                <ShieldAlert size={19} /> Đối soát provider
              </NavLink>
            </>}
          </div>
          <div className="nav-group">
            <p className="nav-label">Theo dõi</p>
            <NavLink to="/notifications" className={({isActive})=>`nav-item ${isActive?'nav-item-active':''}`}>
              <Bell size={19} /> Thông báo {(unreadNotificationCount??0)>0&&<span className="unread-dot" aria-label={`${unreadNotificationCount} thông báo chưa đọc`} />}
            </NavLink>
            <button className="nav-item" onClick={() => {setMobileNav(false);setHelpOpen(true)}}>
              <CircleHelp size={19} /> Trợ giúp
            </button>
          </div>
        </nav>

        <div className="security-note">
          <div className="security-icon"><ShieldCheck size={17} /></div>
          <div>
            <strong>Phiên được bảo vệ</strong>
            <span>Cookie HttpOnly · refresh rotation</span>
          </div>
        </div>

        <button className="profile-card" aria-label="Mở menu tài khoản" onClick={()=>{setMobileNav(false);setRoleMenu(open=>!open)}} aria-expanded={roleMenu}>
          <span className="avatar">{currentRole.initials}</span>
          <span className="profile-copy">
            <strong>{currentRole.name}</strong>
            <small>{currentRole.label} · {currentRole.department}</small>
          </span>
          <MoreHorizontal size={18} />
        </button>
      </div>

      {mobileNav && <div className="scrim" aria-hidden="true" onClick={dismissMobileNav} />}

      <div ref={workspaceRef} className="workspace">
        <header className="topbar">
          <button ref={mobileTriggerRef} className="icon-button mobile-menu" aria-label="Mở điều hướng" aria-controls="workspace-navigation" aria-haspopup="dialog" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}>
            <Menu size={21} />
          </button>
          <form className="global-search" role="search" onSubmit={submitGlobalSearch}>
            <Search size={18} aria-hidden="true" />
            <input ref={globalSearchRef} value={globalQuery} maxLength={100} onChange={(event) => setGlobalQuery(event.target.value)} aria-label={searchTarget.label} placeholder={`${searchTarget.label}…`} />
            <kbd>Ctrl K</kbd>
          </form>
          <div className="topbar-actions">
            <button className="icon-button" aria-label={`Chuyển sang giao diện ${theme === 'light' ? 'tối' : 'sáng'}`}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button className={`icon-button ${(unreadNotificationCount??0)>0?'has-alert':''}`} aria-label={(unreadNotificationCount??0)>0?`${unreadNotificationCount} thông báo chưa đọc`:'Thông báo'} onClick={() => navigate('/notifications')}>
              <Bell size={19} />{(unreadNotificationCount??0)>0&&<span />}
            </button>
            {user.mfaEnrolled && <button className="icon-button" aria-label="Bảo mật tài khoản" onClick={() => navigate('/account/security')}><ShieldCheck size={18}/></button>}
            <button className="icon-button" aria-label="Đăng xuất" onClick={onLogout}><LogOut size={18}/></button>
            <div className="topbar-divider" />
            <div className="role-control">
              <button className="role-switcher" aria-label={`Vai trò hiện tại: ${currentRole.label}`} aria-expanded={roleMenu} aria-haspopup="menu" onClick={() => setRoleMenu((open) => !open)}>
                <span className="role-icon"><ShieldCheck size={16} /></span>
                <span><small>Vai trò hiện tại</small><strong>{currentRole.label}</strong></span>
                <ChevronDown size={16} />
              </button>
              {roleMenu && <div className="role-menu" role="menu" aria-label="Chuyển vai trò demo">
                {user.roles.map((value) => (
                  <button key={value} role="menuitemradio" aria-checked={role === value} onClick={() => changeRole(value)}>
                    <span className="role-option-icon">{initials}</span>
                    <span><strong>{roleMeta[value].label}</strong><small>{user.departmentName??'Chưa có phòng ban'}</small></span>
                    {role === value && <Check size={16} aria-hidden="true" />}
                  </button>
                ))}
              </div>}
            </div>
          </div>
        </header>

        <div className="route-sync-status" role="status" aria-live="polite" aria-atomic="true">
          {showDataPending&&<span><span className="loading-spinner" aria-hidden="true"/> Đang cập nhật chỉ số điều hướng…</span>}
        </div>
        <main ref={mainMotionRef} id="main-content" className="main-content" tabIndex={-1}>
          {summary.error&&<div className="data-banner data-banner-error" role="alert"><span>Chỉ số điều hướng: {summary.error}</span><button onClick={summary.retry}>Thử lại</button></div>}
          {unread.error&&<div className="data-banner data-banner-error" role="alert"><span>Thông báo: {unread.error}</span><button onClick={unread.retry}>Thử lại</button></div>}
          <WorkspaceMutationNotices user={user} role={role}/>
          <Outlet context={pageContext}/>
          <footer className="app-footer"><span>Crypta · Quản lý vòng đời mật mã</span><span>Dữ liệu đồng bộ từ máy chủ</span></footer>
        </main>
      </div>

      <div ref={overlaysRef}>{children}</div>
    </div>
  );
}
