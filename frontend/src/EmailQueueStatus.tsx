import { api } from './api';
import type { EmailQueueStatusResponse } from './api/contracts/notifications';
import { emailDeliveryTime } from './EmailDeliveryDialog';
import { useResource } from './useResource';

const counts = {
  PENDING: 'Chờ gửi', SENDING: 'Đang gửi', SENT: 'SMTP đã chấp nhận',
  FAILED: 'Gửi thất bại', RECONCILIATION_REQUIRED: 'Cần đối soát',
} as const;

const workerLabels: Record<EmailQueueStatusResponse['worker']['state'], string> = {
  DISABLED: 'SMTP đang tắt', AWAITING: 'Chưa có lượt quét',
  STALE: 'Quá hạn', FAILED: 'Có lỗi', RECENT: 'Đã hoàn tất',
};

function waitingTime(seconds: number | null) {
  if (seconds === null) return 'Không có thư đến hạn';
  const elapsed = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(elapsed / 60);
  return minutes ? `${minutes} phút ${elapsed % 60} giây` : `${elapsed} giây`;
}

export function EmailQueueStatus({ revision }: { revision: number }) {
  const { data, loading, error, retry } = useResource('email:queue-status', api.emailQueueStatus, revision);
  const worker = data?.worker;
  const warnings = [
    data?.queueDelayed && 'Có thư đến hạn chờ ít nhất 5 phút.',
    worker?.state === 'STALE' && 'Chưa ghi nhận lượt quét worker trong 5 phút gần đây.',
    worker?.state === 'FAILED' && 'Lượt quét gần nhất của worker gặp lỗi.',
    worker?.state === 'DISABLED' && !!data?.queue.PENDING && 'Thư tiếp tục chờ cho đến khi SMTP được bật.',
  ].filter(Boolean).join(' ');
  return <section className="content-section compact-section email-queue-status" aria-labelledby="email-queue-title">
    <div className="section-heading">
      <div><h2 id="email-queue-title">Tình trạng hàng đợi</h2><p>Chỉ tính thư qua SMTP.</p></div>
      <button type="button" className="secondary-button" aria-disabled={loading} onClick={() => { if (!loading) retry(); }}>Làm mới tình trạng</button>
    </div>
    <p role="status" className={loading ? 'email-queue-note' : 'sr-only'}>
      {loading ? 'Đang tải tình trạng hàng đợi…' : data && !error ? 'Đã cập nhật tình trạng hàng đợi.' : ''}
    </p>
    {error && <p role="alert" className="login-error">{error}{data && ' Đang hiển thị số liệu lần đọc trước.'}</p>}
    {data && <div className="email-queue-data" aria-busy={loading}>
      <dl className="email-queue-counts">
        {Object.entries(counts).map(([key, label]) => <div key={key}>
          <dt>{label}</dt><dd>{data.queue[key as keyof typeof counts] ?? 0}</dd>
        </div>)}
      </dl>
      <dl className="email-queue-observations">
        <div><dt>Thư đến hạn chờ lâu nhất</dt><dd>{waitingTime(data.oldestDueSeconds)}</dd></div>
        <div><dt>Lỗi gần nhất trong hàng đợi</dt><dd>{emailDeliveryTime(data.lastFailedAt)}</dd></div>
        <div><dt>Lượt quét worker gần nhất</dt><dd>
          {data.worker.lastPollAt && `${emailDeliveryTime(data.worker.lastPollAt)} · `}{workerLabels[data.worker.state]}
        </dd></div>
      </dl>
      {warnings && <p className="email-queue-warning">{warnings}</p>}
      <p className="email-queue-note">Lấy số liệu lúc {emailDeliveryTime(data.collectedAt)} · giờ Việt Nam.</p>
    </div>}
  </section>;
}
