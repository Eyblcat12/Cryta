import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { api, ApiError } from './api';
import type { AdminPolicy, PolicyAlgorithm, PolicyConfigurationInput, PolicyVersion } from './api/contracts/policies';
import { MutationGuardNotice } from './MutationNotice';
import { ResourceRegion } from './ResourceRegion';
import { UnsavedChangesDialog, useUnsavedChanges } from './UnsavedChanges';
import { useResource } from './useResource';
import { useMutationGuard } from './useWorkspaceMutations';
import { StatusPill, useDialogBehavior } from './WorkspaceUi';

type PolicyKind = PolicyAlgorithm | 'TLS';
type OpenDialog = { type: 'create' } | { type: 'version' | 'history' | 'stop'; policy: AdminPolicy };

const kinds: { value: PolicyKind; label: string }[] = [
  { value: 'RSA', label: 'RSA' }, { value: 'ECDSA', label: 'ECDSA' },
  { value: 'ED25519', label: 'Ed25519' }, { value: 'AES', label: 'AES' }, { value: 'TLS', label: 'Chứng thư TLS' },
];

function dateLabel(date: string) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(date));
}

export function PolicyManager({ policies, disabled }: { policies: AdminPolicy[]; disabled: boolean }) {
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const newOperation = useMutationGuard('policy:new');
  const close = () => setDialog(null);
  return <section className="content-section" aria-labelledby="policy-manager-title">
    <div className="section-heading">
      <div><h2 id="policy-manager-title">Danh sách chính sách</h2><p>Quản lý hiệu lực và lịch sử phiên bản.</p></div>
      <button className="primary-button" disabled={disabled || !!newOperation} onClick={() => setDialog({ type: 'create' })}>Tạo chính sách</button>
    </div>
    {policies.length ? <>
      <div className="table-scroll"><table className="policy-table policy-lifecycle-table">
        <thead><tr><th>Chính sách</th><th>Trạng thái</th><th>Phiên bản hiệu lực</th><th>Thao tác</th></tr></thead>
        <tbody>{policies.map(policy => <PolicyRow key={policy.id} policy={policy} disabled={disabled} onOpen={setDialog}/>)}</tbody>
      </table></div>
      <p className="cell-subtitle">{policies.length} chính sách</p>
    </> : <div className="empty-state"><strong>Chưa có chính sách</strong><p>Tạo chính sách để bắt đầu tiếp nhận yêu cầu cấp mới.</p></div>}
    {dialog?.type === 'create' && <PolicyEditor disabled={disabled} onClose={close}/>}
    {dialog?.type === 'version' && <PolicyEditor policy={dialog.policy} disabled={disabled} onClose={close}/>}
    {dialog?.type === 'history' && <PolicyHistory policy={dialog.policy} onClose={close}/>}
    {dialog?.type === 'stop' && <PolicyStop policy={dialog.policy} disabled={disabled} onClose={close}/>}
  </section>;
}

function PolicyRow({ policy, disabled, onOpen }: { policy: AdminPolicy; disabled: boolean; onOpen: (dialog: OpenDialog) => void }) {
  const operation = useMutationGuard('policy:' + policy.id);
  return <tr>
    <td><strong>{policy.name}</strong><small className="cell-subtitle">{policy.code}</small></td>
    <td><StatusPill label={policy.active ? 'Đang áp dụng' : 'Đã ngừng áp dụng'} tone={policy.active ? 'success' : 'neutral'}/></td>
    <td><strong>{policy.effectiveVersion === null ? '—' : 'v' + policy.effectiveVersion}</strong>
      {policy.effectiveFrom ? <small className="cell-subtitle">{dateLabel(policy.effectiveFrom)}</small>
        : policy.latest && <small className="cell-subtitle">Bản gần nhất v{policy.latest.version}</small>}</td>
    <td><div className="organization-row-actions">
      <button className="secondary-button" disabled={disabled} onClick={() => onOpen({ type: 'history', policy })}>Lịch sử</button>
      {policy.active && <>
        <button className="secondary-button" disabled={disabled || !!operation} onClick={() => onOpen({ type: 'version', policy })}>Tạo phiên bản</button>
        <button className="danger-quiet-button" disabled={disabled || !!operation} onClick={() => onOpen({ type: 'stop', policy })}>Ngừng áp dụng</button>
      </>}
    </div></td>
  </tr>;
}

function PolicyDialog({ title, busy = false, onClose, children }: {
  title: string; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLElement>(null);
  const focus = useRef<HTMLButtonElement>(null);
  const close = () => { if (!busy) onClose(); };
  useDialogBehavior(dialog, focus, close);
  return <div className="modal-layer">
    <button className="modal-scrim" aria-label="Đóng hộp thoại" disabled={busy} onClick={close}/>
    <section className="decision-dialog policy-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby={id}>
      <header><h2 id={id}>{title}</h2><button className="icon-button" ref={focus} type="button" aria-label="Đóng" disabled={busy} onClick={close}><X size={20}/></button></header>
      {children}
    </section>
  </div>;
}

function kindOf(configuration: PolicyVersion['configuration']): PolicyKind {
  if (configuration.certificate_profile) return 'TLS';
  return kinds.find(item => item.value === configuration.algorithm)?.value ?? 'RSA';
}

function PolicyEditor({ policy, disabled, onClose }: { policy?: AdminPolicy; disabled: boolean; onClose: () => void }) {
  const configuration = policy?.latest?.configuration ?? {};
  const initialKind = kindOf(configuration);
  const initialDays = String(configuration.maximum_validity_days ?? 365);
  const curveBits = configuration.curve === 'P-384' ? 384 : configuration.curve === 'P-521' ? 521 : 256;
  const initialBits = String(configuration.minimum_key_size ?? (initialKind === 'RSA' ? 2048 : curveBits));
  const initialWarnings = Array.isArray(configuration.warning_days) ? configuration.warning_days.join(',') : '30,7,1';
  const [base, setBase] = useState(policy);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState(initialKind);
  const [days, setDays] = useState(initialDays);
  const [bits, setBits] = useState(initialBits);
  const [warnings, setWarnings] = useState(initialWarnings);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [discard, setDiscard] = useState(false);
  const pending = useRef(false);
  const operationKey = 'policy:' + (policy?.id ?? 'new');
  const operation = useMutationGuard(operationKey);
  const dirty = !!(code || name || confirmed || kind !== initialKind || days !== initialDays || bits !== initialBits || warnings !== initialWarnings);
  const blocker = useUnsavedChanges(dirty && !busy);
  const requestClose = () => { if (dirty) setDiscard(true); else onClose(); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current || disabled || operation || conflict || base?.active === false || !confirmed) return;
    const warningDays = warnings.trim() ? warnings.split(',').map(value => value.trim()) : [];
    if (warningDays.some(value => !/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > Number(days))
      || new Set(warningDays.map(Number)).size !== warningDays.length) {
      setError('Nhập các mốc cảnh báo khác nhau, là số ngày dương và không vượt thời hạn.');
      return;
    }
    const input: PolicyConfigurationInput = {
      maximumValidityDays: Number(days), warningDays: warningDays.map(Number),
      ...(kind === 'TLS' ? { certificateProfile: 'TLS_SERVER' } : {
        algorithm: kind, minimumKeySize: kind === 'ED25519' ? 256 : Number(bits),
      }),
    };
    // Preserve an explicit key algorithm/size on legacy certificate versions when the kind stays TLS.
    if (kind === 'TLS' && initialKind === 'TLS' && configuration.algorithm) {
      const legacyAlgorithm = kinds.find(item => item.value !== 'TLS' && item.value === configuration.algorithm)?.value;
      if (legacyAlgorithm && legacyAlgorithm !== 'TLS') input.algorithm = legacyAlgorithm;
      if (typeof configuration.minimum_key_size === 'number') input.minimumKeySize = configuration.minimum_key_size;
    }
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (base) await api.createPolicyVersion(base.id, { ...input, expectedVersion: base.latest?.version ?? 0 });
      else await api.createPolicy({ ...input, code, name: name.trim() });
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể phát hành chính sách.');
      if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT') setConflict(true);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function reloadVersion() {
    if (!base || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const current = (await api.adminPolicies()).find(row => row.id === base.id);
      if (!current) { setError('Chính sách không còn trong danh sách.'); return; }
      setBase(current);
      setConfirmed(false);
      setConflict(false);
      setError(current.active ? '' : 'Chính sách đã ngừng áp dụng.');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không tải được phiên bản mới.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const selectedSizes = kind === 'ECDSA' ? [256, 384, 521] : [128, 192, 256];
  const nextVersion = (base?.latest?.version ?? 0) + 1;
  return <>
    <PolicyDialog title={policy ? 'Tạo phiên bản · ' + policy.name : 'Tạo chính sách'} busy={busy} onClose={requestClose}>
      <form onSubmit={submit} aria-label={policy ? 'Tạo phiên bản chính sách' : 'Tạo chính sách'}>
        <fieldset className="mutation-fields" disabled={busy || operation?.phase === 'pending'}>
          {!policy && <>
            <label className="form-field"><span>Mã chính sách</span><input required pattern="[A-Z0-9_\-]+" maxLength={50} value={code} onChange={event => setCode(event.target.value.toUpperCase())}/></label>
            <label className="form-field"><span>Tên chính sách</span><input required maxLength={255} value={name} onChange={event => setName(event.target.value)}/></label>
          </>}
          {policy && <p>Phiên bản sẽ phát hành <strong>v{nextVersion}</strong></p>}
          <label className="form-field"><span>Loại cấu hình</span><select value={kind} onChange={event => {
            const next = event.target.value as PolicyKind;
            setKind(next);
            setBits(next === 'RSA' ? '2048' : '256');
          }}>{kinds.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label className="form-field"><span>Thời hạn tối đa (ngày)</span><input type="number" required min={1} max={3650} value={days} onChange={event => setDays(event.target.value)}/></label>
          {kind === 'RSA' && <label className="form-field"><span>Độ dài khóa tối thiểu (bit)</span><input type="number" required min={2048} max={16384} value={bits} onChange={event => setBits(event.target.value)}/></label>}
          {(kind === 'ECDSA' || kind === 'AES') && <label className="form-field"><span>Độ dài khóa tối thiểu (bit)</span><select value={bits} onChange={event => setBits(event.target.value)}>{selectedSizes.map(size => <option key={size}>{size}</option>)}</select></label>}
          <label className="form-field"><span>Cảnh báo trước hạn (ngày, cách nhau bằng dấu phẩy)</span><input value={warnings} onChange={event => setWarnings(event.target.value)}/></label>
          <div className="inline-alert"><p>Áp dụng ngay khi phát hành. Yêu cầu đã gửi và tài sản đã cấp giữ phiên bản đã gắn.</p></div>
          <label className="policy-confirm"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/> Tôi xác nhận phát hành phiên bản này.</label>
          <MutationGuardNotice operationKey={operationKey}/>
          {error && <div className="login-error" role="alert">{error}
            {conflict && <><p>Nội dung đã nhập được giữ lại. Kiểm tra phiên bản mới trước khi xác nhận lại.</p>
              <button type="button" className="text-button" onClick={() => void reloadVersion()}>Kiểm tra phiên bản mới</button></>}
          </div>}
          <footer><button type="button" className="quiet-button" onClick={requestClose}>Hủy</button>
            <button className="primary-button" disabled={disabled || busy || !!operation || conflict || base?.active === false || (!policy && !name.trim())}>{busy ? 'Đang lưu…' : 'Phát hành phiên bản'}</button></footer>
        </fieldset>
      </form>
    </PolicyDialog>
    <UnsavedChangesDialog open={discard || blocker.state === 'blocked'} onStay={() => {
      setDiscard(false);
      if (blocker.state === 'blocked') blocker.reset();
    }} onDiscard={() => { if (blocker.state === 'blocked') blocker.proceed(); else onClose(); }}/>
  </>;
}

function PolicyHistory({ policy, onClose }: { policy: AdminPolicy; onClose: () => void }) {
  const history = useResource('policy-history:' + policy.id, signal => api.policyHistory(policy.id, signal));
  return <PolicyDialog title={'Lịch sử · ' + policy.name} onClose={onClose}>
    <div className="policy-history">
      <p>Chọn hai phiên bản để so sánh cấu hình đã phát hành.</p>
      <ResourceRegion resource={history} label="Lịch sử chính sách">{versions => versions.length
        ? <PolicyComparison versions={versions}/>
        : <p>Chưa có phiên bản nào.</p>}</ResourceRegion>
    </div>
    <footer><button className="secondary-button" onClick={onClose}>Đóng</button></footer>
  </PolicyDialog>;
}

function PolicyComparison({ versions }: { versions: PolicyVersion[] }) {
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const older = versions.find(version => version.version === from) ?? versions[1] ?? versions[0];
  const newer = versions.find(version => version.version === to) ?? versions[0];
  const rows: [string, (version: PolicyVersion) => string][] = [
    ['Thuật toán / hồ sơ', version => [version.configuration.algorithm, version.configuration.certificate_profile].filter(Boolean).join(' / ') || '—'],
    ['Độ dài khóa tối thiểu', version => String(version.configuration.minimum_key_size ?? '—')],
    ['Thời hạn tối đa', version => version.configuration.maximum_validity_days ? String(version.configuration.maximum_validity_days) + ' ngày' : '—'],
    ['Mốc cảnh báo', version => Array.isArray(version.configuration.warning_days) ? version.configuration.warning_days.join(', ') || 'Không đặt' : '—'],
    ['Bắt đầu hiệu lực', version => dateLabel(version.effectiveFrom)],
  ];
  return <>
    <div className="form-row">
      <label className="form-field"><span>Phiên bản gốc</span><select value={older.version} onChange={event => setFrom(Number(event.target.value))}>{versions.map(version => <option key={version.id} value={version.version}>v{version.version}</option>)}</select></label>
      <label className="form-field"><span>So với</span><select value={newer.version} onChange={event => setTo(Number(event.target.value))}>{versions.map(version => <option key={version.id} value={version.version}>v{version.version}</option>)}</select></label>
    </div>
    <div className="table-scroll"><table className="policy-comparison">
      <thead><tr><th scope="col">Cấu hình</th><th scope="col">v{older.version}</th><th scope="col">v{newer.version}</th></tr></thead>
      <tbody>{rows.map(([label, read]) => <tr key={label}><th scope="row">{label}</th><td>{read(older)}</td><td>{read(newer)}</td></tr>)}</tbody>
    </table></div>
  </>;
}

function PolicyStop({ policy, disabled, onClose }: { policy: AdminPolicy; disabled: boolean; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const operationKey = 'policy:' + policy.id;
  const operation = useMutationGuard(operationKey);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled || conflict || operation) return;
    setBusy(true);
    setError('');
    try {
      await api.deactivatePolicy(policy.id, policy.latest?.version ?? 0);
      onClose();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể ngừng áp dụng.');
      if (reason instanceof ApiError && reason.code === 'VERSION_CONFLICT') setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  return <PolicyDialog title={'Ngừng áp dụng ' + policy.name + '?'} busy={busy} onClose={onClose}>
    <form onSubmit={submit}>
      <fieldset className="mutation-fields" disabled={busy || operation?.phase === 'pending'}>
        <div className="inline-alert"><p>Chính sách sẽ ngừng tiếp nhận yêu cầu cấp mới và gia hạn. Bạn vẫn có thể thu hồi tài sản đã cấp.</p></div>
        <p>Yêu cầu đã gửi tiếp tục theo phiên bản đã gắn. Tài sản hiện có, lịch sử và cảnh báo hết hạn vẫn được giữ.</p>
        <MutationGuardNotice operationKey={operationKey}/>
        {error && <div className="login-error" role="alert">{error}{conflict && <p>Đóng hộp thoại và làm mới danh sách trước khi xác nhận lại.</p>}</div>}
        <footer><button type="button" className="quiet-button" onClick={onClose}>Hủy</button>
          <button className="danger-button" disabled={disabled || busy || conflict || !!operation}>Xác nhận ngừng áp dụng</button></footer>
      </fieldset>
    </form>
  </PolicyDialog>;
}
