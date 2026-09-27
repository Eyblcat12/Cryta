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
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  Plus,
  RotateCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from './api';
import { LoginScreen } from './LoginScreen';
import type { Asset, AssetFilter, AuthUser, RequestItem, UserRole } from './types';

// Modular subcomponents
import { AdminDashboard } from './components/AdminDashboard';
import { ApproverDashboard } from './components/ApproverDashboard';
import { AssetDrawer, assetStatus } from './components/AssetDrawer';
import { CreateUserDialog } from './components/CreateUserDialog';
import { DecisionDialog } from './components/DecisionDialog';
import { HelpDialog } from './components/HelpDialog';
import { OverviewInsights } from './components/OverviewInsights';
import { PasswordChangeDialog } from './components/PasswordChangeDialog';
import { PolicyModal } from './components/PolicyModal';
import { RequestDrawer, requestStatus } from './components/RequestDrawer';
import { RequestModal, type PolicyOption, type RequestType } from './components/RequestModal';
import { StatusPill } from './components/StatusPill';

type Theme = 'light' | 'dark';
type RequestModalState = { type: RequestType; assetId?: string } | null;

const roleMeta: Record<UserRole, { label: string; eyebrow: string; name: string; initials: string; department: string }> = {
  USER: { label: 'Nhân viên', eyebrow: 'Không gian cá nhân', name: 'Nguyễn Văn Dev', initials: 'ND', department: 'CNTT' },
  APPROVER: { label: 'Người phê duyệt', eyebrow: 'Trung tâm phê duyệt', name: 'Lê Minh', initials: 'LM', department: 'CNTT' },
  ADMIN: { label: 'Quản trị bảo mật', eyebrow: 'Điều hành an toàn', name: 'Phạm Hà', initials: 'PH', department: 'An toàn thông tin' },
};

function App() {
  const [theme, setTheme] = useState<Theme>(() => (window.localStorage.getItem('crypta-theme') as Theme | null) ?? 'light');
  const [mobileNav, setMobileNav] = useState(false);
  const [sessionState, setSessionState] = useState<'LOADING' | 'GUEST' | 'READY'>('LOADING');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [role, setRole] = useState<UserRole>('USER');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [dashboard, setDashboard] = useState<any>(null);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [dataState, setDataState] = useState<'LOADING' | 'READY' | 'ERROR'>('LOADING');
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
  const [authNotice, setAuthNotice] = useState('');
  const [createUserModal, setCreateUserModal] = useState(false);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const globalSearchRef = useRef<HTMLInputElement>(null);

  const loadData = async () => {
    setDataState('LOADING');
    setDataError('');
    try {
      const [nextAssets, nextRequests, nextPolicies, nextDashboard, nextNotifications, nextUsers, nextAudit] = await Promise.all([
        api.assets(),
        api.requests(),
        api.policies(),
        api.dashboard(),
        api.notifications(),
        user?.roles.includes('ADMIN') ? api.users() : Promise.resolve([]),
        user?.roles.includes('ADMIN') ? api.auditLogs() : Promise.resolve([]),
      ]);
      setAssets(nextAssets);
      setRequests(nextRequests);
      setPolicies(nextPolicies);
      setDashboard(nextDashboard);
      setNotifications(nextNotifications);
      setAdminUsers(nextUsers);
      setAuditLogs(nextAudit);
      setDataState('READY');
    } catch (error) {
      setDataState('ERROR');
      setDataError(error instanceof ApiError ? error.message : 'Không thể tải dữ liệu.');
    }
  };

  useEffect(() => {
    void api.restore()
      .then((current) => {
        setUser(current);
        setRole(current.roles.includes('ADMIN') ? 'ADMIN' : current.roles.includes('APPROVER') ? 'APPROVER' : 'USER');
        setSessionState('READY');
      })
      .catch(() => setSessionState('GUEST'));
  }, []);

  useEffect(() => {
    if (sessionState === 'READY' && user) void loadData();
  }, [sessionState, user?.id, role]);

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
      const matchesQuery = !normalized || [asset.code, asset.name, asset.purpose, asset.algorithm].some((v) =>
        v.toLocaleLowerCase('vi').includes(normalized)
      );
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

  if (sessionState === 'LOADING') {
    return (
      <main className="session-loading" role="status">
        <span className="loading-spinner" />
        <strong>Đang khôi phục phiên an toàn…</strong>
      </main>
    );
  }

  if (sessionState === 'GUEST' || !user) {
    return (
      <LoginScreen
        notice={authNotice}
        onLogin={(current) => {
          setAuthNotice('');
          setUser(current);
          setRole(current.roles.includes('ADMIN') ? 'ADMIN' : current.roles.includes('APPROVER') ? 'APPROVER' : 'USER');
          setSessionState('READY');
        }}
      />
    );
  }

  const initials = user.displayName.split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase();
  const currentRole = { ...roleMeta[role], name: user.displayName, initials };
  const priorityAsset = assets.find((asset) => asset.status === 'EXPIRING_SOON');
  const activeAssetCount = assets.filter((asset) => asset.status === 'ACTIVE').length;
  const expiringAssetCount = assets.filter((asset) => asset.status === 'EXPIRING_SOON').length;
  const pendingRequestCount = requests.filter((request) => request.status === 'PENDING').length;
  const unreadNotificationCount = notifications.filter((item) => !item.readAt).length;

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
            {role === 'USER' && (
              <>
                <button className="nav-item" onClick={() => scrollTo('assets')}>
                  <KeyRound size={19} /> Tài sản của tôi <span className="nav-count">{assets.length}</span>
                </button>
                <button className="nav-item" onClick={() => scrollTo('requests')}>
                  <FileText size={19} /> Yêu cầu <span className="nav-count nav-count-warn">{pendingRequestCount}</span>
                </button>
                <button className="nav-item" onClick={() => openRequest()}>
                  <Plus size={19} /> Tạo yêu cầu
                </button>
              </>
            )}
            {role === 'APPROVER' && (
              <>
                <button className="nav-item" onClick={() => scrollTo('approval-queue')}>
                  <ClipboardList size={19} /> Hàng chờ phê duyệt <span className="nav-count nav-count-warn">{pendingRequestCount}</span>
                </button>
                <button className="nav-item" onClick={() => scrollTo('approval-history')}>
                  <FileText size={19} /> Lịch sử quyết định
                </button>
              </>
            )}
            {role === 'ADMIN' && (
              <>
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
              </>
            )}
          </div>
          <div className="nav-group">
            <p className="nav-label">Theo dõi</p>
            <button className="nav-item" onClick={() => scrollTo(role === 'USER' ? 'notifications' : 'overview')}>
              <Bell size={19} /> Thông báo {unreadNotificationCount > 0 && <span className="unread-dot" aria-label={`${unreadNotificationCount} thông báo chưa đọc`} />}
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
            <button className="icon-button" aria-label={`Chuyển sang giao diện ${theme === 'light' ? 'tối' : 'sáng'}`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            </button>
            <button className={`icon-button ${unreadNotificationCount > 0 ? 'has-alert' : ''}`} aria-label={unreadNotificationCount > 0 ? `${unreadNotificationCount} thông báo chưa đọc` : 'Thông báo'} onClick={() => scrollTo('notifications')}>
              <Bell size={19} />{unreadNotificationCount > 0 && <span />}
            </button>
            <button className="icon-button" aria-label="Đăng xuất" onClick={async () => { await api.logout(); setUser(null); setSessionState('GUEST'); }}>
              <LogOut size={18} />
            </button>
            <div className="topbar-divider" />
            <div className="role-control">
              <button className="role-switcher" aria-label={`Vai trò hiện tại: ${currentRole.label}`} aria-expanded={roleMenu} aria-haspopup="menu" onClick={() => setRoleMenu((open) => !open)}>
                <span className="role-icon"><ShieldCheck size={16} /></span>
                <span><small>Vai trò hiện tại</small><strong>{currentRole.label}</strong></span>
                <ChevronDown size={16} />
              </button>
              {roleMenu && (
                <div className="role-menu" role="menu" aria-label="Chuyển vai trò demo">
                  {user.roles.map((value) => (
                    <button key={value} role="menuitemradio" aria-checked={role === value} onClick={() => changeRole(value)}>
                      <span className="role-option-icon">{roleMeta[value].initials}</span>
                      <span><strong>{roleMeta[value].label}</strong><small>{roleMeta[value].department}</small></span>
                      {role === value && <Check size={16} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {dataState === 'LOADING' && <div className="data-banner" role="status"><span className="loading-spinner" /> Đang đồng bộ dữ liệu mới nhất…</div>}
          {dataState === 'ERROR' && <div className="data-banner data-banner-error" role="alert"><span>{dataError}</span><button onClick={() => void loadData()}>Thử lại</button></div>}

          {role === 'USER' ? (
            <>
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
                  <div><span>Tài sản hoạt động</span><strong>{assets.length ? Math.round((activeAssetCount / assets.length) * 100) : 0}%</strong></div>
                  <span className="metric-caption">{activeAssetCount}/{assets.length} tài sản</span>
                </article>
              </section>

              <OverviewInsights role="USER" dashboard={dashboard} />

              {priorityAsset && (
                <section className="expiry-banner" aria-labelledby="expiry-title">
                  <div className="expiry-symbol"><AlertTriangle size={22} /></div>
                  <div className="expiry-copy">
                    <div className="banner-title-line">
                      <h2 id="expiry-title">{priorityAsset.name} sắp hết hạn</h2>
                      <StatusPill label={`Còn ${priorityAsset.daysLeft} ngày`} tone="warning" />
                    </div>
                    <p><strong>{priorityAsset.code}</strong> hết hạn ngày {priorityAsset.expiresAt}. Gia hạn sớm để tránh gián đoạn.</p>
                  </div>
                  <button className="secondary-button" onClick={() => openRequest('RENEW', priorityAsset.id)}>
                    Yêu cầu gia hạn <ArrowRight size={17} />
                  </button>
                </section>
              )}

              <section className="lifecycle-section" aria-labelledby="lifecycle-title">
                <header className="lifecycle-header">
                  <div>
                    <h2 id="lifecycle-title">Phân bổ thời hạn</h2>
                    <p>Tài sản đang hiệu lực · cập nhật tự động</p>
                  </div>
                  <span className="lifecycle-summary"><strong>{expiringAssetCount}</strong> cần xử lý sớm</span>
                </header>
                <div className="lifecycle-layout">
                  <figure className="distribution-figure">
                    <div className="distribution-heading">
                      <span>Theo thời gian còn lại</span>
                      <strong>{assets.length} tài sản</strong>
                    </div>
                    <div className="distribution-bar" role="img" aria-label="Biểu đồ phân bổ tài sản">
                      <span className="distribution-urgent" aria-hidden="true" />
                      <span className="distribution-longterm" aria-hidden="true" />
                    </div>
                    <div className="distribution-legend">
                      <div><span className="legend-mark mark-urgent" /><span><strong>{expiringAssetCount}</strong> ≤ 30 ngày</span></div>
                      <div><span className="legend-mark mark-longterm" /><span><strong>{activeAssetCount - expiringAssetCount}</strong> &gt; 30 ngày</span></div>
                    </div>
                    <figcaption>Phân nhóm theo chính sách cảnh báo hiện tại.</figcaption>
                  </figure>
                  <div className="priority-panel">
                    <span className="priority-label">Ưu tiên tiếp theo</span>
                    <button disabled={!priorityAsset} onClick={() => priorityAsset && openRequest('RENEW', priorityAsset.id)}>
                      <span className="priority-date"><strong>{priorityAsset?.daysLeft ?? '—'}</strong><small>ngày</small></span>
                      <span className="priority-copy">
                        <strong>{priorityAsset?.name ?? 'Không có tài sản cần xử lý'}</strong>
                        <small>{priorityAsset ? `${priorityAsset.code} · ${priorityAsset.expiresAt}` : 'Hệ thống đang ổn định'}</small>
                      </span>
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
                        ['ALL', 'Tất cả', assets.length],
                        ['ACTIVE', 'Hoạt động', activeAssetCount],
                        ['EXPIRING_SOON', 'Sắp hết hạn', expiringAssetCount],
                        ['ENDED', 'Đã kết thúc', assets.length - activeAssetCount - expiringAssetCount],
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
                      <thead>
                        <tr>
                          <th>Tài sản</th>
                          <th>Loại</th>
                          <th>Thuật toán</th>
                          <th>Trạng thái</th>
                          <th>Hết hạn</th>
                          <th><span className="sr-only">Hành động</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAssets.map((asset) => {
                          const Icon = asset.type === 'KEY' ? KeyRound : FileKey2;
                          return (
                            <tr key={asset.id}>
                              <td>
                                <button className="asset-cell" onClick={() => setSelectedAsset(asset)}>
                                  <span className={`asset-type-icon ${asset.type === 'CERTIFICATE' ? 'certificate' : ''}`}><Icon size={18} /></span>
                                  <span><strong>{asset.name}</strong><small>{asset.code}</small></span>
                                </button>
                              </td>
                              <td>{asset.type === 'KEY' ? 'Khóa mã hóa' : 'Chứng thư số'}</td>
                              <td><span className="mono-soft">{asset.algorithm}</span></td>
                              <td><StatusPill {...assetStatus[asset.status]} /></td>
                              <td>
                                <div className="expiry-cell">
                                  <strong>{asset.expiresAt}</strong>
                                  <small>{asset.daysLeft > 0 ? `${asset.daysLeft} ngày` : 'Đã kết thúc'}</small>
                                </div>
                              </td>
                              <td>
                                <button className="row-action" aria-label={`Mở ${asset.name}`} onClick={() => setSelectedAsset(asset)}>
                                  <ChevronRight size={18} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {filteredAssets.length === 0 && (
                      <div className="empty-state">
                        <Search size={24} />
                        <strong>Không tìm thấy tài sản</strong>
                        <p>Thử từ khóa khác hoặc xóa bộ lọc hiện tại.</p>
                        <button onClick={() => { setFilter('ALL'); setQuery(''); }}>Xóa bộ lọc</button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <div className="two-column-grid">
                <section id="requests" className="content-section compact-section" aria-labelledby="requests-title">
                  <div className="section-heading">
                    <div><h2 id="requests-title">Yêu cầu gần đây</h2><p>Theo dõi tiến độ xử lý.</p></div>
                    <button className="icon-button" aria-label="Làm mới" onClick={() => void loadData()}><RotateCw size={17} /></button>
                  </div>
                  <div className="request-list">
                    {requests.slice(0, showAllRequests ? requests.length : 3).map((request) => (
                      <button className="request-item" key={request.id} onClick={() => setSelectedRequest(request)}>
                        <span className={`request-symbol request-${request.type.toLowerCase()}`}>
                          {request.type === 'CREATE' ? <Plus size={17} /> : request.type === 'RENEW' ? <RotateCw size={17} /> : <X size={17} />}
                        </span>
                        <span className="request-main">
                          <strong>{request.subject}</strong>
                          <small>{request.id} · {request.submittedAt}</small>
                        </span>
                        {request.emergency && <span className="emergency-label">Khẩn cấp</span>}
                        <StatusPill {...requestStatus[request.status]} />
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                  <button className="section-footer-button" aria-expanded={showAllRequests} onClick={() => setShowAllRequests((show) => !show)}>
                    {showAllRequests ? 'Thu gọn danh sách' : 'Xem toàn bộ lịch sử'} <ArrowRight className={showAllRequests ? 'rotate-up' : ''} size={16} />
                  </button>
                </section>

                <section id="notifications" className="content-section compact-section" aria-labelledby="notifications-title">
                  <div className="section-heading">
                    <div><h2 id="notifications-title">Hoạt động mới</h2><p>Cập nhật quan trọng với tài sản của bạn.</p></div>
                    <button className="text-button" disabled={unreadNotificationCount === 0} onClick={async () => { await api.markAllNotificationsRead(); await loadData(); setToast('Đã đánh dấu tất cả là đã đọc.'); }}>
                      <Check size={15} /> Đánh dấu đã đọc
                    </button>
                  </div>
                  <div className="activity-list">
                    {notifications.length ? (
                      notifications.slice(0, 5).map((item) => (
                        <article key={item.id}>
                          <span className={`activity-icon ${item.type.includes('EXPIRED') || item.type.includes('REJECTED') ? 'activity-warning' : 'activity-success'}`}><Bell size={17} /></span>
                          <div>
                            <strong>
                              {item.type === 'REQUEST_APPROVED' ? 'Yêu cầu đã được duyệt' : item.type === 'REQUEST_REJECTED' ? 'Yêu cầu bị từ chối' : item.type === 'ASSET_EXPIRING' ? 'Tài sản sắp hết hạn' : item.type === 'ASSET_EXPIRED' ? 'Tài sản đã hết hạn' : item.type === 'ASSET_REVOKED' ? 'Tài sản đã thu hồi' : 'Yêu cầu mới'}
                            </strong>
                            <p>{item.assetCode ?? item.description ?? item.requestId}</p>
                            <time>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.createdAt))}</time>
                          </div>
                          {!item.readAt && <span className="activity-unread" />}
                        </article>
                      ))
                    ) : (
                      <div className="empty-state"><Bell size={22} /><strong>Chưa có thông báo</strong><p>Cập nhật mới sẽ xuất hiện tại đây.</p></div>
                    )}
                  </div>
                </section>
              </div>
            </>
          ) : role === 'APPROVER' ? (
            <ApproverDashboard requests={requests} dashboard={dashboard} searchQuery={globalQuery} onDecision={(action, requestId) => setDecisionModal({ action, requestId })} />
          ) : (
            <AdminDashboard
              dashboard={dashboard}
              assets={assets}
              policies={policies}
              users={adminUsers}
              audits={auditLogs}
              searchQuery={globalQuery}
              currentUserId={user.id}
              onCreateUser={() => setCreateUserModal(true)}
              onOpenPolicyModal={() => setPolicyModalOpen(true)}
              onReload={loadData}
              onNotify={setToast}
            />
          )}

          <footer className="app-footer">
            <span>Crypta · Quản lý vòng đời mật mã</span>
            <span>Dữ liệu đồng bộ từ PostgreSQL</span>
          </footer>
        </main>
      </div>

      {selectedAsset && (
        <AssetDrawer
          asset={selectedAsset}
          isAdmin={role === 'ADMIN'}
          onClose={() => setSelectedAsset(null)}
          onRenew={() => openRequest('RENEW', selectedAsset.id)}
          onRevoke={() => openRequest('REVOKE', selectedAsset.id)}
          onEmergencyRevoke={async (assetId, reason) => {
            await api.emergencyRevoke(assetId, reason);
            setToast(`Đã thu hồi khẩn cấp tài sản ${selectedAsset.code}.`);
            await loadData();
          }}
        />
      )}

      {selectedRequest && <RequestDrawer request={selectedRequest} onClose={() => setSelectedRequest(null)} />}

      {requestModal && (
        <RequestModal
          assets={assets}
          policies={policies}
          initialType={requestModal.type}
          initialAssetId={requestModal.assetId}
          onClose={() => setRequestModal(null)}
          onSuccess={async (type, body) => {
            await api.createRequest(body);
            setRequestModal(null);
            await loadData();
            setToast(type === 'REVOKE' ? 'Yêu cầu thu hồi khẩn cấp đã được gửi.' : 'Yêu cầu đã được gửi thành công.');
          }}
        />
      )}

      {decisionModal && (
        <DecisionDialog
          action={decisionModal.action}
          requestId={decisionModal.requestId}
          onClose={() => setDecisionModal(null)}
          onSuccess={async (action, requestId, note) => {
            await api.decide(requestId, {
              decision: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
              comment: note || undefined,
              version: String(requests.find((item) => item.id === requestId)?.version ?? '') || undefined,
            });
            setDecisionModal(null);
            await loadData();
            setToast(action === 'APPROVE' ? `${requestId} đã được phê duyệt.` : `${requestId} đã bị từ chối.`);
          }}
        />
      )}

      {user.mustChangePassword && (
        <PasswordChangeDialog
          onLogout={async () => { await api.logout(); setUser(null); setSessionState('GUEST'); }}
          onSuccess={async (currentPassword, newPassword) => {
            await api.changePassword(currentPassword, newPassword);
            setAuthNotice('Hãy đăng nhập lại bằng mật khẩu mới.');
            setUser(null);
            setSessionState('GUEST');
          }}
        />
      )}

      {createUserModal && (
        <CreateUserDialog
          onClose={() => setCreateUserModal(false)}
          onSuccess={async () => {
            setCreateUserModal(false);
            await loadData();
            setToast('Đã tạo tài khoản thành công.');
          }}
        />
      )}

      {policyModalOpen && (
        <PolicyModal
          existingPolicies={policies}
          onClose={() => setPolicyModalOpen(false)}
          onSuccess={async () => {
            await loadData();
            setToast('Cập nhật chính sách thành công.');
          }}
        />
      )}

      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          <span>{toast}</span>
          <button aria-label="Đóng thông báo" onClick={() => setToast(null)}><X size={16} /></button>
        </div>
      )}
    </div>
  );
}

export default App;
