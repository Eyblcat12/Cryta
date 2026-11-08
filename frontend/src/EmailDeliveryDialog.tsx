import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api, ApiError } from './api';
import type { EmailDeliveryDetail, EmailReconciliation } from './api/contracts/notifications';
import { MutationGuardNotice } from './MutationNotice';
import { UnsavedChangesDialog, useUnsavedChanges } from './UnsavedChanges';
import { useMutationGuard } from './useWorkspaceMutations';
import { useResource } from './useResource';
import { StatusPill, useDialogBehavior } from './WorkspaceUi';

const deliveryTypes: Record<string, string> = {
  REQUEST_SUBMITTED: 'Yêu cầu mới',
  REQUEST_SECOND_APPROVAL: 'Yêu cầu cần phê duyệt cấp hai',
  REQUEST_APPROVED: 'Yêu cầu đã được duyệt',
  REQUEST_REJECTED: 'Yêu cầu bị từ chối',
  REQUEST_COMPLETED: 'Yêu cầu đã hoàn tất',
  REQUEST_FAILED: 'Yêu cầu kết thúc do lỗi xử lý',
  REQUEST_RECONCILIATION_REQUIRED: 'Kết quả xử lý yêu cầu cần kiểm tra',
  ASSET_EXPIRING: 'Cảnh báo tài sản sắp hết hạn',
  ASSET_EXPIRED: 'Cảnh báo tài sản hết hạn',
  ASSET_REVOKED: 'Tài sản đã thu hồi',
  INVITATION: 'Lời mời tài khoản',
  PASSWORD_RESET: 'Đặt lại mật khẩu',
  PASSWORD_RESET_COMPLETED: 'Thông báo đã đặt lại mật khẩu',
  MFA_SECURITY_CHANGED: 'Cập nhật xác thực hai bước',
};
export function emailDeliveryType(type: string) { return deliveryTypes[type] ?? 'Thông báo hệ thống'; }
export function emailDeliveryStatus(status: string) {
  return status === 'RECONCILIATION_REQUIRED' ? 'Cần đối soát'
    : status === 'FAILED' ? 'Gửi thất bại'
    : status === 'SENT' ? 'SMTP đã chấp nhận'
    : status === 'SENDING' ? 'Đang gửi' : 'Đang chờ gửi';
}

const localTime = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });
export function emailDeliveryTime(value: string | null) { return value ? localTime.format(new Date(value)) : '—'; }

function diagnosis(row: EmailDeliveryDetail) {
  switch (row.failure) {
    case 'OUTCOME_UNKNOWN': return 'Chưa rõ SMTP đã chấp nhận thư. Hãy kiểm tra nhật ký SMTP theo mã đối chiếu.';
    case 'SMTP_PERMANENT_REJECTION': return `SMTP từ chối vĩnh viễn (${row.smtpStatus}).`;
    case 'SMTP_TEMPORARY_REJECTION': return `SMTP từ chối tạm thời (${row.smtpStatus}).`;
    case 'PREPARATION_FAILED': return 'Hệ thống gặp lỗi khi chuẩn bị nội dung email.';
    case 'VERIFIED_UNSENT': return 'Quản trị viên đã xác minh SMTP chưa chấp nhận thư.';
    default: return null;
  }
}

function parseUtc(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) return null;
  const timestamp = value.length === 16 ? value + ':00' : value;
  const time = new Date(timestamp + 'Z');
  return Number.isFinite(time.getTime()) && time.toISOString().startsWith(timestamp + '.') ? time.toISOString() : null;
}

export function EmailDeliveryDialog({ id, revision, onClose, onSaved }: {
  id: string; revision: number; onClose: () => void; onSaved: () => void;
}) {
  const resource = useResource(`email-delivery:${id}`, signal => api.emailDelivery(id, signal), revision);
  const operationKey = `email:${id}`;
  const operation = useMutationGuard(operationKey);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const [outcome, setOutcome] = useState<EmailReconciliation['outcome'] | ''>('');
  const [evidence, setEvidence] = useState('');
  const [acceptedAt, setAcceptedAt] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryConfirmed, setRetryConfirmed] = useState(false);
  const dirty = !!(outcome || evidence || acceptedAt);
  const blocker = useUnsavedChanges(dirty && !busy);
  const row = resource.data;
  const eligible = row?.status === 'RECONCILIATION_REQUIRED';
  const retry = row?.retry;
  const unavailable = resource.loading || !!resource.error || busy || needsRefresh || !!operation;
  const disabled = unavailable || !eligible;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function close() {
    if (lock.current) return;
    if (retrying) {
      setRetrying(false);
      setRetryConfirmed(false);
      requestAnimationFrame(() => {
        const trigger = retryButton.current;
        (trigger && !trigger.disabled ? trigger : closeButton.current)?.focus();
      });
    } else if (dirty) setDiscard(true);
    else onClose();
  }
  useDialogBehavior(dialog, closeButton, close);

  function reload() {
    setNeedsRefresh(false);
    setError('');
    setRetrying(false);
    setRetryConfirmed(false);
    closeButton.current?.focus();
    resource.retry();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || disabled || !row || !outcome) return;
    const evidenceReference = evidence.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,63}$/.test(evidenceReference)) {
      setError('Nhập mã phiếu từ 4 đến 64 ký tự. Có thể dùng chữ, số, dấu chấm, gạch dưới, gạch nối và hai chấm.');
      return;
    }
    const common = { attemptCount: row.attemptCount, evidenceReference };
    let body: EmailReconciliation;
    if (outcome === 'ACCEPTED') {
      const utc = parseUtc(acceptedAt);
      if (!utc) { setError('Nhập thời điểm SMTP chấp nhận theo UTC.'); return; }
      body = { ...common, outcome, acceptedAt: utc };
    } else {
      body = { ...common, outcome };
    }
    await save(() => api.reconcileEmailDelivery(id, body), 'Không thể ghi kết quả đối soát.');
  }

  async function save(action: () => Promise<unknown>, fallback: string) {
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      if (mounted.current) onSaved();
    } catch (failure) {
      if (!mounted.current) return;
      const known = failure instanceof ApiError;
      setError(known ? failure.message : fallback);
      if (known && (failure.status === 409 || failure.outcome === 'unknown')) setNeedsRefresh(true);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function submitRetry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || unavailable || !retryConfirmed || !row || !retry) return;
    const body = { attemptCount: row.attemptCount, evidenceReference: retry.evidenceReference };
    await save(() => api.retryEmailDelivery(id, body), 'Không thể lên lịch gửi lại email.');
  }

  const message = row && diagnosis(row);
  return <div className="modal-layer">
    <button type="button" className="modal-scrim" onClick={close} aria-label="Đóng hộp thoại" tabIndex={-1}/>
    <section ref={dialog} className="decision-dialog email-delivery-dialog" role="dialog" aria-modal="true" aria-labelledby="email-delivery-title">
      <header><div><p className="eyebrow">Vận hành email</p><h2 id="email-delivery-title">{retrying ? 'Xác nhận gửi lại' : 'Chi tiết lần gửi'}</h2></div>
        <button ref={closeButton} type="button" className="icon-button" aria-label="Đóng" disabled={busy} onClick={close}><X size={20}/></button>
      </header>
      <div className="email-delivery-body">
        <p role="status">{resource.loading ? 'Đang tải chi tiết lần gửi…' : row ? 'Đã tải chi tiết lần gửi.' : ''}</p>
        {resource.error && <div className="login-error" role="alert">
          {resource.error}{row && ' Đang hiển thị dữ liệu lần tải trước.'}
          <button type="button" className="text-button" onClick={reload}>Thử tải lại</button>
        </div>}
        <MutationGuardNotice operationKey={operationKey}/>
        {!retrying && row && <>
          <dl className="detail-grid provider-detail-grid">
            <div><dt>Thông báo</dt><dd>{emailDeliveryType(row.type)}</dd></div>
            <div><dt>Trạng thái</dt><dd><StatusPill label={emailDeliveryStatus(row.status)} tone={row.status === 'FAILED' ? 'danger' : row.status === 'SENT' ? 'success' : 'warning'}/></dd></div>
            <div><dt>Người nhận</dt><dd>{row.recipientName}<small className="cell-subtitle">{row.recipientEmail}</small></dd></div>
            <div><dt>Lần gửi gần nhất</dt><dd>{row.attemptCount} lượt · {emailDeliveryTime(row.claimedAt)}</dd></div>
            <div><dt>Ngày tạo</dt><dd>{emailDeliveryTime(row.createdAt)}</dd></div>
            <div><dt>{row.status === 'SENT' ? 'SMTP chấp nhận lúc' : 'Ghi nhận lỗi lúc'}</dt><dd>{emailDeliveryTime(row.sentAt ?? row.failedAt)}</dd></div>
            <div className="email-message-id"><dt>Mã đối chiếu Message-ID</dt><dd><code>{row.messageIdPrefix}</code></dd></div>
            {retry && <div><dt>Mã phiếu đã xác minh</dt><dd>{retry.evidenceReference}</dd></div>}
          </dl>
          {message && <p>{message}</p>}
          {retry && <button ref={retryButton} type="button" className="primary-button" disabled={unavailable}
            onClick={() => { setRetrying(true); setError(''); dialog.current?.scrollTo(0, 0); closeButton.current?.focus(); }}>Lên lịch gửi lại</button>}
          {row.status === 'FAILED' && !retrying && needsRefresh && <p className="login-error" role="alert">{error} <button type="button" className="text-button" onClick={reload}>Tải lại chi tiết</button></p>}
        </>}
      </div>
      {retrying && <form onSubmit={submitRetry} className="email-reconciliation-form">
        {row && retry ? <>
          <p>Mã phiếu <strong>{retry.evidenceReference}</strong> ghi nhận SMTP chưa chấp nhận thư. Crypta sẽ lên lịch để worker nhận thư sau ít nhất {retry.delaySeconds / 60} phút và ghi Audit Log.</p>
          <p>Worker sẽ kiểm tra điều kiện gửi hiện tại trước khi dùng lượt {row.attemptCount + 1} trên {retry.maxAttempts}.</p>
          <label className="email-retry-confirmation"><input type="checkbox" required checked={retryConfirmed} disabled={unavailable}
            onChange={event => setRetryConfirmed(event.target.checked)}/> Tôi đã đối chiếu mã phiếu và xác nhận SMTP chưa chấp nhận thư này.</label>
        </> : <p>Lần gửi đã đổi trạng thái. Hãy tải lại chi tiết để kiểm tra.</p>}
        {error && <p className="login-error" role="alert">{error}</p>}
        {needsRefresh && <button type="button" className="secondary-button" onClick={reload}>Tải lại chi tiết</button>}
        <footer><button type="submit" className="primary-button" disabled={unavailable || !retry || !retryConfirmed}>
          {busy ? 'Đang lên lịch…' : 'Lên lịch gửi lại'}
        </button></footer>
      </form>}
      {!retrying && (eligible || dirty) && <form onSubmit={submit} className="email-reconciliation-form" aria-labelledby="email-reconciliation-heading">
        <h3 id="email-reconciliation-heading">Ghi nhận đối soát</h3>
        <p>Đối chiếu Message-ID với nhật ký SMTP trước khi xác nhận. Kết quả được lưu vào Audit Log. Việc ghi nhận không gọi SMTP.</p>
        {!eligible && row && <p role="status">Lần gửi đã đổi trạng thái. Biểu mẫu đang giữ nội dung để bạn đối chiếu.</p>}
        <fieldset className="mutation-fields" disabled={disabled}>
          <label className="form-field"><span>Kết quả đã xác minh</span>
            <select required value={outcome} onChange={event => { setOutcome(event.target.value as typeof outcome); setError(''); }}>
              <option value="">Chọn kết quả</option>
              <option value="ACCEPTED">SMTP đã chấp nhận</option>
              <option value="UNSENT">SMTP xác nhận chưa chấp nhận</option>
            </select>
          </label>
          {outcome === 'ACCEPTED' && <label className="form-field"><span>Thời điểm SMTP chấp nhận (UTC)</span>
            <input type="datetime-local" value={acceptedAt} onChange={event => { setAcceptedAt(event.target.value); setError(''); }} step={1} required/>
          </label>}
          <label className="form-field"><span>Mã phiếu đối soát</span>
            <input autoComplete="off" value={evidence} onChange={event => { setEvidence(event.target.value); setError(''); }} placeholder="VD SMTP-2041" maxLength={64} required/>
            <small>Chỉ nhập mã tham chiếu nội bộ. Giữ nội dung thư và thông tin xác thực trong hệ thống nguồn.</small>
          </label>
        </fieldset>
        {error && <p className="login-error" role="alert">{error}</p>}
        {needsRefresh && <button type="button" className="secondary-button" onClick={reload}>Tải lại chi tiết</button>}
        <footer><button type="submit" className="primary-button" disabled={disabled}>{busy ? 'Đang ghi kết quả…' : 'Ghi kết quả'}</button></footer>
      </form>}
    </section>
    <UnsavedChangesDialog open={discard || blocker.state === 'blocked'}
      onStay={() => { setDiscard(false); if (blocker.state === 'blocked') blocker.reset(); }}
      onDiscard={() => { if (blocker.state === 'blocked') blocker.proceed(); else onClose(); }}/>
  </div>;
}
