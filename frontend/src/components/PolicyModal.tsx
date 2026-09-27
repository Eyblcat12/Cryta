import React, { useRef, useState } from 'react';
import { Settings, X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { PolicyOption } from './RequestModal';
import { useDialogBehavior } from './useDialogBehavior';

export function PolicyModal({
  existingPolicies,
  onClose,
  onSuccess,
}: {
  existingPolicies: PolicyOption[];
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<'NEW_POLICY' | 'NEW_VERSION'>('NEW_POLICY');
  const [selectedPolicyId, setSelectedPolicyId] = useState(existingPolicies[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [algorithm, setAlgorithm] = useState('RSA');
  const [minKeySize, setMinKeySize] = useState(2048);
  const [maxValidityDays, setMaxValidityDays] = useState(365);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDialogBehavior(dialogRef, closeRef, onClose);

  const selectedPolicy = existingPolicies.find((p) => p.id === selectedPolicyId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const configuration: Record<string, unknown> = {
        algorithm,
        minimum_key_size: Number(minKeySize),
        maximum_validity_days: Number(maxValidityDays),
        warning_days: [30, 7, 1],
      };

      if (mode === 'NEW_POLICY') {
        if (!code.trim() || !name.trim()) {
          setError('Vui lòng nhập mã và tên chính sách.');
          setBusy(false);
          return;
        }
        await api.createPolicy({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          configuration,
        });
      } else {
        if (!selectedPolicyId) {
          setError('Vui lòng chọn chính sách cần nâng cấp phiên bản.');
          setBusy(false);
          return;
        }
        await api.createPolicyVersion(selectedPolicyId, configuration);
      }
      await onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể lưu chính sách.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng modal chính sách" />
      <section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="policy-modal-title">
        <header>
          <div>
            <p className="eyebrow">Quản trị chính sách mật mã</p>
            <h2 id="policy-modal-title">{mode === 'NEW_POLICY' ? 'Ban hành chính sách mới' : 'Nâng cấp phiên bản chính sách'}</h2>
            <span>Chính sách mới sẽ áp dụng cho tất cả các yêu cầu cấp phát tiếp theo.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <form onSubmit={submit} noValidate>
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
            <button
              type="button"
              className={mode === 'NEW_POLICY' ? 'primary-button' : 'quiet-button'}
              onClick={() => setMode('NEW_POLICY')}
            >
              Tạo chính sách mới
            </button>
            <button
              type="button"
              className={mode === 'NEW_VERSION' ? 'primary-button' : 'quiet-button'}
              onClick={() => setMode('NEW_VERSION')}
              disabled={!existingPolicies.length}
            >
              Nâng cấp phiên bản (v+1)
            </button>
          </div>

          {mode === 'NEW_POLICY' ? (
            <div className="form-row">
              <label className="form-field">
                <span>Mã chính sách (VD: RSA_STRICT) <em>*</em></span>
                <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="RSA_STRICT" required />
              </label>
              <label className="form-field">
                <span>Tên chính sách <em>*</em></span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tiêu chuẩn RSA bảo mật cao" required />
              </label>
            </div>
          ) : (
            <label className="form-field">
              <span>Chọn chính sách cần nâng cấp <em>*</em></span>
              <select value={selectedPolicyId} onChange={(e) => setSelectedPolicyId(e.target.value)}>
                {existingPolicies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.code}) — hiện tại: v{p.version}
                  </option>
                ))}
              </select>
              {selectedPolicy && (
                <small>Phiên bản tiếp theo sẽ tự động là v{selectedPolicy.version + 1}.</small>
              )}
            </label>
          )}

          <div className="form-row">
            <label className="form-field">
              <span>Thuật toán</span>
              <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
                <option value="RSA">RSA</option>
                <option value="ECDSA">ECDSA</option>
                <option value="ED25519">ED25519</option>
                <option value="AES">AES</option>
              </select>
            </label>
            <label className="form-field">
              <span>Độ dài khóa tối thiểu (bit)</span>
              <select value={minKeySize} onChange={(e) => setMinKeySize(Number(e.target.value))}>
                <option value={1024}>1024 bit (Cảnh báo cũ)</option>
                <option value={2048}>2048 bit (Khuyên dùng)</option>
                <option value={3072}>3072 bit (Bảo mật cao)</option>
                <option value={4096}>4096 bit (Tối đa)</option>
              </select>
            </label>
          </div>

          <label className="form-field">
            <span>Thời hạn tối đa (ngày)</span>
            <input
              type="number"
              value={maxValidityDays}
              onChange={(e) => setMaxValidityDays(Number(e.target.value))}
              min={30}
              max={3650}
              required
            />
          </label>

          {error && <div className="login-error" role="alert">{error}</div>}

          <footer>
            <button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Hủy</button>
            <button type="submit" className="primary-button" disabled={busy}>
              <Settings size={16} />
              {busy ? 'Đang lưu…' : mode === 'NEW_POLICY' ? 'Tạo chính sách' : 'Ban hành phiên bản mới'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
