import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api, ApiError } from './api';
import type { ProviderIssue, RecoveryAction, RecoveryFailure, RecoveryStatus } from './api/contracts/provider-recovery';
import { TableSkeletonRows } from './LoadingOutline';
import { MutationGuardNotice } from './MutationNotice';
import { PageSizeSelect } from './PageSizeSelect';
import { ResourceRegion } from './ResourceRegion';
import { UnsavedChangesDialog, useUnsavedChanges } from './UnsavedChanges';
import { useResource } from './useResource';
import { useUrlTableQuery } from './useUrlTableQuery';
import { useMutationGuard } from './useWorkspaceMutations';
import { PageHeader, requestStatus, StatusPill, useDialogBehavior } from './WorkspaceUi';

const statuses = ['RECONCILIATION_REQUIRED', 'RETRY_SCHEDULED', 'FAILED'] as const;
const types = { CREATE: 'Cấp mới', RENEW: 'Gia hạn', REVOKE: 'Thu hồi' } as const;
const classifications: Record<RecoveryFailure, { label: string; detail: string }> = {
  RESULT_RECORDED: { label: 'Có kết quả đã ghi', detail: 'Provider đã trả kết quả. Crypta có thể áp dụng biên nhận nếu dữ liệu phê duyệt và phạm vi provider vẫn khớp.' },
  UNSENT_TRANSIENT: { label: 'Lỗi tạm thời · Chưa gửi', detail: 'Nhật ký xác nhận chưa gửi. Bạn có thể lên lịch thử lại nếu còn lượt, hoặc đóng yêu cầu.' },
  UNSENT_PERMANENT: { label: 'Lỗi vĩnh viễn · Chưa gửi', detail: 'Điều kiện xử lý không phù hợp trước lúc gửi. Bạn có thể đóng yêu cầu và thông báo cho người tạo.' },
  OUTCOME_UNKNOWN: { label: 'Chưa rõ kết quả', detail: 'Cần đối chiếu với nhà cung cấp trước khi thay đổi yêu cầu.' },
};
const actions: Record<RecoveryAction, { label: string; detail: string }> = {
  CONFIRM: { label: 'Áp dụng biên nhận', detail: 'Crypta sẽ lưu kết quả đã ghi và thông báo cho người tạo. Thao tác dùng biên nhận hiện có.' },
  RETRY: { label: 'Lên lịch thử lại', detail: 'Worker sẽ kiểm tra lại điều kiện xử lý sau 60 giây trước khi gửi.' },
  ABANDON: { label: 'Đóng do lỗi xử lý', detail: 'Yêu cầu sẽ chuyển sang Xử lý lỗi và người tạo sẽ nhận thông báo.' },
};
const auditLabels: Record<string, string> = {
  REQUEST_RECONCILIATION_REQUIRED: 'Chuyển sang đối soát',
  PROVIDER_RETRY_SCHEDULED: 'Lên lịch thử lại',
  PROVIDER_REQUEST_ABANDONED: 'Đóng do lỗi xử lý',
  PROVIDER_RESULT_CONFIRMED: 'Áp dụng biên nhận',
};
const formatter = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

function time(value: string | null) { return value ? formatter.format(new Date(value)) : '—'; }
function statusInfo(status: RecoveryStatus) {
  return status === 'RETRY_SCHEDULED' ? { label: 'Đang chờ thử lại', tone: 'warning' } : requestStatus[status];
}

export function ProviderRecoveryPage({ scope, revision }: { scope: string; revision: number }) {
  const { page, pageSize, status, updateQuery } = useUrlTableQuery(statuses, { search: false });
  const resource = useResource(`${scope}:provider-issues:${page}:${pageSize}:${status}`,
    signal => api.providerIssues({ page, pageSize, status }, signal), revision);
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = useRef<HTMLButtonElement>(null);
  const pages = Math.max(1, Math.ceil((resource.data?.total ?? 0) / pageSize));
  const stale = resource.loading || !!resource.error;
  useEffect(() => {
    if (!stale && resource.data?.page === page && page > pages) updateQuery({ page: pages }, true);
  }, [stale, resource.data, page, pages]);

  function completed() {
    const pageHeading = refresh.current?.closest('section')?.querySelector('h1');
    setSelected(null);
    requestAnimationFrame(() => pageHeading?.focus());
  }

  return <>
    <PageHeader eyebrow="Vận hành" title="Đối soát provider" description="Kiểm tra yêu cầu gặp lỗi, lần gửi và bằng chứng đã ghi."
      actions={<button ref={refresh} className="secondary-button" disabled={resource.loading} onClick={resource.retry}>Làm mới</button>}/>
    <section className="content-section" aria-label="Yêu cầu vận hành">
      <div className="admin-asset-controls"><label><span className="sr-only">Trạng thái đối soát</span>
        <select value={status} onChange={event => updateQuery({ status: event.target.value, page: 1 })}>
          <option value="">Tất cả trạng thái</option>
          {statuses.map(value => <option key={value} value={value}>{statusInfo(value).label}</option>)}
        </select>
      </label></div>
      <ResourceRegion resource={resource} label="Danh sách đối soát" placeholder={<IssueTable><TableSkeletonRows rows={3} columns={5} visible/></IssueTable>}>
        {result => result.items.length ? <IssueTable>{result.items.map(row => {
          const state = statusInfo(row.status);
          return <tr key={row.id}>
            <td><strong>{types[row.type]}</strong><small className="cell-subtitle">{row.id.slice(0, 8)}</small></td>
            <td><StatusPill label={state.label} tone={state.tone}/>{row.failureClass && <small className="cell-subtitle">{classifications[row.failureClass].label}</small>}</td>
            <td>{row.attemptCount}</td><td>{time(row.updatedAt)}</td>
            <td><button className="secondary-button" disabled={stale} onClick={() => setSelected(row.id)} aria-label={`Xem chi tiết yêu cầu ${row.id}`}>Xem chi tiết</button></td>
          </tr>;
        })}</IssueTable> : <div className="empty-state"><strong>Chưa có yêu cầu cần đối soát</strong><p>Yêu cầu gặp lỗi hoặc đang chờ thử lại sẽ xuất hiện ở đây.</p></div>}
      </ResourceRegion>
      <div className="admin-asset-pagination">
        <span>Trang {page}/{stale ? '—' : pages} · {stale ? '—' : resource.data?.total ?? 0} yêu cầu</span>
        <PageSizeSelect value={pageSize} onChange={size => updateQuery({ pageSize: size })}/>
        <div><button className="secondary-button" disabled={stale || page <= 1} onClick={() => updateQuery({ page: page - 1 })}>Trước</button>
          <button className="secondary-button" disabled={stale || page >= pages} onClick={() => updateQuery({ page: page + 1 })}>Sau</button></div>
      </div>
    </section>
    {selected && <IssueDialog id={selected} revision={revision} onClose={() => setSelected(null)} onSaved={completed}/>}
  </>;
}

function IssueTable({ children }: { children: ReactNode }) {
  return <div className="table-shell"><div className="table-scroll"><table className="users-table">
    <thead><tr><th scope="col">Yêu cầu</th><th scope="col">Tình trạng</th><th scope="col">Lần gửi provider</th><th scope="col">Cập nhật</th><th scope="col">Thao tác</th></tr></thead>
    <tbody>{children}</tbody>
  </table></div></div>;
}

function RecoveryModal({ title, labelId, onClose, children }: {
  title: string; labelId: string; onClose: () => void; children: ReactNode;
}) {
  const container = useRef<HTMLElement>(null), close = useRef<HTMLButtonElement>(null);
  useDialogBehavior(container, close, onClose);
  return <div className="modal-layer">
    <button className="modal-scrim" onClick={onClose} aria-label="Đóng hộp thoại" tabIndex={-1}/>
    <section ref={container} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby={labelId}>
      <header><div><p className="eyebrow">Đối soát provider</p><h2 id={labelId}>{title}</h2></div>
        <button ref={close} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20}/></button></header>
      {children}
    </section>
  </div>;
}

function IssueDialog({ id, revision, onClose, onSaved }: { id: string; revision: number; onClose: () => void; onSaved: () => void }) {
  const resource = useResource(`provider-issue:${id}`, signal => api.providerIssue(id, signal), revision);
  const operation = useMutationGuard(`provider:${id}`);
  const [action, setAction] = useState<RecoveryAction | null>(null);
  const data = resource.data;
  const state = data && statusInfo(data.status);
  if (action && data) return <RecoveryConfirmation key={action} initial={data} action={action}
    onBack={() => { setAction(null); resource.retry(); }} onSaved={onSaved}/>;
  return <RecoveryModal title={data ? `${types[data.type]} · ${id.slice(0, 8)}` : 'Chi tiết yêu cầu'} labelId="provider-issue-title" onClose={onClose}>
      <div className="provider-dialog-body">
        <MutationGuardNotice operationKey={`provider:${id}`}/>
        <ResourceRegion resource={resource} label="Chi tiết đối soát">{row => <>
          {state && <StatusPill label={state.label} tone={state.tone}/>}
          <dl className="detail-grid provider-detail-grid">
            <div><dt>Mã yêu cầu</dt><dd>{row.id}</dd></div><div><dt>Lần gửi provider</dt><dd>{row.attemptCount}</dd></div>
            <div><dt>Lượt thử lại đã lên lịch</dt><dd>{row.retryCount}</dd></div><div><dt>Lịch thử lại</dt><dd>{time(row.retryAfter)}</dd></div>
            <div><dt>Mốc gửi</dt><dd>{time(row.sentAt)}</dd></div><div><dt>Mốc nhận biên nhận</dt><dd>{time(row.receiptAt)}</dd></div>
            <div><dt>Mã lỗi</dt><dd>{row.errorCode ?? '—'}</dd></div><div><dt>Phiên bản yêu cầu</dt><dd>{row.version}</dd></div>
          </dl>
          {row.status === 'RECONCILIATION_REQUIRED' && row.failureClass && <div className="inline-alert"><p>{classifications[row.failureClass].detail}</p></div>}
          <h3>Lịch sử xử lý</h3>
          {row.history.length ? <ul className="provider-timeline">{row.history.map(event => <li key={event.id}>
            <strong>{auditLabels[event.action] ?? event.action}</strong>
            <small>{time(event.occurredAt)} · {event.actorType === 'USER' ? 'Quản trị viên' : 'Hệ thống'}</small>
            {event.delaySeconds !== null && <small>Lượt {event.retryCount} · sau {event.delaySeconds} giây</small>}
            {event.reason && <p>{event.reason}</p>}
          </li>)}</ul> : <p>Chưa có mốc xử lý bổ sung.</p>}
          <div className="heading-actions provider-dialog-actions">
            {row.availableActions.map(value => <button key={value} type="button" className={value === 'ABANDON' ? 'danger-quiet-button' : 'primary-button'}
              disabled={resource.loading || !!resource.error || !!operation} onClick={() => setAction(value)}>{actions[value].label}</button>)}
          </div>
        </>}</ResourceRegion>
      </div>
    </RecoveryModal>;
}

function RecoveryConfirmation({ initial, action, onBack, onSaved }: {
  initial: ProviderIssue; action: RecoveryAction; onBack: () => void; onSaved: () => void;
}) {
  const [base, setBase] = useState(initial);
  const [reason, setReason] = useState(''), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [discard, setDiscard] = useState(false);
  const [error, setError] = useState(''), [conflict, setConflict] = useState(false);
  const locked = useRef(false), mounted = useRef(true), read = useRef<AbortController | null>(null);
  const operation = useMutationGuard(`provider:${base.id}`);
  const dirty = !busy && (!!reason || confirmed);
  const blocker = useUnsavedChanges(dirty);
  const allowed = base.availableActions.includes(action);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; read.current?.abort(); };
  }, []);

  function requestClose() {
    if (locked.current) return;
    if (dirty) setDiscard(true); else onBack();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current || operation || conflict || !confirmed || reason.trim().length < 10 || !allowed) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await api.recoverProviderIssue(base.id, { action, version: base.version, reason: reason.trim() });
      if (mounted.current) onSaved();
    } catch (failure) {
      if (!mounted.current) return;
      setError(failure instanceof ApiError ? failure.message : 'Không thể xác nhận thao tác.');
      if (failure instanceof ApiError && ['VERSION_CONFLICT', 'RECOVERY_UNVERIFIED'].includes(failure.code)) {
        setConflict(true); setConfirmed(false);
      }
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function reload() {
    if (locked.current || operation) return;
    locked.current = true; setBusy(true);
    const controller = new AbortController(); read.current = controller;
    try {
      const current = await api.providerIssue(base.id, controller.signal);
      if (!mounted.current) return;
      setBase(current); setError(''); setConflict(false); setConfirmed(false);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof ApiError ? failure.message : 'Không thể tải trạng thái hiện tại.');
    } finally {
      locked.current = false; read.current = null;
      if (mounted.current) setBusy(false);
    }
  }

  return <>
    <RecoveryModal title={actions[action].label} labelId="provider-action-title" onClose={requestClose}>
      <form onSubmit={submit}>
        <fieldset className="mutation-fields" disabled={busy || operation?.phase === 'pending'}>
          <div className="inline-alert"><p>{actions[action].detail}</p></div>
          <label className="form-field"><span>Lý do <em>*</em></span>
            <textarea value={reason} onChange={event => setReason(event.target.value)} required minLength={10} maxLength={500} rows={3}/>
          </label>
          <label className="provider-confirmation-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required/>
            Tôi đã kiểm tra thông tin và xác nhận thao tác.
          </label>
          {error && operation?.phase !== 'unknown' && <div className="login-error" role="alert">{error}
            {conflict && <button type="button" className="text-button" onClick={() => void reload()}>Tải lại trạng thái</button>}
          </div>}
          {!allowed && <p className="login-error" role="alert">Trạng thái hiện tại không cho phép thao tác này. Lý do đã nhập vẫn được giữ.</p>}
        </fieldset>
        <MutationGuardNotice operationKey={`provider:${base.id}`}/>
        <footer><button type="button" className="quiet-button" disabled={busy} onClick={requestClose}>Quay lại</button>
          <button className={action === 'ABANDON' ? 'danger-button' : 'primary-button'} disabled={busy || !!operation || conflict || !allowed || !confirmed || reason.trim().length < 10}>Xác nhận</button>
        </footer>
      </form>
    </RecoveryModal>
    <UnsavedChangesDialog open={discard || blocker.state === 'blocked'} onStay={() => { setDiscard(false); if (blocker.state === 'blocked') blocker.reset(); }}
      onDiscard={() => { if (blocker.state === 'blocked') blocker.proceed(); else onBack(); }}/>
  </>;
}
