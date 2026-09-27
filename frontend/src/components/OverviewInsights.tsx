import type { UserRole } from '../types';

export const insightData: Record<UserRole, {
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

export function OverviewInsights({ role, dashboard }: { role: UserRole; dashboard?: any }) {
  const fallback = insightData[role];
  const labels: Record<string, { label: string; tone: string }> = {
    KEY: { label: 'Khóa mã hóa', tone: 'brand' },
    CERTIFICATE: { label: 'Chứng thư số', tone: 'blue' },
    APPROVED: { label: 'Phê duyệt', tone: 'green' },
    REJECTED: { label: 'Từ chối', tone: 'red' },
    PENDING: { label: 'Chờ xử lý', tone: 'amber' },
    ACTIVE: { label: 'Hoạt động', tone: 'green' },
    EXPIRING_SOON: { label: 'Sắp hết hạn', tone: 'amber' },
    EXPIRED: { label: 'Đã hết hạn', tone: 'neutral' },
    REVOKED: { label: 'Đã thu hồi', tone: 'red' },
    SUPERSEDED: { label: 'Đã thay thế', tone: 'blue' },
  };
  const liveTrend = Array.isArray(dashboard?.trend) && dashboard.trend.length ? dashboard.trend : null;
  const liveSegments = Array.isArray(dashboard?.composition) ? dashboard.composition : null;
  const values = (liveTrend ?? fallback.values.map((value, index) => ({ period: fallback.periods[index], value }))).map((item: any) => Number(item.value));
  const periods = (liveTrend ?? fallback.periods.map((period) => ({ period }))).map((item: any) => {
    const raw = String(item.period);
    if (!liveTrend) return raw;
    const date = new Date(`${raw}${raw.length === 7 ? '-01' : ''}T00:00:00`);
    return role === 'APPROVER'
      ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(date)
      : new Intl.DateTimeFormat('vi-VN', { month: 'short' }).format(date);
  });
  const segments = (liveSegments ?? fallback.segments).map((item: any) => ({
    label: labels[item.label]?.label ?? item.label,
    value: Number(item.value),
    tone: labels[item.label]?.tone ?? item.tone ?? 'neutral',
  }));
  const segmentTotal = segments.reduce((sum: number, item: any) => sum + item.value, 0);
  const currentValue = role === 'APPROVER'
    ? Number(dashboard?.metrics?.approved ?? 0) + Number(dashboard?.metrics?.rejected ?? 0)
    : role === 'ADMIN'
      ? Number(dashboard?.metrics?.total_assets ?? segmentTotal)
      : Number(dashboard?.metrics?.total ?? segmentTotal);
  const data = { ...fallback, periods, values, segments, trendValue: String(currentValue), trendChange: 'Cập nhật trực tiếp từ hệ thống', donutTotal: String(segmentTotal) };
  const width = 560;
  const height = 142;
  const max = Math.max(...data.values, 1) * 1.12;
  const min = Math.min(...data.values) * 0.78;
  const range = Math.max(max - min, 1);
  const points = data.values.map((value: number, index: number) => {
    const x = 18 + index * ((width - 36) / (data.values.length - 1));
    const y = height - 18 - ((value - min) / range) * (height - 38);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const total = Math.max(data.segments.reduce((sum: number, segment: { value: number }) => sum + segment.value, 0), 1);
  let cursor = 0;
  const donutStops = data.segments.map((segment: { value: number; tone: string }) => {
    const start = (cursor / total) * 100;
    cursor += segment.value;
    const end = (cursor / total) * 100;
    return `var(--chart-${segment.tone}) ${start}% ${end}%`;
  }).join(', ');

  return (
    <section className="overview-insights" aria-label={`${data.title} và ${data.donutTitle}`}>
      <article className="insight-card trend-card">
        <header className="insight-header">
          <div>
            <p className="eyebrow">{data.eyebrow}</p>
            <h2>{data.title}</h2>
            <span>{data.description}</span>
          </div>
          <div className="trend-summary">
            <span>{data.trendLabel}</span>
            <strong>{data.trendValue}</strong>
            <small>{data.trendChange}</small>
          </div>
        </header>
        <figure className="trend-figure">
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${data.title}: ${data.periods.map((period: string, index: number) => `${period} ${data.values[index]}`).join(', ')}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={`trend-fill-${role}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--brand)" stopOpacity=".22" />
                <stop offset="1" stopColor="var(--brand)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="chart-grid-line" d="M18 30H542M18 72H542M18 114H542" />
            <polygon points={`18,${height - 8} ${points} 542,${height - 8}`} fill={`url(#trend-fill-${role})`} />
            <polyline className="trend-line" points={points} />
            {data.values.map((value: number, index: number) => {
              const [x, y] = points.split(' ')[index].split(',');
              return <circle key={data.periods[index]} className="trend-point" cx={x} cy={y} r="3.5"><title>{data.periods[index]}: {value}</title></circle>;
            })}
          </svg>
          <figcaption>{data.periods.map((period: string) => <span key={period}>{period}</span>)}</figcaption>
        </figure>
      </article>

      <article className="insight-card composition-card">
        <header>
          <p className="eyebrow">Phân bổ hiện tại</p>
          <h2>{data.donutTitle}</h2>
        </header>
        <div className="composition-body">
          <div className="donut-chart" style={{ background: segmentTotal ? `conic-gradient(${donutStops})` : 'var(--surface-soft)' }} role="img" aria-label={segmentTotal ? data.segments.map((segment: { label: string; value: number }) => `${segment.label}: ${segment.value}`).join(', ') : 'Chưa có dữ liệu'}>
            <span><strong>{data.donutTotal}</strong><small>{data.donutCaption}</small></span>
          </div>
          <div className="chart-legend">
            {data.segments.length ? data.segments.map((segment: { label: string; value: number; tone: string }) => (
              <div key={segment.label}>
                <span className={`chart-swatch chart-${segment.tone}`} />
                <span>{segment.label}</span>
                <strong>{segment.value}</strong>
              </div>
            )) : <div><span className="chart-swatch chart-neutral" /><span>Chưa có dữ liệu</span><strong>0</strong></div>}
          </div>
        </div>
      </article>
    </section>
  );
}
