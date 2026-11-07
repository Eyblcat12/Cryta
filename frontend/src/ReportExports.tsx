import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Download, FileDown } from 'lucide-react';
import { api, ApiError } from './api';
import type { ReportDataset, ReportFilters, ReportFormat, ReportJob, ReportPreview, ReportScope } from './api/contracts/reports';
import { useDialogBehavior } from './WorkspaceUi';

const datasetLabels: Record<ReportDataset, string> = { ASSETS: 'Tài sản', REQUESTS: 'Yêu cầu', AUDIT: 'Audit Log' };
const stateLabels: Record<ReportJob['state'], string> = {
  QUEUED: 'Đang chờ tạo báo cáo', RUNNING: 'Đang tạo báo cáo', READY: 'Sẵn sàng để tải',
  FAILED: 'Chưa tạo được báo cáo', CANCELLED: 'Đã hủy tác vụ', EXPIRED: 'Tệp đã hết hạn',
};
const knownFailures: Record<string, string> = {
  REPORT_EMPTY: 'Bộ lọc hiện tại không có dữ liệu.',
  REPORT_TOO_LARGE: 'Hãy thu hẹp bộ lọc hoặc chọn định dạng có giới hạn cao hơn.',
  REPORT_SCOPE_CHANGED: 'Phạm vi của bạn đã thay đổi. Hãy tạo báo cáo mới.',
};
const number = new Intl.NumberFormat('vi-VN');
const time = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

function describeScope(scope: ReportScope) {
  if (scope.mode === 'GLOBAL') return 'Toàn hệ thống';
  if (scope.mode === 'OWN') return 'Dữ liệu của tôi';
  return `${scope.departments.length} đơn vị được giao`;
}

function requestKey() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function message(reason: unknown) {
  return reason instanceof ApiError ? reason.message : 'Không thể xác nhận kết quả. Hãy thử lại.';
}

type Draft = { filters: ReportFilters; filterLabel?: string; format: ReportFormat };

export function useReportExports(dataset: ReportDataset, filters: ReportFilters, mode: ReportScope['mode'],
  options: { enabled?: boolean; disabled?: boolean; filterLabel?: string } = {}) {
  const { enabled = true, disabled = false, filterLabel } = options;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [jobs, setJobs] = useState<ReportJob[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState('');
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const result = await api.reportJobs(dataset, controller.signal);
        if (controller.signal.aborted) return;
        const scoped = result.filter(job => job.scope.mode === mode);
        setJobs(scoped);
        const running = scoped.some(job => job.state === 'QUEUED' || job.state === 'RUNNING');
        const expiries = scoped.flatMap(job => job.state === 'READY' && job.expiresAt ? [Date.parse(job.expiresAt)] : []);
        if (running || expiries.length) {
          const delay = running ? 3_000 : Math.max(500, Math.min(...expiries) - Date.now() + 500);
          timer = setTimeout(() => void read(), delay);
        }
      } catch (reason) {
        if (!controller.signal.aborted) setError(message(reason));
      }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [dataset, enabled, mode, revision]);

  const open = (format: ReportFormat = 'CSV') => setDraft({ filters: { ...filters }, filterLabel, format });
  const update = (job: ReportJob) => {
    setJobs(current => [job, ...current.filter(item => item.id !== job.id)].slice(0, 20));
    setError('');
    setRevision(value => value + 1);
  };
  async function act(job: ReportJob, action: 'cancel' | 'download') {
    if (pending.current) return;
    pending.current = true;
    setBusy(job.id);
    setError('');
    try {
      if (action === 'cancel') update(await api.cancelReport(job.id));
      else {
        const blob = await api.reportFile(job.id, job.format);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `crypta-${job.dataset.toLowerCase()}-${job.id}.${job.format.toLowerCase()}`;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
    } catch (reason) {
      setError(message(reason));
      setRevision(value => value + 1);
    } finally { pending.current = false; setBusy(''); }
  }

  return {
    action: enabled && <button type="button" className="secondary-button" disabled={disabled} onClick={() => open()}>
      <FileDown size={17}/> Xuất báo cáo
    </button>,
    panel: enabled && <>
      {(jobs.length > 0 || error) && <section className="report-jobs" aria-label="Báo cáo của bạn">
        <h3>Báo cáo của bạn</h3>
        {error && <div className="login-error" role="alert">{error} <button type="button" className="text-button" onClick={() => {
          setError(''); setRevision(value => value + 1);
        }}>Thử tải lại</button></div>}
        <ul>{jobs.map(job => <li key={job.id}>
          <div><strong>{datasetLabels[job.dataset]} · {job.format}</strong>
            <p role="status">{stateLabels[job.state]}{job.rowCount !== null ? ` · ${number.format(job.rowCount)} dòng` : ''}</p>
            {job.failureCode && <small>{knownFailures[job.failureCode] ?? 'Hãy thử tạo lại báo cáo.'}</small>}
            <small>{job.state === 'READY' && job.expiresAt ? `Tải đến ${time.format(new Date(job.expiresAt))}` : time.format(new Date(job.createdAt))}</small>
          </div>
          <div className="table-heading-actions">
            {['QUEUED', 'RUNNING'].includes(job.state) && <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void act(job, 'cancel')}>Hủy tác vụ</button>}
            {job.state === 'READY' && <button type="button" className="primary-button" disabled={!!busy} onClick={() => void act(job, 'download')}>
              <Download size={16}/> {busy === job.id ? 'Đang tải…' : `Tải ${job.format}`}
            </button>}
            {['FAILED', 'EXPIRED', 'CANCELLED'].includes(job.state) && <button type="button" className="secondary-button" onClick={() => open(job.format)}>Tạo lại</button>}
          </div>
        </li>)}</ul>
      </section>}
      {draft && <ReportDialog dataset={dataset} draft={draft} onClose={() => setDraft(null)}
        onCreated={job => { update(job); setDraft(null); }}/>}
    </>,
  };
}

function ReportDialog({ dataset, draft, onClose, onCreated }: {
  dataset: ReportDataset; draft: Draft; onClose: () => void; onCreated: (job: ReportJob) => void;
}) {
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [format, setFormat] = useState(draft.format);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const keys = useRef<Partial<Record<ReportFormat, string>>>({});
  const dialog = useRef<HTMLElement>(null);
  const focus = useRef<HTMLInputElement>(null);
  const close = () => { if (!pending.current) onClose(); };
  useDialogBehavior(dialog, focus, close);

  useEffect(() => {
    const controller = new AbortController();
    void api.previewReport(dataset, draft.filters, controller.signal).then(setPreview).catch(reason => {
      if (!controller.signal.aborted) setPreviewError(message(reason));
    });
    return () => controller.abort();
  }, [dataset, draft, attempt]);

  const sizeError = preview?.total === 0 ? 'Bộ lọc hiện tại không có dữ liệu.'
    : preview && preview.total > preview.limits[format] ? 'Hãy thu hẹp bộ lọc hoặc chọn định dạng có giới hạn cao hơn.' : '';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview || sizeError || pending.current) return;
    pending.current = true;
    setBusy(true);
    setSubmitError('');
    try {
      const key = keys.current[format] ??= requestKey();
      onCreated(await api.createReport(dataset, draft.filters, format, key));
    } catch (reason) { setSubmitError(message(reason)); }
    finally { pending.current = false; setBusy(false); }
  }

  return <div className="modal-layer"><button type="button" className="modal-scrim" aria-label="Đóng hộp xuất báo cáo" onClick={close}/>
    <section ref={dialog} className="decision-dialog report-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header><div><h2 id="export-title">Xuất báo cáo</h2><p>Tệp dùng bộ lọc và phạm vi quyền hiện tại.</p></div><FileDown size={22}/></header>
      <form onSubmit={submit}>
        <dl className="report-summary">
          <div><dt>Danh sách</dt><dd>{datasetLabels[dataset]}</dd></div>
          <div><dt>Kết quả theo bộ lọc</dt><dd>{preview ? `${number.format(preview.total)} dòng` : '—'}</dd></div>
          <div><dt>Phạm vi</dt><dd>{preview ? describeScope(preview.scope) : '—'}</dd></div>
          <div><dt>Múi giờ</dt><dd>{preview?.timeZone === 'Asia/Ho_Chi_Minh' ? 'Việt Nam (UTC+07)' : preview?.timeZone ?? '—'}</dd></div>
        </dl>
        {draft.filterLabel && <p className="report-note">{draft.filterLabel}</p>}
        {!preview && !previewError && <p className="report-note" role="status">Đang kiểm tra dữ liệu theo bộ lọc…</p>}
        {previewError && <div className="login-error" role="alert">{previewError} <button type="button" className="text-button" onClick={() => {
          setPreviewError(''); setAttempt(value => value + 1);
        }}>Thử lại</button></div>}
        <fieldset className="report-formats" disabled={busy}><legend>Định dạng</legend>
          {(['CSV', 'PDF'] as const).map(value => <label key={value}>
            <input ref={value === draft.format ? focus : undefined} name="format" type="radio" value={value} checked={format === value}
              onChange={() => { setFormat(value); setSubmitError(''); }}/>
            <span><strong>{value}</strong><small>{value === 'CSV' ? 'Dùng trong bảng tính' : 'Dùng để đọc và in'}
              {preview ? ` · tối đa ${number.format(preview.limits[value])} dòng` : ''}</small></span>
          </label>)}
        </fieldset>
        <p className="report-note">Bạn có thể tiếp tục tra cứu trong lúc hệ thống tạo báo cáo. Tệp tải được trong 1 giờ sau khi sẵn sàng.</p>
        {sizeError && <p className="login-error" role="status">{sizeError}</p>}
        {submitError && <p className="login-error" role="alert">{submitError}</p>}
        <footer><button type="button" className="secondary-button" disabled={busy} onClick={close}>Đóng</button>
          <button type="submit" className="primary-button" disabled={!preview || !!sizeError || busy}>{busy ? 'Đang gửi…' : 'Tạo báo cáo'}</button></footer>
      </form>
    </section></div>;
}
