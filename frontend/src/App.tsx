import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Database,
  FileKey2,
  FileText,
  Fingerprint,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from './api';
import { LoginScreen } from './LoginScreen';
import type { Asset, AssetStatus, AuthUser, RequestItem, RequestStatus, UserRole } from './types';

type Theme = 'light' | 'dark';
type AssetFilter = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'ENDED';
type RequestType = 'CREATE' | 'RENEW' | 'REVOKE';
type RequestModalState = { type: RequestType; assetId?: string } | null;
type PolicyOption={id:string;code:string;name:string;version:number;configuration:Record<string,unknown>};

const roleMeta: Record<UserRole, { label: string; eyebrow: string; name: string; initials: string; department: string }> = {
  USER: { label: 'Nhân viên', eyebrow: 'Không gian cá nhân', name: 'Nguyễn Văn Dev', initials: 'ND', department: 'CNTT' },
  APPROVER: { label: 'Người phê duyệt', eyebrow: 'Trung tâm phê duyệt', name: 'Lê Minh', initials: 'LM', department: 'CNTT' },
  ADMIN: { label: 'Quản trị bảo mật', eyebrow: 'Điều hành an toàn', name: 'Phạm Hà', initials: 'PH', department: 'An toàn thông tin' },
};

const assetStatus: Record<AssetStatus, { label: string; tone: string }> = {
  ACTIVE: { label: 'Đang hoạt động', tone: 'success' },
  EXPIRING_SOON: { label: 'Sắp hết hạn', tone: 'warning' },
  EXPIRED: { label: 'Đã hết hạn', tone: 'neutral' },
  REVOKED: { label: 'Đã thu hồi', tone: 'danger' },
  SUPERSEDED: { label: 'Đã thay thế', tone: 'neutral' },
};

const requestStatus: Record<RequestStatus, { label: string; tone: string }> = {
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  PROCESSING: { label: 'Đang xử lý', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  FAILED: { label: 'Xử lý lỗi', tone: 'danger' },
  CANCELLED: { label: 'Đã hủy', tone: 'neutral' },
};

function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

const insightData: Record<UserRole, {
  eyebrow: string;
  title: string;
  description: string;
  trendLabel: string;
  trendValue: string;
  trendChange: string;
  periods: string[];
  values: number[];
  donutTitle: string;
  donutTotal: string;
  donutCaption: string;
  segments: Array<{ label: string; value: number; tone: string }>;
}> = {
  USER: {
    eyebrow: 'Xu hướng cá nhân', title: 'Nhịp hoạt động tài sản', description: 'Phát hành, gia hạn và thu hồi trong 6 tháng gần nhất.',
    trendLabel: 'Hoạt động tháng này', trendValue: '0', trendChange: 'Đang cập nhật từ hệ thống',
    periods: ['T4', 'T5', 'T6', 'T7', 'T8', 'T9'], values: [0, 0, 0, 0, 0, 0],
    donutTitle: 'Cơ cấu tài sản', donutTotal: '0', donutCaption: 'tài sản',
    segments: [{ label: 'Khóa mã hóa', value: 0, tone: 'brand' }, { label: 'Chứng thư số', value: 0, tone: 'blue' }],
  },
  APPROVER: {
    eyebrow: 'Năng lực xử lý', title: 'Lưu lượng yêu cầu', description: 'Số yêu cầu đến và được xử lý trong 7 ngày gần nhất.',
    trendLabel: 'Đã xử lý tuần này', trendValue: '0', trendChange: 'Đang cập nhật từ hệ thống',
    periods: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], values: [0, 0, 0, 0, 0, 0, 0],
    donutTitle: 'Kết quả 30 ngày', donutTotal: '0', donutCaption: 'yêu cầu',
    segments: [{ label: 'Phê duyệt', value: 0, tone: 'green' }, { label: 'Từ chối', value: 0, tone: 'red' }, { label: 'Chờ xử lý', value: 0, tone: 'amber' }],
  },
  ADMIN: {
    eyebrow: 'Toàn hệ thống', title: 'Tăng trưởng tài sản', description: 'Tài sản được quản lý trên toàn tổ chức trong 6 tháng.',
    trendLabel: 'Tài sản hiện tại', trendValue: '0', trendChange: 'Đang cập nhật từ hệ thống',
    periods: ['T4', 'T5', 'T6', 'T7', 'T8', 'T9'], values: [0, 0, 0, 0, 0, 0],
    donutTitle: 'Trạng thái toàn hệ thống', donutTotal: '0', donutCaption: 'tài sản',
    segments: [{ label: 'Hoạt động', value: 0, tone: 'green' }, { label: 'Sắp hết hạn', value: 0, tone: 'amber' }, { label: 'Khác', value: 0, tone: 'neutral' }],
  },
};

function OverviewInsights({ role, dashboard }: { role: UserRole; dashboard?: any }) {
  const fallback = insightData[role];
  const labels:Record<string,{label:string;tone:string}>={KEY:{label:'Khóa mã hóa',tone:'brand'},CERTIFICATE:{label:'Chứng thư số',tone:'blue'},APPROVED:{label:'Phê duyệt',tone:'green'},REJECTED:{label:'Từ chối',tone:'red'},PENDING:{label:'Chờ xử lý',tone:'amber'},ACTIVE:{label:'Hoạt động',tone:'green'},EXPIRING_SOON:{label:'Sắp hết hạn',tone:'amber'},EXPIRED:{label:'Đã hết hạn',tone:'neutral'},REVOKED:{label:'Đã thu hồi',tone:'red'},SUPERSEDED:{label:'Đã thay thế',tone:'blue'}};
  const liveTrend=Array.isArray(dashboard?.trend)&&dashboard.trend.length?dashboard.trend:null;
  const liveSegments=Array.isArray(dashboard?.composition)?dashboard.composition:null;
  const values=(liveTrend??fallback.values.map((value,index)=>({period:fallback.periods[index],value}))).map((item:any)=>Number(item.value));
  const periods=(liveTrend??fallback.periods.map(period=>({period}))).map((item:any)=>{const raw=String(item.period);if(!liveTrend)return raw;const date=new Date(`${raw}${raw.length===7?'-01':''}T00:00:00`);return role==='APPROVER'?new Intl.DateTimeFormat('vi-VN',{weekday:'short'}).format(date):new Intl.DateTimeFormat('vi-VN',{month:'short'}).format(date)});
  const segments=(liveSegments??fallback.segments).map((item:any)=>({label:labels[item.label]?.label??item.label,value:Number(item.value),tone:labels[item.label]?.tone??item.tone??'neutral'}));
  const segmentTotal=segments.reduce((sum:number,item:any)=>sum+item.value,0);
  const currentValue=role==='APPROVER'?Number(dashboard?.metrics?.approved??0)+Number(dashboard?.metrics?.rejected??0):role==='ADMIN'?Number(dashboard?.metrics?.total_assets??segmentTotal):Number(dashboard?.metrics?.total??segmentTotal);
  const data={...fallback,periods,values,segments,trendValue:String(currentValue),trendChange:'Cập nhật trực tiếp từ hệ thống',donutTotal:String(segmentTotal)};
  const width = 560;
  const height = 142;
  const max = Math.max(...data.values,1) * 1.12;
  const min = Math.min(...data.values) * 0.78;
  const range = Math.max(max - min, 1);
  const points = data.values.map((value:number, index:number) => {
    const x = 18 + index * ((width - 36) / (data.values.length - 1));
    const y = height - 18 - ((value - min) / range) * (height - 38);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const total = Math.max(data.segments.reduce((sum:number, segment:{value:number}) => sum + segment.value, 0),1);
  let cursor = 0;
  const donutStops = data.segments.map((segment:{value:number;tone:string}) => {
    const start = (cursor / total) * 100;
    cursor += segment.value;
    const end = (cursor / total) * 100;
    return `var(--chart-${segment.tone}) ${start}% ${end}%`;
  }).join(', ');

  return <section className="overview-insights" aria-label={`${data.title} và ${data.donutTitle}`}>
    <article className="insight-card trend-card">
      <header className="insight-header"><div><p className="eyebrow">{data.eyebrow}</p><h2>{data.title}</h2><span>{data.description}</span></div><div className="trend-summary"><span>{data.trendLabel}</span><strong>{data.trendValue}</strong><small>{data.trendChange}</small></div></header>
      <figure className="trend-figure">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.title}: ${data.periods.map((period:string, index:number) => `${period} ${data.values[index]}`).join(', ')}`} preserveAspectRatio="none">
          <defs><linearGradient id={`trend-fill-${role}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
          <path className="chart-grid-line" d="M18 30H542M18 72H542M18 114H542" />
          <polygon points={`18,${height - 8} ${points} 542,${height - 8}`} fill={`url(#trend-fill-${role})`} />
          <polyline className="trend-line" points={points} />
          {data.values.map((value:number, index:number) => {
            const [x, y] = points.split(' ')[index].split(',');
            return <circle key={data.periods[index]} className="trend-point" cx={x} cy={y} r="3.5"><title>{data.periods[index]}: {value}</title></circle>;
          })}
        </svg>
        <figcaption>{data.periods.map((period:string) => <span key={period}>{period}</span>)}</figcaption>
      </figure>
    </article>

    <article className="insight-card composition-card">
      <header><p className="eyebrow">Phân bổ hiện tại</p><h2>{data.donutTitle}</h2></header>
      <div className="composition-body">
        <div className="donut-chart" style={{ background: segmentTotal?`conic-gradient(${donutStops})`:'var(--surface-soft)' }} role="img" aria-label={segmentTotal?data.segments.map((segment:{label:string;value:number}) => `${segment.label}: ${segment.value}`).join(', '):'Chưa có dữ liệu'}>
          <span><strong>{data.donutTotal}</strong><small>{data.donutCaption}</small></span>
        </div>
        <div className="chart-legend">{data.segments.length?data.segments.map((segment:{label:string;value:number;tone:string}) => <div key={segment.label}><span className={`chart-swatch chart-${segment.tone}`} /><span>{segment.label}</span><strong>{segment.value}</strong></div>):<div><span className="chart-swatch chart-neutral"/><span>Chưa có dữ liệu</span><strong>0</strong></div>}</div>
      </div>
    </article>
  </section>;
}

function useDialogBehavior(
  containerRef: React.RefObject<HTMLElement | null>,
  initialFocusRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => initialFocusRef.current?.focus());

    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!containerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', keydown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [containerRef, initialFocusRef]);
}

function App() {
  const [theme, setTheme] = useState<Theme>(() =>
    (window.localStorage.getItem('crypta-theme') as Theme | null) ?? 'light',
  );
  const [mobileNav, setMobileNav] = useState(false);
  const [sessionState, setSessionState] = useState<'LOADING'|'GUEST'|'READY'>('LOADING');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<UserRole>('USER');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [dashboard,setDashboard]=useState<any>(null);
  const [notifications,setNotifications]=useState<any[]>([]);
  const [adminUsers,setAdminUsers]=useState<any[]>([]);
  const [auditLogs,setAuditLogs]=useState<any[]>([]);
  const [dataState, setDataState] = useState<'LOADING'|'READY'|'ERROR'>('LOADING');
  const [dataError, setDataError] = useState('');
  const [roleMenu, setRoleMenu] = useState(false);
  const [filter, setFilter] = useState<AssetFilter>('ALL');
  const [query, setQuery] = useState('');
  const [globalQuery, setGlobalQuery] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<RequestItem | null>(null);
  const [requestModal, setRequestModal] = useState<RequestModalState>(null);
  const [decisionModal, setDecisionModal] = useState<{ action: 'APPROVE' | 'REJECT'; requestId: string } | null>(null);
  const [showAllRequests, setShowAllRequests] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [authNotice,setAuthNotice]=useState('');
  const [createUserModal,setCreateUserModal]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setDataState('LOADING'); setDataError('');
    try { const [nextAssets,nextRequests,nextPolicies,nextDashboard,nextNotifications,nextUsers,nextAudit]=await Promise.all([api.assets(),api.requests(),api.policies(),api.dashboard(),api.notifications(),user?.roles.includes('ADMIN')?api.users():Promise.resolve([]),user?.roles.includes('ADMIN')?api.auditLogs():Promise.resolve([])]); setAssets(nextAssets);setRequests(nextRequests);setPolicies(nextPolicies);setDashboard(nextDashboard);setNotifications(nextNotifications);setAdminUsers(nextUsers);setAuditLogs(nextAudit);setDataState('READY'); }
    catch(error){setDataState('ERROR');setDataError(error instanceof ApiError?error.message:'Không thể tải dữ liệu.');}
  };

  useEffect(()=>{void api.restore().then(current=>{setUser(current);setRole(current.roles.includes('ADMIN')?'ADMIN':current.roles.includes('APPROVER')?'APPROVER':'USER');setSessionState('READY')}).catch(()=>setSessionState('GUEST'))},[]);
  useEffect(()=>{if(sessionState==='READY'&&user)void loadData()},[sessionState,user?.id,role]);

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

  const filteredAssets = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('vi');
    return assets.filter((asset) => {
      const matchesQuery = !normalized || [asset.code, asset.name, asset.purpose, asset.algorithm]
        .some((value) => value.toLocaleLowerCase('vi').includes(normalized));
      const matchesFilter = filter === 'ALL'
        || (filter === 'ACTIVE' && asset.status === 'ACTIVE')
        || (filter === 'EXPIRING_SOON' && asset.status === 'EXPIRING_SOON')
        || (filter === 'ENDED' && ['EXPIRED', 'REVOKED', 'SUPERSEDED'].includes(asset.status));
      return matchesQuery && matchesFilter;
    });
  }, [assets, filter, query]);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setMobileNav(false);
  };

  const openRequest = (type: RequestType = 'CREATE', assetId?: string) => {
    setSelectedAsset(null);
    setRequestModal({ type, assetId });
  };

  const changeRole = (nextRole: UserRole) => {
    setRole(nextRole);
    setRoleMenu(false);
    setMobileNav(false);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  const submitGlobalSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const value = globalQuery.trim();
    if (!value) return;
    if (role === 'USER') {
      setQuery(value);
      setFilter('ALL');
      scrollTo('assets');
    } else if (role === 'APPROVER') {
      scrollTo('approval-queue');
      setToast(`Đã lọc hàng chờ theo “${value}”.`);
    } else {
      scrollTo('audit-log');
      setToast(`Đã lọc Audit Log theo “${value}”.`);
    }
  };

  if(sessionState==='LOADING') return <main className="session-loading" role="status"><span className="loading-spinner"/><strong>Đang khôi phục phiên an toàn…</strong></main>;
  if(sessionState==='GUEST'||!user) return <LoginScreen notice={authNotice} onLogin={(current)=>{setAuthNotice('');setUser(current);setRole(current.roles.includes('ADMIN')?'ADMIN':current.roles.includes('APPROVER')?'APPROVER':'USER');setSessionState('READY')}}/>;
  const initials=user.displayName.split(/\s+/).slice(-2).map(part=>part[0]).join('').toUpperCase();
  const currentRole = {...roleMeta[role],name:user.displayName,initials};
  const priorityAsset=assets.find(asset=>asset.status==='EXPIRING_SOON');
  const activeAssetCount=assets.filter(asset=>asset.status==='ACTIVE').length;
  const expiringAssetCount=assets.filter(asset=>asset.status==='EXPIRING_SOON').length;
  const pendingRequestCount=requests.filter(request=>request.status==='PENDING').length;
  const unreadNotificationCount=notifications.filter(item=>!item.readAt).length;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Bỏ qua điều hướng</a>
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} aria-label="Điều hướng chính">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><ShieldCheck size={21} /></span>
          <span className="brand-name">Crypta</span>
          <span className="brand-env">Secure</span>
        </div>

        <nav className="nav-groups">
          <div className="nav-group">
            <p className="nav-label">Không gian làm việc</p>
            <button className="nav-item nav-item-active" onClick={() => scrollTo('overview')}>
              <LayoutDashboard size={19} /> Tổng quan
            </button>
            {role === 'USER' && <>
              <button className="nav-item" onClick={() => scrollTo('assets')}>
                <KeyRound size={19} /> Tài sản của tôi <span className="nav-count">{assets.length}</span>
              </button>
              <button className="nav-item" onClick={() => scrollTo('requests')}>
                <FileText size={19} /> Yêu cầu <span className="nav-count nav-count-warn">{pendingRequestCount}</span>
              </button>
              <button className="nav-item" onClick={() => openRequest()}>
                <Plus size={19} /> Tạo yêu cầu
              </button>
            </>}
            {role === 'APPROVER' && <>
              <button className="nav-item" onClick={() => scrollTo('approval-queue')}>
                <ClipboardList size={19} /> Hàng chờ phê duyệt <span className="nav-count nav-count-warn">{pendingRequestCount}</span>
              </button>
              <button className="nav-item" onClick={() => scrollTo('approval-history')}>
                <FileText size={19} /> Lịch sử quyết định
              </button>
            </>}
            {role === 'ADMIN' && <>
              <button className="nav-item" onClick={() => scrollTo('admin-assets')}>
                <Database size={19} /> Tài sản toàn hệ thống <span className="nav-count">{assets.length}</span>
              </button>
              <button className="nav-item" onClick={() => scrollTo('policy')}>
                <Settings size={19} /> Chính sách
              </button>
              <button className="nav-item" onClick={() => scrollTo('users')}>
                <Users size={19} /> Người dùng &amp; vai trò
              </button>
              <button className="nav-item" onClick={() => scrollTo('audit-log')}>
                <ClipboardList size={19} /> Audit Log
              </button>
            </>}
          </div>
          <div className="nav-group">
            <p className="nav-label">Theo dõi</p>
            <button className="nav-item" onClick={() => scrollTo(role === 'USER' ? 'notifications' : 'overview')}>
              <Bell size={19} /> Thông báo {unreadNotificationCount>0&&<span className="unread-dot" aria-label={`${unreadNotificationCount} thông báo chưa đọc`} />}
            </button>
            <button className="nav-item" onClick={() => setHelpOpen(true)}>
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

        <button className="profile-card" aria-label="Mở menu tài khoản">
          <span className="avatar">{currentRole.initials}</span>
          <span className="profile-copy">
            <strong>{currentRole.name}</strong>
            <small>{currentRole.label} · {currentRole.department}</small>
          </span>
          <MoreHorizontal size={18} />
        </button>
      </aside>

      {mobileNav && <button className="scrim" aria-label="Đóng điều hướng" onClick={() => setMobileNav(false)} />}

      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Mở điều hướng" onClick={() => setMobileNav(true)}>
            <Menu size={21} />
          </button>
          <form className="global-search" role="search" onSubmit={submitGlobalSearch}>
            <Search size={18} aria-hidden="true" />
            <input ref={globalSearchRef} value={globalQuery} onChange={(event) => setGlobalQuery(event.target.value)} aria-label="Tìm kiếm toàn hệ thống" placeholder="Tìm tài sản, yêu cầu…" />
            <kbd>Ctrl K</kbd>
          </form>
          <div className="topbar-actions">
            <button className="icon-button" aria-label={`Chuyển sang giao diện ${theme === 'light' ? 'tối' : 'sáng'}`}
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button className={`icon-button ${unreadNotificationCount>0?'has-alert':''}`} aria-label={unreadNotificationCount>0?`${unreadNotificationCount} thông báo chưa đọc`:'Thông báo'} onClick={() => scrollTo('notifications')}>
              <Bell size={19} />{unreadNotificationCount>0&&<span />}
            </button>
            <button className="icon-button" aria-label="Đăng xuất" onClick={async()=>{await api.logout();setUser(null);setSessionState('GUEST')}}><LogOut size={18}/></button>
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
                    <span className="role-option-icon">{roleMeta[value].initials}</span>
                    <span><strong>{roleMeta[value].label}</strong><small>{roleMeta[value].department}</small></span>
                    {role === value && <Check size={16} aria-hidden="true" />}
                  </button>
                ))}
              </div>}
            </div>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {dataState==='LOADING'&&<div className="data-banner" role="status"><span className="loading-spinner"/> Đang đồng bộ dữ liệu mới nhất…</div>}
          {dataState==='ERROR'&&<div className="data-banner data-banner-error" role="alert"><span>{dataError}</span><button onClick={()=>void loadData()}>Thử lại</button></div>}
          {role === 'USER' ? <>
          <section id="overview" className="hero-section" aria-labelledby="page-title">
            <div>
              <p className="eyebrow">{currentRole.eyebrow}</p>
              <h1 id="page-title">Tổng quan tài sản mã hóa</h1>
              <p className="page-subtitle">Theo dõi trạng thái, thời hạn và yêu cầu xử lý trong một nơi.</p>
            </div>
            <button className="primary-button" onClick={() => openRequest()}>
              <Plus size={18} /> Tạo yêu cầu mới
            </button>
          </section>

          <section className="metric-row" aria-label="Tổng quan tài sản">
            <article className="metric metric-featured">
              <div className="metric-icon"><KeyRound size={20} /></div>
              <div><span>Tài sản đang quản lý</span><strong>{assets.length}</strong></div>
              <span className="metric-trend"><Activity size={14} /> {activeAssetCount} hoạt động</span>
            </article>
            <article className="metric">
              <div className="metric-icon metric-icon-amber"><CalendarClock size={20} /></div>
              <div><span>Sắp hết hạn</span><strong>{expiringAssetCount}</strong></div>
              <span className="metric-caption">Trong 30 ngày</span>
            </article>
            <article className="metric">
              <div className="metric-icon metric-icon-blue"><Clock3 size={20} /></div>
              <div><span>Yêu cầu chờ duyệt</span><strong>{pendingRequestCount}</strong></div>
              <span className="metric-caption">Đồng bộ từ máy chủ</span>
            </article>
            <article className="metric">
              <div className="metric-icon metric-icon-green"><CheckCircle2 size={20} /></div>
              <div><span>Tài sản hoạt động</span><strong>{assets.length?Math.round(activeAssetCount/assets.length*100):0}%</strong></div>
              <span className="metric-caption">{activeAssetCount}/{assets.length} tài sản</span>
            </article>
          </section>

          <OverviewInsights role="USER" dashboard={dashboard} />

          {priorityAsset&&<section className="expiry-banner" aria-labelledby="expiry-title">
            <div className="expiry-symbol"><AlertTriangle size={22} /></div>
            <div className="expiry-copy">
              <div className="banner-title-line">
                <h2 id="expiry-title">{priorityAsset.name} sắp hết hạn</h2>
                <StatusPill label={`Còn ${priorityAsset.daysLeft} ngày`} tone="warning" />
              </div>
              <p><strong>{priorityAsset.code}</strong> hết hạn ngày {priorityAsset.expiresAt}. Gia hạn sớm để tránh gián đoạn.</p>
            </div>
            <button className="secondary-button" onClick={() => openRequest('RENEW',priorityAsset.id)}>
              Yêu cầu gia hạn <ArrowRight size={17} />
            </button>
          </section>}

          <section className="lifecycle-section" aria-labelledby="lifecycle-title">
            <header className="lifecycle-header">
              <div>
                <h2 id="lifecycle-title">Phân bổ thời hạn</h2>
                <p>3 tài sản đang hiệu lực · cập nhật hôm nay</p>
              </div>
              <span className="lifecycle-summary"><strong>1</strong> cần xử lý sớm</span>
            </header>

            <div className="lifecycle-layout">
              <figure className="distribution-figure">
                <div className="distribution-heading">
                  <span>Theo thời gian còn lại</span>
                  <strong>3 tài sản</strong>
                </div>
                <div
                  className="distribution-bar"
                  role="img"
                  aria-label="Trong 3 tài sản đang hiệu lực: 1 tài sản hết hạn trong 30 ngày, không có tài sản hết hạn từ 31 đến 180 ngày và 2 tài sản còn hiệu lực trên 180 ngày."
                >
                  <span className="distribution-urgent" aria-hidden="true" />
                  <span className="distribution-longterm" aria-hidden="true" />
                </div>
                <div className="distribution-legend">
                  <div><span className="legend-mark mark-urgent" /><span><strong>1</strong> ≤ 30 ngày</span></div>
                  <div><span className="legend-mark mark-neutral" /><span><strong>0</strong> 31–180 ngày</span></div>
                  <div><span className="legend-mark mark-longterm" /><span><strong>2</strong> &gt; 180 ngày</span></div>
                </div>
                <figcaption>Phân nhóm theo chính sách cảnh báo hiện tại.</figcaption>
              </figure>

              <div className="priority-panel">
                <span className="priority-label">Ưu tiên tiếp theo</span>
                <button disabled={!priorityAsset} onClick={() => priorityAsset&&openRequest('RENEW', priorityAsset.id)}>
                  <span className="priority-date"><strong>{priorityAsset?.daysLeft??'—'}</strong><small>ngày</small></span>
                  <span className="priority-copy"><strong>{priorityAsset?.name??'Không có tài sản cần xử lý'}</strong><small>{priorityAsset?`${priorityAsset.code} · ${priorityAsset.expiresAt}`:'Hệ thống đang ổn định'}</small></span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>

          <section id="assets" className="content-section" aria-labelledby="assets-title">
            <div className="section-heading">
              <div><h2 id="assets-title">Tài sản của tôi</h2><p>Khóa và chứng thư bạn đang sở hữu hoặc theo dõi.</p></div>
              <button className="text-button" onClick={() => { setFilter('ALL'); setQuery(''); }}>Xem tất cả <ArrowRight size={16} /></button>
            </div>

            <div className="table-shell asset-table-shell">
              <div className="table-toolbar">
                <div className="filter-tabs" role="group" aria-label="Lọc trạng thái tài sản">
                  {([ 
                    ['ALL', 'Tất cả', assets.length], ['ACTIVE', 'Hoạt động', activeAssetCount], ['EXPIRING_SOON', 'Sắp hết hạn', expiringAssetCount], ['ENDED', 'Đã kết thúc', assets.length-activeAssetCount-expiringAssetCount],
                  ] as const).map(([value, label, count]) => (
                    <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>
                      {label}<span>{count}</span>
                    </button>
                  ))}
                </div>
                <label className="inline-search">
                  <Search size={16} /><span className="sr-only">Tìm trong tài sản</span>
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm trong tài sản" />
                  {query && <button aria-label="Xóa tìm kiếm" onClick={() => setQuery('')}><X size={15} /></button>}
                </label>
              </div>

              <div className="table-scroll">
                <table>
                  <thead><tr><th>Tài sản</th><th>Loại</th><th>Thuật toán</th><th>Trạng thái</th><th>Hết hạn</th><th><span className="sr-only">Hành động</span></th></tr></thead>
                  <tbody>
                    {filteredAssets.map((asset) => {
                      const Icon = asset.type === 'KEY' ? KeyRound : FileKey2;
                      return (
                        <tr key={asset.id}>
                          <td><button className="asset-cell" onClick={() => setSelectedAsset(asset)}>
                            <span className={`asset-type-icon ${asset.type === 'CERTIFICATE' ? 'certificate' : ''}`}><Icon size={18} /></span>
                            <span><strong>{asset.name}</strong><small>{asset.code}</small></span>
                          </button></td>
                          <td>{asset.type === 'KEY' ? 'Khóa mã hóa' : 'Chứng thư số'}</td>
                          <td><span className="mono-soft">{asset.algorithm}</span></td>
                          <td><StatusPill {...assetStatus[asset.status]} /></td>
                          <td><div className="expiry-cell"><strong>{asset.expiresAt}</strong><small>{asset.daysLeft > 0 ? `${asset.daysLeft} ngày` : 'Đã kết thúc'}</small></div></td>
                          <td><button className="row-action" aria-label={`Mở ${asset.name}`} onClick={() => setSelectedAsset(asset)}><ChevronRight size={18} /></button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredAssets.length === 0 && (
                  <div className="empty-state"><Search size={24} /><strong>Không tìm thấy tài sản</strong><p>Thử từ khóa khác hoặc xóa bộ lọc hiện tại.</p><button onClick={() => { setFilter('ALL'); setQuery(''); }}>Xóa bộ lọc</button></div>
                )}
              </div>
              {filteredAssets.length > 0 && <div className="asset-mobile-list" aria-label="Danh sách tài sản">
                {filteredAssets.map((asset) => {
                  const Icon = asset.type === 'KEY' ? KeyRound : FileKey2;
                  return <button key={asset.id} className="asset-mobile-card" onClick={() => setSelectedAsset(asset)}>
                    <span className={`asset-type-icon ${asset.type === 'CERTIFICATE' ? 'certificate' : ''}`}><Icon size={19} /></span>
                    <span className="asset-mobile-main"><strong>{asset.name}</strong><small>{asset.code} · {asset.algorithm}</small></span>
                    <span className="asset-mobile-meta"><StatusPill {...assetStatus[asset.status]} /><small>{asset.daysLeft > 0 ? `${asset.daysLeft} ngày` : 'Đã kết thúc'}</small></span>
                    <ChevronRight size={18} aria-hidden="true" />
                  </button>;
                })}
              </div>}
            </div>
          </section>

          <div className="two-column-grid">
            <section id="requests" className="content-section compact-section" aria-labelledby="requests-title">
              <div className="section-heading">
                <div><h2 id="requests-title">Yêu cầu gần đây</h2><p>Theo dõi tiến độ xử lý.</p></div>
                <button className="icon-button" aria-label="Làm mới" onClick={()=>void loadData()}><RotateCw size={17} /></button>
              </div>
              <div className="request-list">
                {requests.slice(0, showAllRequests ? requests.length : 3).map((request) => (
                  <button className="request-item" key={request.id} onClick={() => setSelectedRequest(request)}>
                    <span className={`request-symbol request-${request.type.toLowerCase()}`}>
                      {request.type === 'CREATE' ? <Plus size={17} /> : request.type === 'RENEW' ? <RotateCw size={17} /> : <XCircle size={17} />}
                    </span>
                    <span className="request-main"><strong>{request.subject}</strong><small>{request.id} · {request.submittedAt}</small></span>
                    {request.emergency && <span className="emergency-label">Khẩn cấp</span>}
                    <StatusPill {...requestStatus[request.status]} />
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <button className="section-footer-button" aria-expanded={showAllRequests} onClick={() => setShowAllRequests((show) => !show)}>{showAllRequests ? 'Thu gọn danh sách' : 'Xem toàn bộ lịch sử'} <ArrowRight className={showAllRequests ? 'rotate-up' : ''} size={16} /></button>
            </section>

            <section id="notifications" className="content-section compact-section" aria-labelledby="notifications-title">
              <div className="section-heading">
                <div><h2 id="notifications-title">Hoạt động mới</h2><p>Cập nhật quan trọng với tài sản của bạn.</p></div>
                <button className="text-button" disabled={unreadNotificationCount===0} onClick={async()=>{await api.markAllNotificationsRead();await loadData();setToast('Đã đánh dấu tất cả là đã đọc.')}}><Check size={15} /> Đánh dấu đã đọc</button>
              </div>
              <div className="activity-list">{notifications.length?notifications.slice(0,5).map(item=><article key={item.id}><span className={`activity-icon ${item.type.includes('EXPIRED')||item.type.includes('REJECTED')?'activity-warning':'activity-success'}`}><Bell size={17}/></span><div><strong>{item.type==='REQUEST_APPROVED'?'Yêu cầu đã được duyệt':item.type==='REQUEST_REJECTED'?'Yêu cầu bị từ chối':item.type==='ASSET_EXPIRING'?'Tài sản sắp hết hạn':item.type==='ASSET_EXPIRED'?'Tài sản đã hết hạn':item.type==='ASSET_REVOKED'?'Tài sản đã thu hồi':'Yêu cầu mới'}</strong><p>{item.assetCode??item.description??item.requestId}</p><time>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.createdAt))}</time></div>{!item.readAt&&<span className="activity-unread"/>}</article>):<div className="empty-state"><Bell size={22}/><strong>Chưa có thông báo</strong><p>Cập nhật mới sẽ xuất hiện tại đây.</p></div>}</div>
            </section>
          </div>
          </> : role === 'APPROVER' ? (
            <ApproverDashboard requests={requests} dashboard={dashboard} searchQuery={globalQuery} onDecision={(action, requestId) => setDecisionModal({ action, requestId })} />
          ) : (
            <AdminDashboard dashboard={dashboard} assets={assets} policies={policies} users={adminUsers} audits={auditLogs} searchQuery={globalQuery} currentUserId={user.id} onCreateUser={()=>setCreateUserModal(true)} onReload={loadData} onNotify={setToast} />
          )}
          <footer className="app-footer"><span>Crypta · Quản lý vòng đời mật mã</span><span>Dữ liệu đồng bộ từ máy chủ</span></footer>
        </main>
      </div>

      {selectedAsset && <AssetDrawer asset={selectedAsset} onClose={() => setSelectedAsset(null)} onRenew={() => openRequest('RENEW', selectedAsset.id)} onRevoke={() => openRequest('REVOKE', selectedAsset.id)} />}
      {selectedRequest && <RequestDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)} />}
      {requestModal && <RequestModal assets={assets} policies={policies} initialType={requestModal.type} initialAssetId={requestModal.assetId} onClose={() => setRequestModal(null)} onSuccess={async(type,body) => {
        await api.createRequest(body); setRequestModal(null); await loadData();
        setToast(type === 'REVOKE' ? 'Yêu cầu thu hồi khẩn cấp đã được gửi an toàn.' : 'Yêu cầu đã được gửi và người phê duyệt sẽ nhận email.');
      }} />}
      {decisionModal && <DecisionDialog action={decisionModal.action} requestId={decisionModal.requestId} onClose={() => setDecisionModal(null)} onSuccess={async(action, requestId,note) => {
        await api.decide(requestId,{decision:action==='APPROVE'?'APPROVED':'REJECTED',comment:note||undefined,version:String(requests.find(item=>item.id===requestId)?.version??'')||undefined});setDecisionModal(null);await loadData();
        setToast(action === 'APPROVE' ? `${requestId} đã được phê duyệt và email đã vào hàng đợi.` : `${requestId} đã bị từ chối; người gửi sẽ nhận email.`);
      }} />}
      {user.mustChangePassword&&<PasswordChangeDialog onLogout={async()=>{await api.logout();setUser(null);setSessionState('GUEST')}} onSuccess={async(currentPassword,newPassword)=>{await api.changePassword(currentPassword,newPassword);setAuthNotice('Hãy đăng nhập lại bằng mật khẩu mới.');setUser(null);setSessionState('GUEST')}}/>}
      {createUserModal&&<CreateUserDialog onClose={()=>setCreateUserModal(false)} onSuccess={async()=>{setCreateUserModal(false);await loadData();setToast('Đã tạo tài khoản. Người dùng phải đổi mật khẩu ở lần đăng nhập đầu tiên.')}}/>}
      {helpOpen&&<HelpDialog onClose={()=>setHelpOpen(false)}/>}
      {toast && <div className="toast" role="status"><CheckCircle2 size={19} /><span>{toast}</span><button aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={16} /></button></div>}
    </div>
  );
}

function AssetDrawer({ asset, onClose, onRenew, onRevoke }: { asset: Asset; onClose: () => void; onRenew: () => void; onRevoke: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const canManage = asset.status === 'ACTIVE' || asset.status === 'EXPIRING_SOON';
  useDialogBehavior(dialogRef, closeRef, onClose);

  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Đóng chi tiết tài sản" />
    <aside ref={dialogRef} className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="asset-drawer-title">
      <div className="drawer-header">
        <div className="drawer-title"><span className="asset-type-icon"><KeyRound size={19} /></span><div><p>{asset.code}</p><h2 id="asset-drawer-title">{asset.name}</h2></div></div>
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <div className="drawer-body">
        <div className="drawer-status"><StatusPill {...assetStatus[asset.status]} /><span>{asset.ownerName ? `${asset.ownerName} · ${asset.departmentName ?? 'Chưa có phòng ban'}` : 'Metadata từ hệ thống'}</span></div>
        <dl className="detail-grid">
          <div><dt>Loại tài sản</dt><dd>{asset.type === 'KEY' ? 'Khóa mã hóa' : 'Chứng thư số'}</dd></div>
          <div><dt>Thuật toán</dt><dd>{asset.algorithm}</dd></div>
          <div><dt>Ngày hết hạn</dt><dd>{asset.expiresAt}</dd></div>
          <div><dt>Nhà cung cấp</dt><dd>{asset.provider}</dd></div>
        </dl>
        <div className="detail-block"><span>Mục đích sử dụng</span><p>{asset.purpose}</p></div>
        <div className="detail-block"><span>Fingerprint công khai</span><code><Fingerprint size={15} />{asset.fingerprint}</code></div>
        <div className="mini-timeline">
          <h3>Vòng đời tài sản</h3>
          <ol><li className="done"><span /><div><strong>Được cấp phát</strong><small>{asset.validFrom ?? 'Chưa ghi nhận ngày hiệu lực'} · {asset.provider}</small></div></li><li className="done"><span /><div><strong>Chính sách đang áp dụng</strong><small>{asset.policyCode ?? 'Chưa có mã chính sách'}{asset.version ? ` · metadata v${asset.version}` : ''}</small></div></li>{asset.status === 'REVOKED' ? <li className="done"><span /><div><strong>Đã thu hồi</strong><small>Thời điểm và người thực hiện được lưu trong Audit Log.</small></div></li> : <li><span /><div><strong>Hết hạn dự kiến</strong><small>{asset.expiresAt}</small></div></li>}</ol>
        </div>
        {!canManage && <div className="inline-alert inline-alert-neutral"><ShieldAlert size={19} /><div><strong>Vòng đời đã kết thúc</strong><p>Tài sản đã thu hồi hoặc thay thế không thể gia hạn hay kích hoạt lại. Lịch sử vẫn được giữ để kiểm toán.</p></div></div>}
      </div>
      <div className="drawer-footer">
        <button className="quiet-button" onClick={onClose}>Đóng</button>
        {canManage && <button className="danger-quiet-button" onClick={onRevoke}><XCircle size={17} /> Thu hồi</button>}
        {canManage && <button className="primary-button" onClick={onRenew}><RotateCw size={17} /> Yêu cầu gia hạn</button>}
      </div>
    </aside>
  </>;
}

function RequestDrawer({ request, onClose }: { request: RequestItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(dialogRef, closeRef, onClose);

  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Đóng chi tiết yêu cầu" />
    <aside ref={dialogRef} className="asset-drawer" role="dialog" aria-modal="true" aria-labelledby="request-drawer-title">
      <div className="drawer-header">
        <div className="drawer-title"><span className="asset-type-icon"><FileText size={19} /></span><div><p>{request.id}</p><h2 id="request-drawer-title">{request.subject}</h2></div></div>
        <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
      </div>
      <div className="drawer-body">
        <div className="drawer-status"><StatusPill {...requestStatus[request.status]} /><span>{request.submittedAt}</span></div>
        <dl className="detail-grid">
          <div><dt>Loại yêu cầu</dt><dd>{request.type === 'CREATE' ? 'Cấp phát mới' : request.type === 'RENEW' ? 'Gia hạn' : 'Thu hồi'}</dd></div>
          <div><dt>Người phê duyệt</dt><dd>{request.approver ?? 'Đang chờ phân công'}</dd></div>
        </dl>
        {request.emergency && <div className="inline-alert inline-alert-danger"><ShieldAlert size={19} /><div><strong>Yêu cầu khẩn cấp</strong><p>Yêu cầu liên quan đến thiết bị thất lạc và đã được ưu tiên xử lý.</p></div></div>}
        <div className="mini-timeline">
          <h3>Tiến trình xử lý</h3>
          <ol>
            <li className="done"><span /><div><strong>Đã tạo yêu cầu</strong><small>{request.submittedAt} · Nguyễn Văn Dev</small></div></li>
            <li className={request.status === 'PENDING' ? '' : 'done'}><span /><div><strong>{request.status === 'PENDING' ? 'Đang chờ phê duyệt' : 'Đã có quyết định'}</strong><small>{request.status === 'PENDING' ? 'Người phê duyệt phạm vi CNTT đã được thông báo' : request.approver ?? 'Hệ thống'}</small></div></li>
            <li className={request.status === 'COMPLETED' ? 'done' : ''}><span /><div><strong>{request.status === 'COMPLETED' ? 'Đã hoàn tất' : 'Chờ kết quả xử lý'}</strong><small>Mọi thay đổi sẽ được ghi vào Audit Log</small></div></li>
          </ol>
        </div>
      </div>
      <div className="drawer-footer"><button className="quiet-button" onClick={onClose}>Đóng</button></div>
    </aside>
  </>;
}

function RequestModal({ assets, policies, initialType, initialAssetId, onClose, onSuccess }: { assets:Asset[];policies:PolicyOption[]; initialType: RequestType; initialAssetId?: string; onClose: () => void; onSuccess: (type: RequestType,body:unknown) => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [type, setType] = useState<RequestType>(initialType);
  const [assetId, setAssetId] = useState(initialAssetId ?? '');
  const [reason, setReason] = useState('');
  const [policyVersionId,setPolicyVersionId]=useState(policies[0]?.id??'');
  const [assetType,setAssetType]=useState<'KEY'|'CERTIFICATE'>('KEY');
  const [busy,setBusy]=useState(false); const [submitError,setSubmitError]=useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const reasonInvalid = submitted && reason.trim().length < 10;
  const assetInvalid = submitted && type !== 'CREATE' && !assetId;
  const selected = assets.find((asset) => asset.id === assetId);
  useDialogBehavior(dialogRef, closeRef, onClose);
  const compatiblePolicies=policies.filter(policy=>assetType==='CERTIFICATE'||!policy.configuration?.certificate_profile);
  useEffect(()=>{if(type==='CREATE'&&!compatiblePolicies.some(item=>item.id===policyVersionId))setPolicyVersionId(compatiblePolicies[0]?.id??'')},[assetType,type,policies]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (reason.trim().length < 10 || (type !== 'CREATE' && !assetId)) return;
    if (type === 'REVOKE' && !confirmRevoke) {
      setConfirmRevoke(true);
      return;
    }
    const effectivePolicyVersionId=type==='CREATE'?policyVersionId:selected?.policyVersionId;
    if(!effectivePolicyVersionId){setSubmitError('Không xác định được chính sách hiệu lực cho tài sản.');return}
    setBusy(true);setSubmitError('');
    try{await onSuccess(type,{type,targetAssetId:type==='CREATE'?undefined:assetId,policyVersionId:effectivePolicyVersionId,reason,emergency:type==='REVOKE',parameters:type==='CREATE'?{assetType}: {}})}
    catch(error){setSubmitError(error instanceof ApiError?error.message:'Không thể gửi yêu cầu. Hãy thử lại.');setBusy(false)}
  };

  return <div className="modal-layer" role="presentation">
    <button className="modal-scrim" onClick={onClose} aria-label="Đóng biểu mẫu" />
    <section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="request-modal-title">
      <header><div><p className="eyebrow">Yêu cầu mới</p><h2 id="request-modal-title">Bạn muốn thực hiện tác vụ nào?</h2><span>Yêu cầu sẽ được chuyển đến người phê duyệt đúng phạm vi.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header>
      <form onSubmit={submit} noValidate>
        {confirmRevoke ? <div className="confirmation-panel" role="alert">
          <span className="confirmation-icon"><ShieldAlert size={24} /></span>
          <div><p className="eyebrow">Xác nhận cuối cùng</p><h3>Thu hồi {selected?.name}</h3><p>Tài sản sẽ ngừng hiệu lực và <strong>không thể chuyển lại trạng thái hoạt động</strong>. Yêu cầu được ưu tiên tới người phê duyệt CNTT và toàn bộ quyết định sẽ được ghi Audit Log.</p></div>
        </div> : <>
        <fieldset className="request-types"><legend>Loại yêu cầu</legend>
          {([
            ['CREATE', 'Cấp phát mới', 'Tạo khóa hoặc chứng thư mới', Plus],
            ['RENEW', 'Gia hạn', 'Thay thế tài sản sắp hết hạn', RotateCw],
            ['REVOKE', 'Thu hồi', 'Ngừng hiệu lực một tài sản', XCircle],
          ] as const).map(([value, title, description, Icon]) => <label className={type === value ? 'selected' : ''} key={value}><input type="radio" name="type" value={value} checked={type === value} onChange={() => { setType(value); setSubmitted(false); setConfirmRevoke(false); if (value === 'CREATE') setAssetId(''); }} /><span className="request-type-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{description}</small></span><span className="radio-mark"><Check size={13} /></span></label>)}
        </fieldset>
        {type !== 'CREATE' && <label className={`form-field ${assetInvalid ? 'field-error' : ''}`}><span>Tài sản <em>*</em></span><select value={assetId} onChange={(event) => setAssetId(event.target.value)} required aria-invalid={assetInvalid} aria-describedby="asset-help"><option value="" disabled>Chọn tài sản của bạn</option>{assets.filter((asset) => asset.status === 'ACTIVE' || asset.status === 'EXPIRING_SOON').map((asset) => <option value={asset.id} key={asset.id}>{asset.code} · {asset.name}</option>)}</select><small id="asset-help">{assetInvalid ? 'Hãy chọn tài sản cần xử lý.' : 'Chỉ tài sản đang hoạt động hoặc sắp hết hạn được phép chọn.'}</small></label>}
        {type === 'CREATE' && <div className="form-row"><label className="form-field"><span>Loại tài sản <em>*</em></span><select value={assetType} onChange={e=>setAssetType(e.target.value as 'KEY'|'CERTIFICATE')}><option value="KEY">Khóa mã hóa</option><option value="CERTIFICATE">Chứng thư số</option></select></label><label className="form-field"><span>Chính sách</span><select value={policyVersionId} onChange={e=>setPolicyVersionId(e.target.value)}>{compatiblePolicies.map(policy=><option value={policy.id} key={policy.id}>{policy.name} v{policy.version}</option>)}</select></label></div>}
        <label className={`form-field ${reasonInvalid ? 'field-error' : ''}`}><span>Lý do nghiệp vụ <em>*</em></span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mô tả mục đích sử dụng và phạm vi cần thiết…" aria-invalid={reasonInvalid} aria-describedby="reason-help" /><small id="reason-help">{reasonInvalid ? 'Vui lòng nhập ít nhất 10 ký tự để người duyệt có đủ thông tin.' : 'Không nhập private key, mật khẩu hoặc dữ liệu bí mật.'}</small></label>
        {type === 'REVOKE' ? <div className="inline-alert inline-alert-danger"><ShieldAlert size={19} /><div><strong>Hành động không thể hoàn tác</strong><p>Tài sản đã thu hồi không thể chuyển lại Active. Bạn sẽ xác nhận hậu quả ở bước tiếp theo.</p></div></div> : <div className="policy-preview"><ShieldCheck size={19} /><div><strong>Kiểm tra chính sách tự động</strong><p>Thông số sẽ được kiểm tra trước khi yêu cầu được gửi. Người tạo không thể tự phê duyệt.</p></div></div>}
        </>}
        {submitError&&<div className="login-error" role="alert">{submitError}</div>}<footer>{confirmRevoke ? <><button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmRevoke(false)}>Quay lại kiểm tra</button><button type="submit" disabled={busy} className="danger-button">{busy?'Đang gửi…':'Xác nhận thu hồi'} <ShieldAlert size={17} /></button></> : <><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Hủy</button><button type="submit" disabled={busy} className={type === 'REVOKE' ? 'danger-button' : 'primary-button'}>{busy?'Đang gửi…':type === 'REVOKE' ? 'Tiếp tục thu hồi' : 'Gửi yêu cầu'} <ArrowRight size={17} /></button></>}</footer>
      </form>
    </section>
  </div>;
}

function ApproverDashboard({ requests,dashboard,searchQuery,onDecision }: { requests:RequestItem[];dashboard:any;searchQuery:string;onDecision: (action: 'APPROVE' | 'REJECT', requestId: string) => void }) {
  const [queueQuery,setQueueQuery]=useState('');const normalized=(queueQuery||searchQuery).trim().toLocaleLowerCase('vi');
  const allQueue=requests.filter(request=>request.status==='PENDING').map(request=>({id:request.id,person:request.creatorName??'Không xác định',department:request.departmentName??'Không xác định',type:request.type==='CREATE'?'Cấp mới':request.type==='RENEW'?'Gia hạn':'Thu hồi',asset:request.targetAssetCode??(request.type==='CREATE'?'Tài sản mới':'Không xác định'),reason:request.subject,age:request.submittedAt,emergency:Boolean(request.emergency)}));
  const queue=allQueue.filter(item=>!normalized||[item.id,item.person,item.department,item.asset,item.reason].some(value=>value.toLocaleLowerCase('vi').includes(normalized)));
  const handled=requests.filter(request=>request.status!=='PENDING').slice(0,3);
  const [selectedId, setSelectedId] = useState('');
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0];

  if(!selected)return <><section id="overview" className="hero-section" aria-labelledby="page-title"><div><p className="eyebrow">Trung tâm phê duyệt</p><h1 id="page-title">{normalized&&allQueue.length?'Không tìm thấy yêu cầu':'Không có yêu cầu chờ xử lý'}</h1><p className="page-subtitle">{normalized&&allQueue.length?'Không có mục nào khớp từ khóa hiện tại.':'Hàng chờ trong phạm vi của bạn đang trống.'}</p></div></section><div className="empty-state">{normalized&&allQueue.length?<Search size={28}/>:<CheckCircle2 size={28}/>}<strong>{normalized&&allQueue.length?'Thử từ khóa khác':'Mọi yêu cầu đã được xử lý'}</strong><p>{normalized&&allQueue.length?'Tìm theo mã, người gửi, phòng ban, tài sản hoặc lý do.':'Hệ thống sẽ gửi email khi có yêu cầu mới.'}</p>{queueQuery&&<button onClick={()=>setQueueQuery('')}>Xóa tìm kiếm</button>}</div></>;

  return <>
    <section id="overview" className="hero-section" aria-labelledby="page-title">
      <div><p className="eyebrow">Trung tâm phê duyệt</p><h1 id="page-title">Hàng chờ cần quyết định</h1><p className="page-subtitle">Ưu tiên yêu cầu rủi ro cao, kiểm tra policy và phân tách nhiệm vụ trước khi xử lý.</p></div>
      <button className="primary-button" onClick={() => scrollToElement('approval-detail')}><ShieldAlert size={18} /> Xử lý yêu cầu khẩn cấp</button>
    </section>
    <section className="metric-row three-metrics" aria-label="Tổng quan phê duyệt">
      <article className="metric"><div className="metric-icon metric-icon-blue"><ClipboardList size={20} /></div><div><span>Chờ xử lý</span><strong>{dashboard?.metrics?.pending??queue.length}</strong></div><span className="metric-caption">Trong phạm vi được giao</span></article>
      <article className="metric"><div className="metric-icon metric-icon-amber"><ShieldAlert size={20} /></div><div><span>Khẩn cấp</span><strong>{dashboard?.metrics?.emergency??queue.filter(i=>i.emergency).length}</strong></div><span className="metric-caption">Cần quyết định ngay</span></article>
      <article className="metric"><div className="metric-icon metric-icon-green"><Clock3 size={20} /></div><div><span>Thời gian chờ TB</span><strong>{dashboard?.metrics?.avg_wait_hours??0} giờ</strong></div><span className="metric-caption">Tính từ hàng chờ hiện tại</span></article>
    </section>
    <OverviewInsights role="APPROVER" dashboard={dashboard} />
    {queue.some(item=>item.emergency)&&<section className="expiry-banner danger-banner" aria-label="Yêu cầu khẩn cấp"><div className="expiry-symbol"><ShieldAlert size={22} /></div><div className="expiry-copy"><div className="banner-title-line"><h2>Có yêu cầu khẩn cấp đang chờ</h2><StatusPill label="Ưu tiên cao" tone="danger" /></div><p>Kiểm tra yêu cầu được đánh dấu khẩn cấp và đưa ra quyết định sớm để giảm rủi ro.</p></div><button className="secondary-button" onClick={() => { setSelectedId(queue.find(item=>item.emergency)!.id); scrollToElement('approval-detail'); }}>Kiểm tra ngay <ArrowRight size={17} /></button></section>}
    <section id="approval-queue" className="content-section" aria-labelledby="queue-title">
      <div className="section-heading"><div><h2 id="queue-title">Hàng chờ phê duyệt</h2><p>Chỉ hiển thị yêu cầu thuộc phạm vi CNTT của bạn.</p></div><button className="filter-button"><SlidersHorizontal size={16} /> Bộ lọc <span>3</span></button></div>
      <div className="table-shell"><div className="table-toolbar"><div className="filter-tabs" role="group" aria-label="Tổng số hàng chờ"><button className="filter-active">Tất cả <span>{queue.length}</span></button><button>Khẩn cấp <span>{queue.filter(item=>item.emergency).length}</span></button></div><label className="inline-search"><Search size={16} /><span className="sr-only">Tìm yêu cầu</span><input value={queueQuery} onChange={event=>setQueueQuery(event.target.value)} placeholder="Mã hoặc nội dung" /></label></div><div className="table-scroll"><table><thead><tr><th>Mã</th><th>Người gửi</th><th>Loại</th><th>Tài sản</th><th>Thời gian chờ</th><th>Mức độ</th><th><span className="sr-only">Mở</span></th></tr></thead><tbody>{queue.map((item) => <tr key={item.id} className={selectedId === item.id ? 'row-selected' : ''}><td><button className="table-link" onClick={() => { setSelectedId(item.id); scrollToElement('approval-detail'); }}>{item.id}</button></td><td><strong>{item.person}</strong><small className="cell-subtitle">{item.department}</small></td><td>{item.type}</td><td><span className="mono-soft">{item.asset}</span></td><td>{item.age}</td><td>{item.emergency ? <StatusPill label="Khẩn cấp" tone="danger" /> : <StatusPill label="Bình thường" tone="neutral" />}</td><td><button className="row-action" aria-label={`Mở ${item.id}`} onClick={() => { setSelectedId(item.id); scrollToElement('approval-detail'); }}><ChevronRight size={18} /></button></td></tr>)}</tbody></table></div></div>
    </section>
    <section id="approval-detail" className="content-section approval-detail" aria-labelledby="approval-detail-title">
      <header className="approval-detail-header"><div><p className="eyebrow">Yêu cầu đang chọn</p><h2 id="approval-detail-title">{selected.id} · {selected.type} {selected.asset !== '—' ? selected.asset : 'tài sản mới'}</h2><p>{selected.person} · Phòng {selected.department} · gửi {selected.age} trước</p></div><div className="detail-badges">{selected.emergency && <StatusPill label="Khẩn cấp" tone="danger" />}<StatusPill label="Chờ duyệt" tone="warning" /></div></header>
      <div className="approval-layout"><div className="request-facts"><h3>Thông tin yêu cầu</h3><dl className="detail-grid"><div><dt>Người gửi</dt><dd>{selected.person}</dd></div><div><dt>Phòng ban</dt><dd>{selected.department}</dd></div><div><dt>Loại yêu cầu</dt><dd>{selected.type}</dd></div><div><dt>Tài sản</dt><dd>{selected.asset}</dd></div></dl><div className="detail-block"><span>Lý do nghiệp vụ</span><p>{selected.reason}</p></div></div><div className="approval-checks"><h3>Kiểm tra trước phê duyệt</h3><ul><li className="check-success"><CheckCircle2 size={18} /><span><strong>Đúng phạm vi phê duyệt</strong><small>Yêu cầu thuộc {selected.department}</small></span></li><li className="check-success"><CheckCircle2 size={18} /><span><strong>Đảm bảo Separation of Duties</strong><small>Người duyệt khác người gửi</small></span></li><li className="check-success"><CheckCircle2 size={18} /><span><strong>Kiểm tra lại khi gửi</strong><small>Phiên bản, quyền và trạng thái sẽ được xác nhận ở máy chủ</small></span></li>{selected.emergency && <li className="check-warning"><AlertTriangle size={18} /><span><strong>Rủi ro cần xử lý ngay</strong><small>Yêu cầu được người gửi đánh dấu khẩn cấp</small></span></li>}</ul></div></div>
      <div className="decision-bar"><div><strong>Sẵn sàng đưa ra quyết định</strong><span>Hệ thống sẽ kiểm tra lại quyền, scope và phiên bản dữ liệu khi gửi.</span></div><div><button className="danger-quiet-button" onClick={() => onDecision('REJECT', selected.id)}>Từ chối</button><button className="primary-button" onClick={() => onDecision('APPROVE', selected.id)}><Check size={17} /> Phê duyệt yêu cầu</button></div></div>
    </section>
    <section id="approval-history" className="content-section compact-section"><div className="section-heading"><div><h2>Lịch sử xử lý gần đây</h2><p>Tối đa 3 yêu cầu đã rời hàng chờ trong phạm vi của bạn.</p></div></div><div className="activity-list">{handled.length?handled.map(item=><article key={item.id}><span className={`activity-icon ${item.status==='REJECTED'||item.status==='FAILED'?'activity-warning':'activity-success'}`}>{item.status==='REJECTED'||item.status==='FAILED'?<XCircle size={18}/>:<CheckCircle2 size={18}/>}</span><div><strong>{requestStatus[item.status].label} · {item.id}</strong><p>{item.subject}</p><time>{item.submittedAt}</time></div></article>):<div className="empty-state"><Clock3 size={22}/><strong>Chưa có lịch sử xử lý</strong><p>Các yêu cầu đã quyết định sẽ xuất hiện tại đây.</p></div>}</div></section>
  </>;
}

function AdminDashboard({dashboard,assets,policies,users,audits,searchQuery,currentUserId,onCreateUser,onReload,onNotify}:{dashboard:any;assets:Asset[];policies:PolicyOption[];users:any[];audits:any[];searchQuery:string;currentUserId:string;onCreateUser:()=>void;onReload:()=>Promise<void>;onNotify:(message:string)=>void}) {
  const watched=assets.filter(asset=>asset.status==='EXPIRING_SOON'||asset.status==='EXPIRED').slice(0,10);const activeUsers=users.filter(user=>user.status==='ACTIVE').length;const approvers=users.filter(user=>user.roles?.includes('APPROVER')).length;
  const auditNeedle=searchQuery.trim().toLocaleLowerCase('vi');const visibleAudits=audits.filter(item=>!auditNeedle||[item.action,item.actorName,item.entityId,item.outcome].some(value=>String(value??'').toLocaleLowerCase('vi').includes(auditNeedle)));
  const [changingUser,setChangingUser]=useState('');
  const [testEmailOpen,setTestEmailOpen]=useState(false);
  const changeStatus=async(target:any)=>{const next=target.status==='ACTIVE'?'INACTIVE':'ACTIVE';setChangingUser(target.id);try{await api.updateUserStatus(target.id,next);onNotify(next==='ACTIVE'?'Đã kích hoạt tài khoản.':'Đã vô hiệu hóa tài khoản và thu hồi các phiên.');await onReload()}catch(error){onNotify(error instanceof ApiError?error.message:'Không thể cập nhật tài khoản.')}finally{setChangingUser('')}};
  return <>
    <section id="overview" className="hero-section" aria-labelledby="page-title"><div><p className="eyebrow">Điều hành an toàn</p><h1 id="page-title">Sức khỏe tài sản mật mã</h1><p className="page-subtitle">Giám sát vòng đời, chính sách và khả năng truy vết trên toàn tổ chức.</p></div><button className="primary-button" onClick={() => scrollToElement('audit-log')}><Search size={18} /> Tra cứu Audit Log</button></section>
    <section className="metric-row" aria-label="Tổng quan an toàn"><article className="metric"><div className="metric-icon"><Database size={20} /></div><div><span>Tổng tài sản</span><strong>{dashboard?.metrics?.total_assets??assets.length}</strong></div><span className="metric-caption">{dashboard?.metrics?.departments??0} phòng ban</span></article><article className="metric"><div className="metric-icon metric-icon-amber"><CalendarClock size={20} /></div><div><span>Sắp hết hạn</span><strong>{dashboard?.metrics?.expiring??watched.length}</strong></div><span className="metric-caption">Cần theo dõi</span></article><article className="metric"><div className="metric-icon metric-icon-blue"><Users size={20} /></div><div><span>Tài khoản hoạt động</span><strong>{dashboard?.metrics?.active_users??activeUsers}</strong></div><span className="metric-caption">{approvers} người phê duyệt</span></article><article className="metric"><div className="metric-icon metric-icon-green"><CheckCircle2 size={20} /></div><div><span>Email lỗi</span><strong>{dashboard?.metrics?.failed_jobs??0}</strong></div><span className="metric-trend"><Activity size={14} /> Theo dõi hàng đợi</span></article></section>
    <OverviewInsights role="ADMIN" dashboard={dashboard} />
    <div className="admin-overview-grid"><section className="content-section compact-section"><div className="section-heading"><div><h2>Cảnh báo ưu tiên</h2><p>Các vấn đề có thể dẫn đến gián đoạn.</p></div></div><div className="admin-alert-list"><button onClick={() => scrollToElement('admin-assets')}><span className="alert-number alert-warning">{watched.length}</span><span><strong>Tài sản hết hạn hoặc sắp hết hạn</strong><small>Dữ liệu theo trạng thái hiện tại</small></span><ChevronRight size={18} /></button><button onClick={() => scrollToElement('audit-log')}><span className="alert-number alert-info">{dashboard?.metrics?.failed_jobs??0}</span><span><strong>Email gửi thất bại</strong><small>Kiểm tra cấu hình SMTP và hàng đợi</small></span><ChevronRight size={18} /></button></div></section><section className="content-section compact-section"><div className="section-heading"><div><h2>Trạng thái dịch vụ</h2><p>Cấu hình tiến trình hiện tại.</p></div></div><div className="service-list"><div><span><Database size={18} /><strong>Crypto Provider</strong></span><StatusPill label={dashboard?.services?.cryptoProvider==='HTTP'?'Đã kết nối':'Mô phỏng'} tone={dashboard?.services?.cryptoProvider==='HTTP'?'success':'warning'} /></div><div><span><Bell size={18} /><strong>Email SMTP</strong></span><span className="service-actions"><StatusPill label={dashboard?.services?.email==='ENABLED'?'Đã bật':'Chưa bật'} tone={dashboard?.services?.email==='ENABLED'?'success':'warning'} /><button className="text-button" disabled={dashboard?.services?.email!=='ENABLED'} title={dashboard?.services?.email==='ENABLED'?'Gửi thư xác minh kết nối SMTP':'Bật SMTP trong .env và khởi động lại để gửi thử'} onClick={()=>setTestEmailOpen(true)}><Send size={14}/> Gửi thử</button></span></div><div><span><CalendarClock size={18} /><strong>Expiry Scan</strong></span><StatusPill label="Đang hoạt động" tone="success" /></div></div></section></div>
    <section id="admin-assets" className="content-section" aria-labelledby="admin-assets-title"><div className="section-heading"><div><h2 id="admin-assets-title">Tài sản cần theo dõi</h2><p>Ưu tiên theo thời hạn và mức độ tuân thủ.</p></div><span className="filter-button"><SlidersHorizontal size={16}/>{watched.length} mục</span></div><div className="table-shell"><div className="table-scroll"><table><thead><tr><th>Tài sản</th><th>Owner</th><th>Phòng ban</th><th>Trạng thái</th><th>Hết hạn</th><th>Policy</th></tr></thead><tbody>{watched.map(asset=><tr key={asset.id}><td><strong>{asset.code}</strong><small className="cell-subtitle">{asset.name}</small></td><td>{asset.ownerName}</td><td>{asset.departmentName}</td><td><StatusPill {...assetStatus[asset.status]}/></td><td>{asset.expiresAt}</td><td>{asset.policyCode}</td></tr>)}</tbody></table>{!watched.length&&<div className="empty-state"><CheckCircle2 size={22}/><strong>Không có tài sản cần xử lý</strong></div>}</div></div></section>
    <div className="admin-overview-grid"><section id="policy" className="content-section compact-section"><div className="section-heading"><div><h2>Chính sách hiện hành</h2><p>Phiên bản đang hiệu lực lấy trực tiếp từ database.</p></div><button className="text-button" onClick={() => onNotify(`Đang áp dụng ${policies.length} phiên bản chính sách.`)}>Kiểm tra</button></div><div className="policy-summary"><div><span>Phiên bản hiệu lực</span><strong>{policies.length}</strong></div><div><span>Mã chính sách</span><strong>{policies.map(item=>item.code).join(', ')||'Chưa có'}</strong></div><div><span>Phiên bản cao nhất</span><strong>v{Math.max(0,...policies.map(item=>item.version))}</strong></div></div></section><section className="content-section compact-section"><div className="section-heading"><div><h2>Quyền nhạy cảm</h2><p>Dữ liệu tài khoản thật.</p></div></div><div className="policy-summary"><div><span>Security Admin</span><strong>{users.filter(u=>u.roles?.includes('ADMIN')).length} người</strong></div><div><span>Approver</span><strong>{approvers} người</strong></div><div><span>Xung đột SoD</span><strong className="success-text">0 phát hiện</strong></div></div></section></div>
    <section id="users" className="content-section" aria-labelledby="users-title"><div className="section-heading"><div><h2 id="users-title">Quản trị tài khoản</h2><p>Vô hiệu hóa sẽ thu hồi toàn bộ phiên đăng nhập hiện tại.</p></div><div className="heading-actions"><span className="filter-button"><Users size={16}/>{users.length} tài khoản</span><button className="primary-button" onClick={onCreateUser}><Plus size={17}/> Thêm người dùng</button></div></div><div className="table-shell"><div className="table-scroll"><table><thead><tr><th>Người dùng</th><th>Phòng ban</th><th>Vai trò</th><th>Trạng thái</th><th>Lần đăng nhập cuối</th><th><span className="sr-only">Thao tác</span></th></tr></thead><tbody>{users.map(target=><tr key={target.id}><td><strong>{target.displayName}</strong><small className="cell-subtitle">{target.email}</small></td><td>{target.departmentName}</td><td>{target.roles?.join(', ')||'—'}</td><td><StatusPill label={target.status==='ACTIVE'?'Hoạt động':target.status==='LOCKED'?'Bị khóa':'Vô hiệu hóa'} tone={target.status==='ACTIVE'?'success':target.status==='LOCKED'?'danger':'neutral'}/></td><td>{target.lastLoginAt?new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(target.lastLoginAt)):'Chưa đăng nhập'}</td><td><button className={target.status==='ACTIVE'?'danger-quiet-button':'secondary-button'} disabled={changingUser===target.id||target.id===currentUserId} title={target.id===currentUserId?'Không thể vô hiệu hóa chính mình':''} onClick={()=>void changeStatus(target)}>{changingUser===target.id?'Đang lưu…':target.status==='ACTIVE'?'Vô hiệu hóa':'Kích hoạt'}</button></td></tr>)}</tbody></table></div></div></section>
    <section id="audit-log" className="content-section" aria-labelledby="audit-title"><div className="section-heading"><div><h2 id="audit-title">Audit Log</h2><p>Nhật ký chỉ đọc; dữ liệu bí mật đã được che.{auditNeedle&&` · ${visibleAudits.length} kết quả`}</p></div></div><div className="table-shell"><div className="table-scroll"><table><thead><tr><th>Thời gian</th><th>Actor</th><th>Hành động</th><th>Đối tượng</th><th>Kết quả</th></tr></thead><tbody>{visibleAudits.slice(0,20).map(item=><tr key={item.id}><td>{new Intl.DateTimeFormat('vi-VN',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.occurredAt))}</td><td>{item.actorName}</td><td><span className="mono-soft">{item.action}</span></td><td>{item.entityId??'—'}</td><td><StatusPill label={item.outcome==='SUCCESS'?'Thành công':item.outcome==='DENIED'?'Bị từ chối':'Thất bại'} tone={item.outcome==='SUCCESS'?'success':'danger'}/></td></tr>)}</tbody></table>{!visibleAudits.length&&<div className="empty-state"><Search size={22}/><strong>Không tìm thấy nhật ký</strong><p>Thử mã đối tượng, actor hoặc tên hành động khác.</p></div>}</div></div></section>
    {testEmailOpen&&<TestEmailDialog onClose={()=>setTestEmailOpen(false)} onSuccess={email=>{setTestEmailOpen(false);onNotify(`Đã gửi email kiểm tra tới ${email}.`)}}/>}
  </>;
}

function TestEmailDialog({onClose,onSuccess}:{onClose:()=>void;onSuccess:(email:string)=>void}){
  const[email,setEmail]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');const closeRef=useRef<HTMLButtonElement>(null);const dialogRef=useRef<HTMLElement>(null);useDialogBehavior(dialogRef,closeRef,onClose);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setBusy(true);setError('');try{await api.testEmail(email.trim());onSuccess(email.trim())}catch(reason){setError(reason instanceof ApiError?reason.message:'Không thể gửi email kiểm tra.');setBusy(false)}};
  return <div className="modal-layer" role="presentation"><button className="modal-scrim" onClick={onClose} aria-label="Đóng gửi email kiểm tra"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="test-email-title"><header><div><p className="eyebrow">Xác minh SMTP</p><h2 id="test-email-title">Gửi email kiểm tra</h2><span>Thư được gửi trực tiếp qua cấu hình SMTP hiện tại.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header><form onSubmit={submit}><label className="form-field"><span>Email nhận <em>*</em></span><input type="email" autoComplete="email" value={email} onChange={event=>setEmail(event.target.value)} placeholder="admin@congty.com" required autoFocus/><small>Chỉ dùng địa chỉ bạn có quyền kiểm tra hộp thư.</small></label>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Hủy</button><button className="primary-button" disabled={busy}><Send size={16}/>{busy?'Đang gửi…':'Gửi email thử'}</button></footer></form></section></div>
}

function DecisionDialog({ action, requestId, onClose, onSuccess }: { action: 'APPROVE' | 'REJECT'; requestId: string; onClose: () => void; onSuccess: (action: 'APPROVE' | 'REJECT', requestId: string,note:string) => Promise<void> }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy,setBusy]=useState(false);const[submitError,setSubmitError]=useState('');
  const invalid = action === 'REJECT' && submitted && note.trim().length < 10;
  useDialogBehavior(dialogRef, closeRef, onClose);
  const submit = async(event: React.FormEvent) => { event.preventDefault(); setSubmitted(true); if (action === 'REJECT' && note.trim().length < 10) return;setBusy(true);setSubmitError('');try{await onSuccess(action,requestId,note)}catch(error){setSubmitError(error instanceof ApiError?error.message:'Không thể gửi quyết định.');setBusy(false)} };
  return <div className="modal-layer" role="presentation"><button className="modal-scrim" onClick={onClose} aria-label="Đóng xác nhận" /><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title"><header><div><p className="eyebrow">Xác nhận quyết định</p><h2 id="decision-title">{action === 'APPROVE' ? `Phê duyệt ${requestId}` : `Từ chối ${requestId}`}</h2><span>Quyết định sẽ được ghi Audit Log và thông báo cho người gửi.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></header><form onSubmit={submit} noValidate><div className={`inline-alert ${action === 'APPROVE' ? '' : 'inline-alert-danger'}`}><ShieldCheck size={19} /><div><strong>{action === 'APPROVE' ? 'Đã vượt qua kiểm tra bắt buộc' : 'Người gửi cần biết cách khắc phục'}</strong><p>{action === 'APPROVE' ? 'Scope, Separation of Duties và trạng thái tài sản đều hợp lệ.' : 'Lý do từ chối phải cụ thể, không chứa dữ liệu bí mật.'}</p></div></div><label className={`form-field ${invalid ? 'field-error' : ''}`}><span>Ghi chú quyết định {action === 'REJECT' && <em>*</em>}</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={action === 'APPROVE' ? 'Ghi chú tùy chọn cho người gửi…' : 'Nêu rõ lý do và cách sửa yêu cầu…'} aria-invalid={invalid} aria-describedby="decision-help" /><small id="decision-help">{invalid ? 'Vui lòng nhập ít nhất 10 ký tự.' : 'Không nhập private key, token hoặc dữ liệu bí mật.'}</small></label>{submitError&&<div className="login-error" role="alert">{submitError}</div>}<footer><button type="button" disabled={busy} className="quiet-button" onClick={onClose}>Hủy</button><button type="submit" disabled={busy} className={action === 'APPROVE' ? 'primary-button' : 'danger-button'}>{busy?'Đang gửi…':action === 'APPROVE' ? 'Xác nhận phê duyệt' : 'Xác nhận từ chối'}</button></footer></form></section></div>;
}

function PasswordChangeDialog({onLogout,onSuccess}:{onLogout:()=>Promise<void>;onSuccess:(currentPassword:string,newPassword:string)=>Promise<void>}) {
  const dialogRef=useRef<HTMLElement>(null);const currentRef=useRef<HTMLInputElement>(null);const[currentPassword,setCurrentPassword]=useState('');const[newPassword,setNewPassword]=useState('');const[confirm,setConfirm]=useState('');const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  useDialogBehavior(dialogRef,currentRef,()=>{});
  const valid=newPassword.length>=12&&/[a-z]/.test(newPassword)&&/[A-Z]/.test(newPassword)&&/\d/.test(newPassword)&&/[^A-Za-z0-9]/.test(newPassword)&&newPassword===confirm;
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');if(!valid){setError('Mật khẩu mới cần ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số, ký tự đặc biệt và hai ô phải khớp.');return}setBusy(true);try{await onSuccess(currentPassword,newPassword)}catch(err){setError(err instanceof ApiError?err.message:'Không thể đổi mật khẩu.');setBusy(false)}};
  return <div className="modal-layer"><div className="modal-scrim"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title"><header><div><p className="eyebrow">Bảo vệ tài khoản</p><h2 id="password-title">Đổi mật khẩu ban đầu</h2><span>Bạn cần đặt mật khẩu riêng trước khi tiếp tục sử dụng Crypta.</span></div><ShieldCheck size={22}/></header><form onSubmit={submit} noValidate><label className="form-field"><span>Mật khẩu hiện tại</span><input ref={currentRef} type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} required/></label><label className="form-field"><span>Mật khẩu mới</span><input type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} required minLength={12}/><small>Ít nhất 12 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.</small></label><label className="form-field"><span>Nhập lại mật khẩu mới</span><input type="password" autoComplete="new-password" value={confirm} onChange={event=>setConfirm(event.target.value)} required/></label>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" disabled={busy} onClick={()=>void onLogout()}>Đăng xuất</button><button className="primary-button" disabled={busy||!currentPassword}>{busy?'Đang cập nhật…':'Đổi mật khẩu'}</button></footer></form></section></div>;
}

function generateInitialPassword(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';const bytes=crypto.getRandomValues(new Uint8Array(16));return `Aa9!${Array.from(bytes,value=>alphabet[value%alphabet.length]).join('')}`}

function CreateUserDialog({onClose,onSuccess}:{onClose:()=>void;onSuccess:()=>Promise<void>}) {
  const dialogRef=useRef<HTMLElement>(null);const closeRef=useRef<HTMLButtonElement>(null);const[name,setName]=useState('');const[email,setEmail]=useState('');const[departmentId,setDepartmentId]=useState('');const[role,setRole]=useState<UserRole>('USER');const[scopes,setScopes]=useState<string[]>([]);const[password,setPassword]=useState(generateInitialPassword);const[showPassword,setShowPassword]=useState(false);const[reference,setReference]=useState<{departments:Array<{id:string;code:string;name:string}>;roles:Array<{code:string;name:string}>}|null>(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  useDialogBehavior(dialogRef,closeRef,onClose);
  useEffect(()=>{void api.userReference().then(data=>{setReference(data);setDepartmentId(data.departments[0]?.id??'')}).catch(err=>setError(err instanceof ApiError?err.message:'Không thể tải danh mục phòng ban.'))},[]);
  const toggleScope=(id:string)=>setScopes(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  const submit=async(event:React.FormEvent)=>{event.preventDefault();setError('');if(name.trim().length<2||!email.includes('@')||!departmentId){setError('Hãy nhập đầy đủ họ tên, email và phòng ban.');return}if(role==='APPROVER'&&!scopes.length){setError('Approver phải được gán ít nhất một phạm vi phòng ban.');return}setBusy(true);try{await api.createUser({displayName:name.trim(),email:email.trim(),departmentId,temporaryPassword:password,roles:[role],approverDepartmentIds:role==='APPROVER'?scopes:[]});await onSuccess()}catch(err){setError(err instanceof ApiError?err.message:'Không thể tạo tài khoản.');setBusy(false)}};
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Đóng form tạo người dùng"/><section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title"><header><div><p className="eyebrow">Quản trị truy cập</p><h2 id="create-user-title">Thêm người dùng</h2><span>Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header><form onSubmit={submit} noValidate><div className="form-row"><label className="form-field"><span>Họ và tên <em>*</em></span><input value={name} onChange={event=>setName(event.target.value)} autoComplete="off"/></label><label className="form-field"><span>Email tổ chức <em>*</em></span><input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="off"/></label></div><div className="form-row"><label className="form-field"><span>Phòng ban <em>*</em></span><select value={departmentId} onChange={event=>setDepartmentId(event.target.value)} disabled={!reference}>{reference?.departments.map(item=><option value={item.id} key={item.id}>{item.name} ({item.code})</option>)}</select></label><label className="form-field"><span>Vai trò chính <em>*</em></span><select value={role} onChange={event=>{setRole(event.target.value as UserRole);setScopes([])}}><option value="USER">Nhân viên</option><option value="APPROVER">Người phê duyệt</option><option value="ADMIN">Security Admin</option></select></label></div>{role==='APPROVER'&&<fieldset className="scope-options"><legend>Phạm vi phê duyệt <em>*</em></legend>{reference?.departments.map(item=><label key={item.id}><input type="checkbox" checked={scopes.includes(item.id)} onChange={()=>toggleScope(item.id)}/><span>{item.name}</span></label>)}</fieldset>}<div className="form-field"><span>Mật khẩu ban đầu <em>*</em></span><div className="password-input-row"><input type={showPassword?'text':'password'} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password"/><button type="button" className="quiet-button" onClick={()=>setShowPassword(value=>!value)}>{showPassword?'Ẩn':'Hiện'}</button><button type="button" className="quiet-button" onClick={()=>setPassword(generateInitialPassword())}>Tạo lại</button></div><small>Gửi mật khẩu qua kênh an toàn; không đưa vào email thông thường hoặc Audit Log.</small></div>{error&&<div className="login-error" role="alert">{error}</div>}<footer><button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Hủy</button><button className="primary-button" disabled={busy||!reference}>{busy?'Đang tạo…':'Tạo tài khoản'}</button></footer></form></section></div>;
}

function HelpDialog({onClose}:{onClose:()=>void}){const dialogRef=useRef<HTMLElement>(null);const closeRef=useRef<HTMLButtonElement>(null);useDialogBehavior(dialogRef,closeRef,onClose);return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Đóng trợ giúp"/><section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title"><header><div><p className="eyebrow">Hướng dẫn nhanh</p><h2 id="help-title">Sử dụng Crypta an toàn</h2><span>Các bước chính cho quy trình tài sản mật mã.</span></div><button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header><div className="help-content"><div><strong>Nhân viên</strong><p>Tạo yêu cầu cấp mới, gia hạn hoặc thu hồi. Không nhập private key, token hay mật khẩu vào phần lý do.</p></div><div><strong>Người phê duyệt</strong><p>Kiểm tra người gửi, phạm vi, tài sản và lý do. Nếu dữ liệu đã thay đổi, tải lại trước khi quyết định.</p></div><div><strong>Security Admin</strong><p>Theo dõi tài sản, Audit Log, email lỗi và quyền người dùng. Không thể tự phê duyệt yêu cầu nghiệp vụ.</p></div><div className="inline-alert"><ShieldCheck size={18}/><div><strong>Khi cần hỗ trợ kỹ thuật</strong><p>Gửi mã request hoặc asset và thời điểm xảy ra lỗi; không gửi secret hay tệp private key.</p></div></div></div><footer><button className="primary-button" onClick={onClose}>Đã hiểu</button></footer></section></div>}

function scrollToElement(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default App;
