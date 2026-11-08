import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect,useRef } from 'react';
import type { AssetStatus,RequestStatus,UserRole } from './types';
import type { DashboardData } from './dashboardTypes';
export type Theme = 'light' | 'dark';
export type AssetFilter = 'ALL' | 'ACTIVE' | 'EXPIRING_SOON' | 'ENDED';
export type RequestType = 'CREATE' | 'RENEW' | 'REVOKE';
export type RequestModalState = { type: RequestType; assetId?: string } | null;
export type PolicyOption={id:string;code:string;name:string;version:number;configuration:Record<string,unknown>};

export const roleMeta: Record<UserRole, { label: string; eyebrow: string }> = {
  USER: { label: 'Nhân viên', eyebrow: 'Không gian cá nhân' },
  APPROVER: { label: 'Người phê duyệt', eyebrow: 'Trung tâm phê duyệt' },
  ADMIN: { label: 'Quản trị bảo mật', eyebrow: 'Điều hành an toàn' },
};

export const assetStatus: Record<AssetStatus, { label: string; tone: string }> = {
  REGISTERED: { label: 'Đã đăng ký', tone: 'neutral' },
  ACTIVE: { label: 'Đang hoạt động', tone: 'success' },
  EXPIRING_SOON: { label: 'Sắp hết hạn', tone: 'warning' },
  EXPIRED: { label: 'Đã hết hạn', tone: 'neutral' },
  REVOKED: { label: 'Đã thu hồi', tone: 'danger' },
  SUPERSEDED: { label: 'Đã thay thế', tone: 'neutral' },
};

export const requestStatus: Record<RequestStatus, { label: string; tone: string }> = {
  DRAFT: { label: 'Bản nháp', tone: 'neutral' },
  PENDING: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  PROCESSING: { label: 'Đang xử lý', tone: 'warning' },
  COMPLETED: { label: 'Hoàn tất', tone: 'success' },
  REJECTED: { label: 'Từ chối', tone: 'danger' },
  FAILED: { label: 'Xử lý lỗi', tone: 'danger' },
  RECONCILIATION_REQUIRED: { label: 'Cần đối soát', tone: 'danger' },
  CANCELLED: { label: 'Đã hủy', tone: 'neutral' },
};

export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

export function PageHeader({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:ReactNode}){
  return <section className="hero-section route-page-header" aria-labelledby="page-title"><div><p className="eyebrow">{eyebrow}</p><h1 id="page-title" tabIndex={-1}>{title}</h1><p className="page-subtitle">{description}</p></div>{actions}</section>;
}

export function RouteState({title,description,actionLabel,onAction}:{title:string;description:string;actionLabel?:string;onAction?:()=>void}){
  return <><PageHeader eyebrow="Điều hướng Crypta" title={title} description={description}/><div className="empty-state route-state"><ShieldAlert size={28}/><strong>{title}</strong><p>{description}</p>{actionLabel&&onAction&&<button className="primary-button" onClick={onAction}>{actionLabel}</button>}</div></>;
}

const insightData: Record<UserRole, {
  eyebrow: string;
  title: string;
  description: string;
  trendLabel: string;
  trendUnit: string;
  periods: string[];
  values: number[];
  donutTitle: string;
  donutCaption: string;
  segments: Array<{ label: string; value: number; tone: string }>;
}> = {
  USER: {
    eyebrow: 'Xu hướng cá nhân', title: 'Yêu cầu đã gửi', description: 'Số yêu cầu bạn đã gửi trong 6 tháng gần nhất.',
    trendLabel: 'Yêu cầu tháng này', trendUnit: 'yêu cầu',
    periods: ['T4', 'T5', 'T6', 'T7', 'T8', 'T9'], values: [0, 0, 0, 0, 0, 0],
    donutTitle: 'Cơ cấu tài sản', donutCaption: 'tài sản',
    segments: [{ label: 'Khóa mã hóa', value: 0, tone: 'brand' }, { label: 'Chứng thư số', value: 0, tone: 'blue' }],
  },
  APPROVER: {
    eyebrow: 'Năng lực xử lý', title: 'Quyết định phê duyệt', description: 'Số quyết định của bạn trong 7 ngày gần nhất.',
    trendLabel: 'Quyết định trong 7 ngày', trendUnit: 'quyết định',
    periods: ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'], values: [0, 0, 0, 0, 0, 0, 0],
    donutTitle: 'Kết quả 30 ngày', donutCaption: 'quyết định',
    segments: [{ label: 'Phê duyệt', value: 0, tone: 'green' }, { label: 'Từ chối', value: 0, tone: 'red' }],
  },
  ADMIN: {
    eyebrow: 'Toàn hệ thống', title: 'Tăng trưởng tài sản', description: 'Số tài sản được ghi nhận mới mỗi tháng, trong 6 tháng gần nhất.',
    trendLabel: 'Tài sản hiện tại', trendUnit: 'tài sản',
    periods: ['T4', 'T5', 'T6', 'T7', 'T8', 'T9'], values: [0, 0, 0, 0, 0, 0],
    donutTitle: 'Trạng thái toàn hệ thống', donutCaption: 'tài sản',
    segments: [{ label: 'Hoạt động', value: 0, tone: 'green' }, { label: 'Sắp hết hạn', value: 0, tone: 'amber' }, { label: 'Khác', value: 0, tone: 'neutral' }],
  },
};

const dayTick = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', weekday: 'short' });
const monthTick = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', month: 'short' });
const dayDetail = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', dateStyle: 'short' });
const monthDetail = new Intl.DateTimeFormat('vi-VN', { timeZone: 'UTC', month: 'long', year: 'numeric' });

export function OverviewInsights({ role, dashboard }: { role: UserRole; dashboard?: Partial<DashboardData> | null }) {
  const fallback = insightData[role];
  const labels:Record<string,{label:string;tone:string}>={KEY:{label:'Khóa mã hóa',tone:'brand'},CERTIFICATE:{label:'Chứng thư số',tone:'blue'},APPROVED:{label:'Phê duyệt',tone:'green'},REJECTED:{label:'Từ chối',tone:'red'},REGISTERED:{label:'Đã đăng ký',tone:'neutral'},ACTIVE:{label:'Hoạt động',tone:'green'},EXPIRING_SOON:{label:'Sắp hết hạn',tone:'amber'},EXPIRED:{label:'Đã hết hạn',tone:'neutral'},REVOKED:{label:'Đã thu hồi',tone:'red'},SUPERSEDED:{label:'Đã thay thế',tone:'blue'}};
  const liveTrend: DashboardData['trend'] | null = Array.isArray(dashboard?.trend) && dashboard.trend.length ? dashboard.trend : null;
  const liveSegments: Array<DashboardData['composition'][number] & { tone?: string }> | null =
    Array.isArray(dashboard?.composition) ? dashboard.composition : null;
  const values=(liveTrend??fallback.values.map((value,index)=>({period:fallback.periods[index],value}))).map(item=>Number(item.value));
  const dates = liveTrend?.map(({ period }) => new Date(`${period}${period.length === 7 ? '-01' : ''}T00:00:00Z`));
  const periods = dates?.map(date => (role === 'APPROVER' ? dayTick : monthTick).format(date)) ?? fallback.periods;
  const pointLabels = dates?.map((date, index) =>
    `${(role === 'APPROVER' ? dayDetail : monthDetail).format(date)}: ${values[index]} ${fallback.trendUnit}`);
  const segments=(liveSegments??fallback.segments).filter(item => role !== 'APPROVER' || item.label !== 'PENDING')
    .map(item=>({label:labels[item.label]?.label??item.label,value:Number(item.value),tone:labels[item.label]?.tone??item.tone??'neutral'}));
  const segmentTotal=segments.reduce((sum,item)=>sum+item.value,0);
  const currentValue=role==='ADMIN' ? dashboard?.metrics?.total_assets : role==='APPROVER'
    ? liveTrend?.reduce((sum, item) => sum + Number(item.value), 0) : liveTrend?.at(-1)?.value;
  const data={...fallback,periods,values,segments,trendValue:currentValue ?? '—',donutTotal:liveSegments ? String(segmentTotal) : '—'};
  const width = 560;
  const height = 142;
  const max = Math.max(...data.values,1) * 1.12;
  const min = Math.min(...data.values) * 0.78;
  const range = Math.max(max - min, 1);
  const points = data.values.map((value:number, index:number) => {
    const x = 18 + index * ((width - 36) / Math.max(data.values.length - 1, 1));
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
      <header className="insight-header"><div><p className="eyebrow">{data.eyebrow}</p><h2>{data.title}</h2><span>{data.description}{dashboard?.trendTimeZone && ` Múi giờ ${dashboard.trendTimeZone}.`}</span></div><div className="trend-summary"><span>{data.trendLabel}</span><strong>{data.trendValue}</strong><small>{currentValue === undefined ? 'Chưa có dữ liệu' : 'Theo dữ liệu hệ thống'}</small></div></header>
      <figure className="trend-figure">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.title}: ${pointLabels?.join(', ') ?? 'Chưa có dữ liệu'}`} preserveAspectRatio="none">
          <defs><linearGradient id={`trend-fill-${role}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--brand)" stopOpacity=".22" /><stop offset="1" stopColor="var(--brand)" stopOpacity="0" /></linearGradient></defs>
          <path className="chart-grid-line" d="M18 30H542M18 72H542M18 114H542" />
          <polygon points={`18,${height - 8} ${points} 542,${height - 8}`} fill={`url(#trend-fill-${role})`} />
          <polyline className="trend-line" points={points} />
          {data.values.map((_, index) => {
            const [x, y] = points.split(' ')[index].split(',');
            return <circle key={data.periods[index]} className="trend-point" cx={x} cy={y} r="3.5">{pointLabels && <title>{pointLabels[index]}</title>}</circle>;
          })}
        </svg>
        <figcaption>{data.periods.map((period:string) => <span key={period}>{period}</span>)}</figcaption>
      </figure>
    </article>

    <article className="insight-card composition-card">
      <header><p className="eyebrow">{role === 'APPROVER' ? 'Quyết định của bạn' : 'Phân bổ hiện tại'}</p><h2>{data.donutTitle}</h2></header>
      <div className="composition-body">
        <div className="donut-chart" style={{ background: segmentTotal?`conic-gradient(${donutStops})`:'var(--surface-soft)' }} role="img" aria-label={segmentTotal?data.segments.map((segment:{label:string;value:number}) => `${segment.label}: ${segment.value}`).join(', '):'Chưa có dữ liệu'}>
          <span><strong>{data.donutTotal}</strong><small>{data.donutCaption}</small></span>
        </div>
        <div className="chart-legend">{data.segments.length?data.segments.map((segment:{label:string;value:number;tone:string}) => <div key={segment.label}><span className={`chart-swatch chart-${segment.tone}`} /><span>{segment.label}</span><strong>{segment.value}</strong></div>):<div><span className="chart-swatch chart-neutral"/><span>Chưa có dữ liệu</span><strong>0</strong></div>}</div>
      </div>
    </article>
  </section>;
}

export function useDialogBehavior(
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
    const container=containerRef.current;
    const focusFrame = window.requestAnimationFrame(() => {
      if(!container?.contains(document.activeElement))initialFocusRef.current?.focus();
    });
    let visibilityFrame=0;
    const revealFocus=()=>{
      window.cancelAnimationFrame(visibilityFrame);
      visibilityFrame=window.requestAnimationFrame(()=>{
        const focused=document.activeElement;
        const footer=container?.querySelector<HTMLElement>('form footer');
        if(!container||!(focused instanceof HTMLElement)||!container.contains(focused))return;
        const box=focused.getBoundingClientRect(),panel=container.getBoundingClientRect();
        const stickyFooter=footer&&!footer.contains(focused)&&getComputedStyle(footer).position==='sticky';
        const start=Math.max(panel.top,0)+12;
        const end=Math.min(panel.bottom,window.innerHeight,stickyFooter?footer.getBoundingClientRect().top:Infinity)-12;
        if(box.height>end-start||box.top<start)container.scrollTop-=start-box.top;
        else if(box.bottom>end)container.scrollTop+=box.bottom-end;
      });
    };
    container?.addEventListener('focusin',revealFocus);

    const keydown = (event: KeyboardEvent) => {
      const dialogs=Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]'));
      if(dialogs.at(-1)!==containerRef.current)return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(containerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      // :disabled includes controls disabled by an ancestor fieldset, whose own
      // disabled attribute can be absent while a mutation is pending.
      ) ?? []).filter((element) => element.offsetParent !== null && !element.matches(':disabled'));
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
      window.cancelAnimationFrame(visibilityFrame);
      container?.removeEventListener('focusin',revealFocus);
      window.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [containerRef, initialFocusRef]);
}
