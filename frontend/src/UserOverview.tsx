import {
Activity,
AlertTriangle,
ArrowRight,
CalendarClock,
CheckCircle2,
ChevronRight,
Clock3,
KeyRound
} from 'lucide-react';

import { OverviewInsights,StatusPill } from './WorkspaceUi';
import type { DashboardData } from './dashboardTypes';
import type { RequestType } from './WorkspaceUi';
import { Link } from 'react-router';
export function UserOverview({dashboard,openRequest,updating,canRequest}:{dashboard:DashboardData;openRequest:(type?:RequestType,assetId?:string)=>void;updating:boolean;canRequest:boolean}) {
  const priorityAsset=dashboard.lifecycle?.priority;
  const totalAssetCount=Number(dashboard.metrics.total);
  const activeAssetCount=Number(dashboard.metrics.active);
  const expiringAssetCount=Number(dashboard.metrics.expiring);
  const liveAssetCount=Number(dashboard.lifecycle?.live??0);
  const maturity=[dashboard.lifecycle?.within30??0,dashboard.lifecycle?.within180??0,dashboard.lifecycle?.after180??0];
  const pendingRequestCount=Number(dashboard.metrics.pending);
  return <>
          <section className="metric-row" aria-label="Tổng quan tài sản">
            <article className="metric metric-featured">
              <div className="metric-icon"><KeyRound size={20} /></div>
              <div><span>Tài sản đang quản lý</span><strong>{totalAssetCount}</strong></div>
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
              <div><span>Tài sản hoạt động</span><strong>{totalAssetCount?Math.round(activeAssetCount/totalAssetCount*100):0}%</strong></div>
              <span className="metric-caption">{activeAssetCount}/{totalAssetCount} tài sản</span>
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
              <Link className="text-button" to="/assets?status=EXPIRING_SOON">Xem tài sản sắp hết hạn <ArrowRight size={15}/></Link>
            </div>
            {canRequest&&<button className="secondary-button" disabled={updating} onClick={() => openRequest('RENEW',priorityAsset.id)}>
              Yêu cầu gia hạn <ArrowRight size={17} />
            </button>}
          </section>}

          <section className="lifecycle-section" aria-labelledby="lifecycle-title">
            <header className="lifecycle-header">
              <div>
                <h2 id="lifecycle-title">Phân bổ thời hạn</h2>
                <p>{liveAssetCount} tài sản đang hiệu lực · dữ liệu từ hệ thống</p>
              </div>
              <span className="lifecycle-summary"><strong>{maturity[0]}</strong> hết hạn trong 30 ngày</span>
            </header>

            <div className="lifecycle-layout">
              <figure className="distribution-figure">
                <div className="distribution-heading">
                  <span>Theo thời gian còn lại</span>
                  <strong>{liveAssetCount} tài sản</strong>
                </div>
                <div
                  className="distribution-bar"
                  role="img"
                  aria-label={`${liveAssetCount} tài sản: ${maturity[0]} trong 30 ngày, ${maturity[1]} từ 31 đến 180 ngày, ${maturity[2]} trên 180 ngày.`}
                >
                  <span className="distribution-urgent" style={{width:`${liveAssetCount?maturity[0]/liveAssetCount*100:0}%`,flex:'none'}} aria-hidden="true" />
                  <span style={{width:`${liveAssetCount?maturity[1]/liveAssetCount*100:0}%`,background:'var(--text-muted)',flex:'none'}} aria-hidden="true" />
                  <span className="distribution-longterm" style={{width:`${liveAssetCount?maturity[2]/liveAssetCount*100:0}%`,flex:'none'}} aria-hidden="true" />
                </div>
                <div className="distribution-legend">
                  <div><span className="legend-mark mark-urgent" /><span><strong>{maturity[0]}</strong> ≤ 30 ngày</span></div>
                  <div><span className="legend-mark mark-neutral" /><span><strong>{maturity[1]}</strong> 31–180 ngày</span></div>
                  <div><span className="legend-mark mark-longterm" /><span><strong>{maturity[2]}</strong> &gt; 180 ngày</span></div>
                </div>
                <figcaption>Phân nhóm theo chính sách cảnh báo hiện tại.</figcaption>
              </figure>

              <div className="priority-panel">
                <span className="priority-label">Ưu tiên tiếp theo</span>
                <button disabled={updating||!canRequest||!priorityAsset} onClick={() => priorityAsset&&canRequest&&openRequest('RENEW', priorityAsset.id)}>
                  <span className="priority-date"><strong>{priorityAsset?.daysLeft??'—'}</strong><small>ngày</small></span>
                  <span className="priority-copy"><strong>{priorityAsset?.name??'Không có tài sản cần xử lý'}</strong><small>{priorityAsset?`${priorityAsset.code} · ${priorityAsset.expiresAt}`:'Hệ thống đang ổn định'}</small></span>
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </section>
  </>;
}
