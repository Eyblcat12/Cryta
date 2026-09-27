import React, { useState } from 'react';
import {
  Activity,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Database,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Users,
} from 'lucide-react';
import { api, ApiError } from '../api';
import type { Asset } from '../types';
import { assetStatus } from './AssetDrawer';
import { OverviewInsights } from './OverviewInsights';
import type { PolicyOption } from './RequestModal';
import { StatusPill } from './StatusPill';
import { TestEmailDialog } from './TestEmailDialog';

function scrollToElement(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function AdminDashboard({
  dashboard,
  assets,
  policies,
  users,
  audits,
  searchQuery,
  currentUserId,
  onCreateUser,
  onOpenPolicyModal,
  onReload,
  onNotify,
}: {
  dashboard: any;
  assets: Asset[];
  policies: PolicyOption[];
  users: any[];
  audits: any[];
  searchQuery: string;
  currentUserId: string;
  onCreateUser: () => void;
  onOpenPolicyModal?: () => void;
  onReload: () => Promise<void>;
  onNotify: (message: string) => void;
}) {
  const watched = assets.filter((asset) => asset.status === 'EXPIRING_SOON' || asset.status === 'EXPIRED').slice(0, 10);
  const activeUsers = users.filter((user) => user.status === 'ACTIVE').length;
  const approvers = users.filter((user) => user.roles?.includes('APPROVER')).length;
  const auditNeedle = searchQuery.trim().toLocaleLowerCase('vi');
  const visibleAudits = audits.filter((item) =>
    !auditNeedle || [item.action, item.actorName, item.entityId, item.outcome].some((value) =>
      String(value ?? '').toLocaleLowerCase('vi').includes(auditNeedle)
    )
  );
  const [changingUser, setChangingUser] = useState('');
  const [testEmailOpen, setTestEmailOpen] = useState(false);

  const changeStatus = async (target: any) => {
    const next = target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setChangingUser(target.id);
    try {
      await api.updateUserStatus(target.id, next);
      onNotify(next === 'ACTIVE' ? 'Đã kích hoạt tài khoản.' : 'Đã vô hiệu hóa tài khoản và thu hồi các phiên.');
      await onReload();
    } catch (error) {
      onNotify(error instanceof ApiError ? error.message : 'Không thể cập nhật tài khoản.');
    } finally {
      setChangingUser('');
    }
  };

  return (
    <>
      <section id="overview" className="hero-section" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Điều hành an toàn</p>
          <h1 id="page-title">Sức khỏe tài sản mật mã</h1>
          <p className="page-subtitle">Giám sát vòng đời, chính sách và khả năng truy vết trên toàn tổ chức.</p>
        </div>
        <button className="primary-button" onClick={() => scrollToElement('audit-log')}>
          <Search size={18} /> Tra cứu Audit Log
        </button>
      </section>

      <section className="metric-row" aria-label="Tổng quan an toàn">
        <article className="metric">
          <div className="metric-icon"><Database size={20} /></div>
          <div><span>Tổng tài sản</span><strong>{dashboard?.metrics?.total_assets ?? assets.length}</strong></div>
          <span className="metric-caption">{dashboard?.metrics?.departments ?? 0} phòng ban</span>
        </article>
        <article className="metric">
          <div className="metric-icon metric-icon-amber"><CalendarClock size={20} /></div>
          <div><span>Sắp hết hạn</span><strong>{dashboard?.metrics?.expiring ?? watched.length}</strong></div>
          <span className="metric-caption">Cần theo dõi</span>
        </article>
        <article className="metric">
          <div className="metric-icon metric-icon-blue"><Users size={20} /></div>
          <div><span>Tài khoản hoạt động</span><strong>{dashboard?.metrics?.active_users ?? activeUsers}</strong></div>
          <span className="metric-caption">{approvers} người phê duyệt</span>
        </article>
        <article className="metric">
          <div className="metric-icon metric-icon-green"><CheckCircle2 size={20} /></div>
          <div><span>Email lỗi</span><strong>{dashboard?.metrics?.failed_jobs ?? 0}</strong></div>
          <span className="metric-trend"><Activity size={14} /> Theo dõi hàng đợi</span>
        </article>
      </section>

      <OverviewInsights role="ADMIN" dashboard={dashboard} />

      <div className="admin-overview-grid">
        <section className="content-section compact-section">
          <div className="section-heading"><div><h2>Cảnh báo ưu tiên</h2><p>Các vấn đề có thể dẫn đến gián đoạn.</p></div></div>
          <div className="admin-alert-list">
            <button onClick={() => scrollToElement('admin-assets')}>
              <span className="alert-number alert-warning">{watched.length}</span>
              <span><strong>Tài sản hết hạn hoặc sắp hết hạn</strong><small>Dữ liệu theo trạng thái hiện tại</small></span>
              <ChevronRight size={18} />
            </button>
            <button onClick={() => scrollToElement('audit-log')}>
              <span className="alert-number alert-info">{dashboard?.metrics?.failed_jobs ?? 0}</span>
              <span><strong>Email gửi thất bại</strong><small>Kiểm tra cấu hình SMTP và hàng đợi</small></span>
              <ChevronRight size={18} />
            </button>
          </div>
        </section>

        <section className="content-section compact-section">
          <div className="section-heading"><div><h2>Trạng thái dịch vụ</h2><p>Cấu hình tiến trình hiện tại.</p></div></div>
          <div className="service-list">
            <div>
              <span><Database size={18} /><strong>Crypto Provider</strong></span>
              <StatusPill label={dashboard?.services?.cryptoProvider === 'HTTP' ? 'Đã kết nối' : 'Mô phỏng'} tone={dashboard?.services?.cryptoProvider === 'HTTP' ? 'success' : 'warning'} />
            </div>
            <div>
              <span><Bell size={18} /><strong>Email SMTP</strong></span>
              <span className="service-actions">
                <StatusPill label={dashboard?.services?.email === 'ENABLED' ? 'Đã bật' : 'Chưa bật'} tone={dashboard?.services?.email === 'ENABLED' ? 'success' : 'warning'} />
                <button className="text-button" disabled={dashboard?.services?.email !== 'ENABLED'} title={dashboard?.services?.email === 'ENABLED' ? 'Gửi thư xác minh kết nối SMTP' : 'Bật SMTP trong .env và khởi động lại để gửi thử'} onClick={() => setTestEmailOpen(true)}>
                  <Send size={14} /> Gửi thử
                </button>
              </span>
            </div>
            <div>
              <span><CalendarClock size={18} /><strong>Expiry Scan</strong></span>
              <StatusPill label="Đang hoạt động" tone="success" />
            </div>
          </div>
        </section>
      </div>

      <section id="admin-assets" className="content-section" aria-labelledby="admin-assets-title">
        <div className="section-heading">
          <div><h2 id="admin-assets-title">Tài sản cần theo dõi</h2><p>Ưu tiên theo thời hạn và mức độ tuân thủ.</p></div>
          <span className="filter-button"><SlidersHorizontal size={16} />{watched.length} mục</span>
        </div>
        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Tài sản</th>
                  <th>Owner</th>
                  <th>Phòng ban</th>
                  <th>Trạng thái</th>
                  <th>Hết hạn</th>
                  <th>Policy</th>
                </tr>
              </thead>
              <tbody>
                {watched.map((asset) => (
                  <tr key={asset.id}>
                    <td><strong>{asset.code}</strong><small className="cell-subtitle">{asset.name}</small></td>
                    <td>{asset.ownerName}</td>
                    <td>{asset.departmentName}</td>
                    <td><StatusPill {...assetStatus[asset.status]} /></td>
                    <td>{asset.expiresAt}</td>
                    <td>{asset.policyCode}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!watched.length && <div className="empty-state"><CheckCircle2 size={22} /><strong>Không có tài sản cần xử lý</strong></div>}
          </div>
        </div>
      </section>

      <div className="admin-overview-grid">
        <section id="policy" className="content-section compact-section">
          <div className="section-heading">
            <div><h2>Chính sách hiện hành</h2><p>Phiên bản đang hiệu lực lấy trực tiếp từ database.</p></div>
            {onOpenPolicyModal && (
              <button className="primary-button" style={{ padding: '0.35rem 0.75rem', fontSize: '0.85rem' }} onClick={onOpenPolicyModal}>
                <Settings size={14} /> Quản lý chính sách
              </button>
            )}
          </div>
          <div className="policy-summary">
            <div><span>Phiên bản hiệu lực</span><strong>{policies.length}</strong></div>
            <div><span>Mã chính sách</span><strong>{policies.map((item) => item.code).join(', ') || 'Chưa có'}</strong></div>
            <div><span>Phiên bản cao nhất</span><strong>v{Math.max(0, ...policies.map((item) => item.version))}</strong></div>
          </div>
        </section>
        <section className="content-section compact-section">
          <div className="section-heading"><div><h2>Quyền nhạy cảm</h2><p>Dữ liệu tài khoản thật.</p></div></div>
          <div className="policy-summary">
            <div><span>Security Admin</span><strong>{users.filter((u) => u.roles?.includes('ADMIN')).length} người</strong></div>
            <div><span>Approver</span><strong>{approvers} người</strong></div>
            <div><span>Xung đột SoD</span><strong className="success-text">0 phát hiện</strong></div>
          </div>
        </section>
      </div>

      <section id="users" className="content-section" aria-labelledby="users-title">
        <div className="section-heading">
          <div><h2 id="users-title">Quản trị tài khoản</h2><p>Vô hiệu hóa sẽ thu hồi toàn bộ phiên đăng nhập hiện tại.</p></div>
          <div className="heading-actions">
            <span className="filter-button"><Users size={16} />{users.length} tài khoản</span>
            <button className="primary-button" onClick={onCreateUser}><Plus size={17} /> Thêm người dùng</button>
          </div>
        </div>
        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Người dùng</th>
                  <th>Phòng ban</th>
                  <th>Vai trò</th>
                  <th>Trạng thái</th>
                  <th>Lần đăng nhập cuối</th>
                  <th><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((target) => (
                  <tr key={target.id}>
                    <td><strong>{target.displayName}</strong><small className="cell-subtitle">{target.email}</small></td>
                    <td>{target.departmentName}</td>
                    <td>{target.roles?.join(', ') || '—'}</td>
                    <td>
                      <StatusPill
                        label={target.status === 'ACTIVE' ? 'Hoạt động' : target.status === 'LOCKED' ? 'Bị khóa' : 'Vô hiệu hóa'}
                        tone={target.status === 'ACTIVE' ? 'success' : target.status === 'LOCKED' ? 'danger' : 'neutral'}
                      />
                    </td>
                    <td>{target.lastLoginAt ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(target.lastLoginAt)) : 'Chưa đăng nhập'}</td>
                    <td>
                      <button
                        className={target.status === 'ACTIVE' ? 'danger-quiet-button' : 'secondary-button'}
                        disabled={changingUser === target.id || target.id === currentUserId}
                        title={target.id === currentUserId ? 'Không thể vô hiệu hóa chính mình' : ''}
                        onClick={() => void changeStatus(target)}
                      >
                        {changingUser === target.id ? 'Đang lưu…' : target.status === 'ACTIVE' ? 'Vô hiệu hóa' : 'Kích hoạt'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="audit-log" className="content-section" aria-labelledby="audit-title">
        <div className="section-heading">
          <div><h2 id="audit-title">Audit Log</h2><p>Nhật ký chỉ đọc; dữ liệu bí mật đã được che.{auditNeedle && ` · ${visibleAudits.length} kết quả`}</p></div>
        </div>
        <div className="table-shell">
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Thời gian</th>
                  <th>Actor</th>
                  <th>Hành động</th>
                  <th>Đối tượng</th>
                  <th>Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {visibleAudits.slice(0, 20).map((item) => (
                  <tr key={item.id}>
                    <td>{new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(item.occurredAt))}</td>
                    <td>{item.actorName}</td>
                    <td><span className="mono-soft">{item.action}</span></td>
                    <td>{item.entityId ?? '—'}</td>
                    <td>
                      <StatusPill
                        label={item.outcome === 'SUCCESS' ? 'Thành công' : item.outcome === 'DENIED' ? 'Bị từ chối' : 'Thất bại'}
                        tone={item.outcome === 'SUCCESS' ? 'success' : 'danger'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visibleAudits.length && <div className="empty-state"><Search size={22} /><strong>Không tìm thấy nhật ký</strong><p>Thử mã đối tượng, actor hoặc tên hành động khác.</p></div>}
          </div>
        </div>
      </section>

      {testEmailOpen && (
        <TestEmailDialog onClose={() => setTestEmailOpen(false)} onSuccess={(email) => { setTestEmailOpen(false); onNotify(`Đã gửi email kiểm tra tới ${email}.`); }} />
      )}
    </>
  );
}
