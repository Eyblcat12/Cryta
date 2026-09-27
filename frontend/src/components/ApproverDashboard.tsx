import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import type { RequestItem } from '../types';
import { requestStatus } from './RequestDrawer';
import { StatusPill } from './StatusPill';
import { OverviewInsights } from './OverviewInsights';

function scrollToElement(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function ApproverDashboard({
  requests,
  dashboard,
  searchQuery,
  onDecision,
}: {
  requests: RequestItem[];
  dashboard: any;
  searchQuery: string;
  onDecision: (action: 'APPROVE' | 'REJECT', requestId: string) => void;
}) {
  const [queueQuery, setQueueQuery] = useState('');
  const normalized = (queueQuery || searchQuery).trim().toLocaleLowerCase('vi');
  const allQueue = requests
    .filter((request) => request.status === 'PENDING')
    .map((request) => ({
      id: request.id,
      person: request.creatorName ?? 'Không xác định',
      department: request.departmentName ?? 'Không xác định',
      type: request.type === 'CREATE' ? 'Cấp mới' : request.type === 'RENEW' ? 'Gia hạn' : 'Thu hồi',
      asset: request.targetAssetCode ?? (request.type === 'CREATE' ? 'Tài sản mới' : 'Không xác định'),
      reason: request.subject,
      age: request.submittedAt,
      emergency: Boolean(request.emergency),
    }));
  const queue = allQueue.filter((item) =>
    !normalized || [item.id, item.person, item.department, item.asset, item.reason].some((value) =>
      value.toLocaleLowerCase('vi').includes(normalized)
    )
  );
  const handled = requests.filter((request) => request.status !== 'PENDING').slice(0, 3);
  const [selectedId, setSelectedId] = useState('');
  const selected = queue.find((item) => item.id === selectedId) ?? queue[0];

  if (!selected) {
    return (
      <>
        <section id="overview" className="hero-section" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Trung tâm phê duyệt</p>
            <h1 id="page-title">{normalized && allQueue.length ? 'Không tìm thấy yêu cầu' : 'Không có yêu cầu chờ xử lý'}</h1>
            <p className="page-subtitle">{normalized && allQueue.length ? 'Không có mục nào khớp từ khóa hiện tại.' : 'Hàng chờ trong phạm vi của bạn đang trống.'}</p>
          </div>
        </section>
        <div className="empty-state">
          {normalized && allQueue.length ? <Search size={28} /> : <CheckCircle2 size={28} />}
          <strong>{normalized && allQueue.length ? 'Thử từ khóa khác' : 'Mọi yêu cầu đã được xử lý'}</strong>
          <p>{normalized && allQueue.length ? 'Tìm theo mã, người gửi, phòng ban, tài sản hoặc lý do.' : 'Hệ thống sẽ gửi email khi có yêu cầu mới.'}</p>
          {queueQuery && <button onClick={() => setQueueQuery('')}>Xóa tìm kiếm</button>}
        </div>
      </>
    );
  }

  return (
    <>
      <section id="overview" className="hero-section" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Trung tâm phê duyệt</p>
          <h1 id="page-title">Hàng chờ cần quyết định</h1>
          <p className="page-subtitle">Ưu tiên yêu cầu rủi ro cao, kiểm tra policy và phân tách nhiệm vụ trước khi xử lý.</p>
        </div>
        <button className="primary-button" onClick={() => scrollToElement('approval-detail')}>
          <ShieldAlert size={18} /> Xử lý yêu cầu khẩn cấp
        </button>
      </section>

      <section className="metric-row three-metrics" aria-label="Tổng quan phê duyệt">
        <article className="metric">
          <div className="metric-icon metric-icon-blue"><ClipboardList size={20} /></div>
          <div><span>Chờ xử lý</span><strong>{dashboard?.metrics?.pending ?? queue.length}</strong></div>
          <span className="metric-caption">Trong phạm vi được giao</span>
        </article>
        <article className="metric">
          <div className="metric-icon metric-icon-amber"><ShieldAlert size={20} /></div>
          <div><span>Khẩn cấp</span><strong>{dashboard?.metrics?.emergency ?? queue.filter((i) => i.emergency).length}</strong></div>
          <span className="metric-caption">Cần quyết định ngay</span>
        </article>
        <article className="metric">
          <div className="metric-icon metric-icon-green"><Clock3 size={20} /></div>
          <div><span>Thời gian chờ TB</span><strong>{dashboard?.metrics?.avg_wait_hours ?? 0} giờ</strong></div>
          <span className="metric-caption">Tính từ hàng chờ hiện tại</span>
        </article>
      </section>

      <OverviewInsights role="APPROVER" dashboard={dashboard} />

      {queue.some((item) => item.emergency) && (
        <section className="expiry-banner danger-banner" aria-label="Yêu cầu khẩn cấp">
          <div className="expiry-symbol"><ShieldAlert size={22} /></div>
          <div className="expiry-copy">
            <div className="banner-title-line">
              <h2>Có yêu cầu khẩn cấp đang chờ</h2>
              <StatusPill label="Ưu tiên cao" tone="danger" />
            </div>
            <p>Kiểm tra yêu cầu được đánh dấu khẩn cấp và đưa ra quyết định sớm để giảm rủi ro.</p>
          </div>
          <button className="secondary-button" onClick={() => { setSelectedId(queue.find((item) => item.emergency)!.id); scrollToElement('approval-detail'); }}>
            Kiểm tra ngay <ArrowRight size={17} />
          </button>
        </section>
      )}

      <section id="approval-queue" className="content-section" aria-labelledby="queue-title">
        <div className="section-heading">
          <div><h2 id="queue-title">Hàng chờ phê duyệt</h2><p>Chỉ hiển thị yêu cầu thuộc phạm vi phòng ban của bạn.</p></div>
          <button className="filter-button"><SlidersHorizontal size={16} /> Bộ lọc <span>{queue.length}</span></button>
        </div>
        <div className="table-shell">
          <div className="table-toolbar">
            <div className="filter-tabs" role="group" aria-label="Tổng số hàng chờ">
              <button className="filter-active">Tất cả <span>{queue.length}</span></button>
              <button>Khẩn cấp <span>{queue.filter((item) => item.emergency).length}</span></button>
            </div>
            <label className="inline-search">
              <Search size={16} /><span className="sr-only">Tìm yêu cầu</span>
              <input value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} placeholder="Mã hoặc nội dung" />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Người gửi</th>
                  <th>Loại</th>
                  <th>Tài sản</th>
                  <th>Thời gian chờ</th>
                  <th>Mức độ</th>
                  <th><span className="sr-only">Mở</span></th>
                </tr>
              </thead>
              <tbody>
                {queue.map((item) => (
                  <tr key={item.id} className={selectedId === item.id ? 'row-selected' : ''}>
                    <td><button className="table-link" onClick={() => { setSelectedId(item.id); scrollToElement('approval-detail'); }}>{item.id}</button></td>
                    <td><strong>{item.person}</strong><small className="cell-subtitle">{item.department}</small></td>
                    <td>{item.type}</td>
                    <td><span className="mono-soft">{item.asset}</span></td>
                    <td>{item.age}</td>
                    <td>{item.emergency ? <StatusPill label="Khẩn cấp" tone="danger" /> : <StatusPill label="Bình thường" tone="neutral" />}</td>
                    <td><button className="row-action" aria-label={`Mở ${item.id}`} onClick={() => { setSelectedId(item.id); scrollToElement('approval-detail'); }}><ChevronRight size={18} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="approval-detail" className="content-section approval-detail" aria-labelledby="approval-detail-title">
        <header className="approval-detail-header">
          <div>
            <p className="eyebrow">Yêu cầu đang chọn</p>
            <h2 id="approval-detail-title">{selected.id} · {selected.type} {selected.asset !== '—' ? selected.asset : 'tài sản mới'}</h2>
            <p>{selected.person} · Phòng {selected.department} · gửi {selected.age} trước</p>
          </div>
          <div className="detail-badges">
            {selected.emergency && <StatusPill label="Khẩn cấp" tone="danger" />}
            <StatusPill label="Chờ duyệt" tone="warning" />
          </div>
        </header>
        <div className="approval-layout">
          <div className="request-facts">
            <h3>Thông tin yêu cầu</h3>
            <dl className="detail-grid">
              <div><dt>Người gửi</dt><dd>{selected.person}</dd></div>
              <div><dt>Phòng ban</dt><dd>{selected.department}</dd></div>
              <div><dt>Loại yêu cầu</dt><dd>{selected.type}</dd></div>
              <div><dt>Tài sản</dt><dd>{selected.asset}</dd></div>
            </dl>
            <div className="detail-block"><span>Lý do nghiệp vụ</span><p>{selected.reason}</p></div>
          </div>
          <div className="approval-checks">
            <h3>Kiểm tra trước phê duyệt</h3>
            <ul>
              <li className="check-success"><CheckCircle2 size={18} /><span><strong>Đúng phạm vi phê duyệt</strong><small>Yêu cầu thuộc {selected.department}</small></span></li>
              <li className="check-success"><CheckCircle2 size={18} /><span><strong>Đảm bảo Separation of Duties</strong><small>Người duyệt khác người gửi</small></span></li>
              <li className="check-success"><CheckCircle2 size={18} /><span><strong>Kiểm tra lại khi gửi</strong><small>Phiên bản, quyền và trạng thái sẽ được xác nhận ở máy chủ</small></span></li>
              {selected.emergency && <li className="check-warning"><AlertTriangle size={18} /><span><strong>Rủi ro cần xử lý ngay</strong><small>Yêu cầu được người gửi đánh dấu khẩn cấp</small></span></li>}
            </ul>
          </div>
        </div>
        <div className="decision-bar">
          <div><strong>Sẵn sàng đưa ra quyết định</strong><span>Hệ thống sẽ kiểm tra lại quyền, scope và phiên bản dữ liệu khi gửi.</span></div>
          <div>
            <button className="danger-quiet-button" onClick={() => onDecision('REJECT', selected.id)}>Từ chối</button>
            <button className="primary-button" onClick={() => onDecision('APPROVE', selected.id)}><Check size={17} /> Phê duyệt yêu cầu</button>
          </div>
        </div>
      </section>

      <section id="approval-history" className="content-section compact-section">
        <div className="section-heading"><div><h2>Lịch sử xử lý gần đây</h2><p>Tối đa 3 yêu cầu đã rời hàng chờ trong phạm vi của bạn.</p></div></div>
        <div className="activity-list">
          {handled.length ? (
            handled.map((item) => (
              <article key={item.id}>
                <span className={`activity-icon ${item.status === 'REJECTED' || item.status === 'FAILED' ? 'activity-warning' : 'activity-success'}`}>
                  {item.status === 'REJECTED' || item.status === 'FAILED' ? <XCircle size={18} /> : <CheckCircle2 size={18} />}
                </span>
                <div><strong>{requestStatus[item.status].label} · {item.id}</strong><p>{item.subject}</p><time>{item.submittedAt}</time></div>
              </article>
            ))
          ) : (
            <div className="empty-state"><Clock3 size={22} /><strong>Chưa có lịch sử xử lý</strong><p>Các yêu cầu đã quyết định sẽ xuất hiện tại đây.</p></div>
          )}
        </div>
      </section>
    </>
  );
}
