import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { RotateCw, Search, X } from 'lucide-react';
import { api } from './api';
import type { AuditFilters } from './api/contracts/audit';
import { TableSkeletonRows } from './LoadingOutline';
import { PageSizeSelect } from './PageSizeSelect';
import { useReportExports } from './ReportExports';
import { useDelayedPending } from './useDelayedPending';
import { useResource } from './useResource';
import { useUrlTableQuery } from './useUrlTableQuery';
import { StatusPill, useDialogBehavior } from './WorkspaceUi';

const outcomes = { SUCCESS: 'Thành công', FAILED: 'Thất bại', DENIED: 'Bị từ chối' } as const;
const labels = { actor: 'Người thực hiện', action: 'Hành động', entity: 'Mã đối tượng', correlationId: 'Mã truy vết HTTP',
  from: 'Từ thời điểm (UTC+07)', to: 'Đến thời điểm (UTC+07)' } as const;
type FilterName = keyof typeof labels;
const fields = Object.keys(labels) as FilterName[];
const emptyDraft = { actor: '', action: '', entity: '', correlationId: '', from: '', to: '' };
const shortText = (value: string) => value === value.trim() && value.length <= 100;
const correlationId = /^req_[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const time = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' });

function isLocalMinute(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value + 'Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 16) === value && !value.startsWith('0000');
}

const queryOptions = { filters: {
  actor: shortText, action: shortText, entity: shortText, correlationId: (value: string) => correlationId.test(value),
  from: isLocalMinute, to: isLocalMinute,
} };

function outcomeLabel(outcome: string) {
  return outcomes[outcome as keyof typeof outcomes] ?? outcome;
}

export function AdminAuditTable({ refreshKey }: { refreshKey: number }) {
  const { page, pageSize, status: outcome, search, searchInput, setSearchInput, filters, updateQuery } =
    useUrlTableQuery(Object.keys(outcomes), queryOptions);
  const { actor, action, entity, correlationId: trace, from, to } = filters;
  const [draft, setDraft] = useState({ actor, action, entity, correlationId: trace, from, to });
  const [draftOutcome, setDraftOutcome] = useState(outcome);
  const [advanced, setAdvanced] = useState(fields.some(field => Boolean(filters[field])));
  const [validation, setValidation] = useState<{ field: FilterName; message: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    setDraft({ actor, action, entity, correlationId: trace, from, to });
    if (actor || action || entity || trace || from || to) setAdvanced(true);
    setValidation(null);
  }, [actor, action, entity, trace, from, to]);
  useEffect(() => setDraftOutcome(outcome), [outcome]);

  const applied: AuditFilters = {
    search: search || undefined, outcome: outcome || undefined, actor: actor || undefined, action: action || undefined,
    entity: entity || undefined, correlationId: trace || undefined,
    from: from ? `${from}:00+07:00` : undefined, to: to ? `${to}:00+07:00` : undefined,
  };
  const key = JSON.stringify([page, pageSize, applied]);
  const resource = useResource(`audit:${key}`, signal => api.auditPage({ page, pageSize, ...applied }, signal), refreshKey);
  const { data: result, loading, error } = resource;
  const description = [search && `Tìm nhanh “${search}”`, outcomeLabel(outcome), ...fields.map(field => {
    const value = filters[field];
    return value && `${labels[field]} ${field === 'from' || field === 'to' ? value.replace('T', ' ') : value}`;
  })].filter(Boolean).join(' · ');
  const reports = useReportExports('AUDIT', applied, 'GLOBAL', { disabled: loading || !!error, filterLabel: description });
  const pending = useDelayedPending(loading, key);
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));
  useEffect(() => {
    if (!loading && !error && result?.page === page && page > totalPages) updateQuery({ page: totalPages }, true);
  }, [error, loading, page, result, totalPages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = { ...draft, actor: draft.actor.trim(), action: draft.action.trim(), entity: draft.entity.trim(),
      correlationId: draft.correlationId.trim() };
    const issue = next.correlationId && !correlationId.test(next.correlationId)
      ? { field: 'correlationId' as const, message: 'Nhập đúng mã truy vết bắt đầu bằng req_.' }
      : next.from && next.to && next.from > next.to
        ? { field: 'to' as const, message: 'Thời điểm kết thúc phải từ thời điểm bắt đầu trở đi.' }
        : null;
    setValidation(issue);
    if (issue) {
      setAdvanced(true);
      const control = event.currentTarget.elements.namedItem(issue.field);
      if (control instanceof HTMLInputElement) requestAnimationFrame(() => control.focus());
      return;
    }
    setDraft(next);
    setSearchInput(searchInput.trim());
    updateQuery({ page: 1, q: searchInput, status: draftOutcome, filters: next });
  }

  function clear() {
    setSearchInput('');
    setDraftOutcome('');
    setDraft(emptyDraft);
    setValidation(null);
    updateQuery({ page: 1, q: '', status: '', filters: emptyDraft });
  }

  return <section id="audit-log" className="content-section" aria-labelledby="audit-title">
    <div className="section-heading">
      <div><h2 id="audit-title">Audit Log</h2><p>Tra cứu sự kiện và đối chiếu thay đổi. Chỉ Security Admin có quyền xem.</p></div>
      <div className="table-heading-actions">
        {reports.action}<span className="filter-button">{loading || error ? '—' : result?.total ?? '—'} sự kiện</span>
        <button className="icon-button" aria-label="Làm mới nhật ký" disabled={loading} onClick={resource.retry}><RotateCw size={17}/></button>
      </div>
    </div>
    <form className="audit-filters" onSubmit={submit}>
      <div className="audit-quick-filters">
        <label className="form-field audit-wide"><span>Tìm nhanh</span><input value={searchInput} maxLength={100}
          onChange={event => setSearchInput(event.target.value)} placeholder="Tên, hành động hoặc mã đối tượng"/></label>
        <label className="form-field"><span>Kết quả</span><select value={draftOutcome} onChange={event => setDraftOutcome(event.target.value)}>
          <option value="">Tất cả kết quả</option>{Object.entries(outcomes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <button className="primary-button" type="submit">Áp dụng</button>
        <button className="secondary-button" type="button" onClick={clear}>Xóa bộ lọc</button>
      </div>
      <details open={advanced} onToggle={event => setAdvanced(event.currentTarget.open)}>
        <summary>Bộ lọc nâng cao</summary>
        <div className="audit-advanced-filters">
          {fields.map(field => {
            const date = field === 'from' || field === 'to';
            return <label className={`form-field${date || field === 'correlationId' ? ' audit-wide' : ''}`} key={field}>
              <span>{labels[field]}</span><input type={date ? 'datetime-local' : 'text'} name={field}
                maxLength={field === 'correlationId' ? 40 : date ? undefined : 100} spellCheck={field === 'correlationId' ? false : undefined}
                placeholder={field === 'correlationId' ? 'req_…' : field === 'action' ? 'Ví dụ USER_STATUS_CHANGED' : undefined}
                aria-invalid={validation?.field === field || undefined} aria-describedby={validation?.field === field ? 'audit-filter-error' : undefined}
                value={draft[field]} onChange={event => {
                  const value = event.target.value;
                  setDraft(previous => ({ ...previous, [field]: value }));
                  if (validation?.field === field) setValidation(null);
                }}/>
            </label>;
          })}
        </div>
      </details>
      {validation && <p className="login-error" id="audit-filter-error" role="alert">{validation.message}</p>}
    </form>
    {description && <p className="audit-applied" role="status">{description}</p>}
    {error && <div className="login-error" role="alert">{error}{result && ' Dữ liệu đang hiển thị chưa được cập nhật.'} <button className="text-button" onClick={resource.retry}>Thử lại</button></div>}
    <div className="table-shell">
      <table className="audit-table" aria-busy={loading}>
        <thead><tr><th scope="col">Sự kiện</th><th scope="col" className="audit-actor">Người thực hiện</th><th scope="col">Kết quả</th><th scope="col">Thời điểm (UTC+07)</th></tr></thead>
        <tbody>{loading && !result ? <TableSkeletonRows rows={pageSize} columns={4} visible={pending}/> : result?.items.map(item => <tr key={item.id}>
          <td><button className="text-button audit-event-link" type="button" disabled={loading || !!error} onClick={event => {
            event.currentTarget.focus({ preventScroll: true });
            setSelected(item.id);
          }}>{item.action}</button>
            <small className="cell-subtitle">{item.entityId ?? '—'}</small><small className="cell-subtitle audit-mobile-actor">{item.actorName}</small></td>
          <td className="audit-actor">{item.actorName}</td>
          <td><StatusPill label={outcomeLabel(item.outcome)} tone={item.outcome === 'SUCCESS' ? 'success' : 'danger'}/></td>
          <td>{time.format(new Date(item.occurredAt))}</td>
        </tr>)}</tbody>
      </table>
      <div className={pending ? 'table-pending' : 'sr-only'} role="status">
        {pending ? (result ? 'Đang cập nhật…' : 'Đang tải nhật ký…')
          : !loading && !error && result ? (result.total ? `Đã tìm thấy ${result.total} sự kiện.` : 'Không có sự kiện phù hợp.') : ''}
      </div>
      {!loading && !error && !result?.items.length && <div className="empty-state"><Search size={22}/><strong>Không tìm thấy nhật ký</strong><p>Thử rút ngắn từ khóa hoặc mở rộng khoảng thời gian.</p></div>}
    </div>
    <div className="admin-asset-pagination">
      <span>Trang {page}/{loading || error ? '—' : totalPages} · {loading || error ? '—' : result?.total ?? '—'} sự kiện</span>
      <PageSizeSelect value={pageSize} onChange={value => updateQuery({ pageSize: value })}/>
      <div><button className="secondary-button" disabled={loading || !!error || page <= 1} onClick={() => updateQuery({ page: page - 1 })}>Trước</button>
        <button className="secondary-button" disabled={loading || !!error || page >= totalPages} onClick={() => updateQuery({ page: page + 1 })}>Sau</button></div>
    </div>
    {selected && <AuditEventDialog id={selected} close={() => setSelected(null)}/>}
    {reports.panel}
  </section>;
}

const changeLabels: Record<string, string> = { status: 'Trạng thái tài khoản', departmentId: 'Mã đơn vị',
  departmentCode: 'Mã đơn vị', departmentName: 'Tên đơn vị', policyVersion: 'Phiên bản policy' };
const statusLabels: Record<string, string> = { ACTIVE: 'Đang hoạt động', INACTIVE: 'Đã vô hiệu hóa', LOCKED: 'Bị khóa' };

function AuditEventDialog({ id, close }: { id: string; close: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useDialogBehavior(dialog, closeButton, close);
  const detail = useResource(`audit-event:${id}`, signal => api.auditDetail(id, signal));
  const { data: event, error, loading } = detail;
  const pending = useDelayedPending(loading, id);
  const related = event?.related;
  const displayValue = (field: string, value?: string) => value === undefined ? 'Chưa ghi nhận' : field === 'status' ? statusLabels[value] ?? value : value;

  return <div className="modal-layer">
    <button className="modal-scrim" onClick={close} aria-label="Đóng chi tiết sự kiện"/>
    <section ref={dialog} className="decision-dialog audit-event-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-event-title">
      <header><div><h2 id="audit-event-title">Chi tiết sự kiện</h2>{event && <span>{event.action} · {outcomeLabel(event.outcome)}</span>}</div>
        <button ref={closeButton} className="icon-button" onClick={close} aria-label="Đóng"><X size={20}/></button></header>
      <div className="audit-event-body">
        {loading && <p aria-hidden="true">Đang tải chi tiết sự kiện…</p>}
        <p className="sr-only" role="status">
          {pending ? 'Đang tải chi tiết sự kiện…' : event && !loading && !error ? 'Đã tải chi tiết sự kiện.' : ''}
        </p>
        {error && <div className="login-error" role="alert">{error} <button className="text-button" onClick={() => {
          closeButton.current?.focus({ preventScroll: true });
          detail.retry();
        }}>Thử lại</button></div>}
        {event && !loading && !error && <>
          <dl className="audit-event-facts">
            <div><dt>Mã sự kiện</dt><dd>{event.id}</dd></div><div><dt>Người thực hiện</dt><dd>{event.actorName}</dd></div>
            <div><dt>Thời điểm (UTC+07)</dt><dd>{time.format(new Date(event.occurredAt))}</dd></div>
            <div><dt>Mã truy vết HTTP</dt><dd>{event.correlationId ?? 'Không có'}</dd></div>
          </dl>
          <section className="audit-event-section"><h3>Thay đổi đã ghi nhận</h3>
            {event.changes.length ? event.changes.map(change => <div className="audit-event-change" key={change.field}>
              <strong>{changeLabels[change.field] ?? change.field}</strong>
              <dl className="audit-event-facts"><div><dt>Trước</dt><dd>{displayValue(change.field, change.before)}</dd></div>
                <div><dt>Sau</dt><dd>{displayValue(change.field, change.after)}</dd></div></dl>
            </div>) : <p>Sự kiện không có giá trị trước và sau để hiển thị.</p>}
          </section>
          <section className="audit-event-section"><h3>Đối tượng liên quan</h3>
            {event.entityId && <p className="audit-entity-id">{event.entityId}</p>}
            {related ? <Link to={related.kind === 'USER' ? `/users?userId=${encodeURIComponent(related.id)}` : `/assets/${encodeURIComponent(related.id)}`}>
              {related.kind === 'USER' ? 'Mở tài khoản liên quan' : 'Mở tài sản liên quan'}</Link>
              : <p>Đối tượng không còn khả dụng trong phạm vi hiện tại.</p>}
          </section>
        </>}
      </div>
    </section>
  </div>;
}
