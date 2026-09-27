import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Plus, RotateCw, ShieldAlert, ShieldCheck, X, XCircle } from 'lucide-react';
import { ApiError } from '../api';
import type { Asset } from '../types';
import { useDialogBehavior } from './useDialogBehavior';

export type RequestType = 'CREATE' | 'RENEW' | 'REVOKE';
export type PolicyOption = { id: string; code: string; name: string; version: number; configuration: Record<string, unknown> };

export function RequestModal({
  assets,
  policies,
  initialType,
  initialAssetId,
  onClose,
  onSuccess,
}: {
  assets: Asset[];
  policies: PolicyOption[];
  initialType: RequestType;
  initialAssetId?: string;
  onClose: () => void;
  onSuccess: (type: RequestType, body: unknown) => Promise<void>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [type, setType] = useState<RequestType>(initialType);
  const [assetId, setAssetId] = useState(initialAssetId ?? '');
  const [reason, setReason] = useState('');
  const [policyVersionId, setPolicyVersionId] = useState(policies[0]?.id ?? '');
  const [assetType, setAssetType] = useState<'KEY' | 'CERTIFICATE'>('KEY');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const reasonInvalid = submitted && reason.trim().length < 5;
  const assetInvalid = submitted && type !== 'CREATE' && !assetId;
  const selected = assets.find((asset) => asset.id === assetId);

  useDialogBehavior(dialogRef, closeRef, onClose);
  const compatiblePolicies = policies.filter((policy) => assetType === 'CERTIFICATE' || !policy.configuration?.certificate_profile);

  useEffect(() => {
    if (type === 'CREATE' && !compatiblePolicies.some((item) => item.id === policyVersionId)) {
      setPolicyVersionId(compatiblePolicies[0]?.id ?? '');
    }
  }, [assetType, type, policies]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (reason.trim().length < 5 || (type !== 'CREATE' && !assetId)) return;
    if (type === 'REVOKE' && !confirmRevoke) {
      setConfirmRevoke(true);
      return;
    }
    const effectivePolicyVersionId = type === 'CREATE' ? policyVersionId : selected?.policyVersionId;
    if (!effectivePolicyVersionId) {
      setSubmitError('Không xác định được chính sách hiệu lực cho tài sản.');
      return;
    }
    setBusy(true);
    setSubmitError('');
    try {
      await onSuccess(type, {
        type,
        targetAssetId: type === 'CREATE' ? undefined : assetId,
        policyVersionId: effectivePolicyVersionId,
        reason,
        emergency: type === 'REVOKE',
        parameters: type === 'CREATE' ? { assetType } : {},
      });
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Không thể gửi yêu cầu. Hãy thử lại.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng biểu mẫu" />
      <section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="request-modal-title">
        <header>
          <div>
            <p className="eyebrow">Yêu cầu mới</p>
            <h2 id="request-modal-title">Bạn muốn thực hiện tác vụ nào?</h2>
            <span>Yêu cầu sẽ được chuyển đến người phê duyệt đúng phạm vi.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <form onSubmit={submit} noValidate>
          {confirmRevoke ? (
            <div className="confirmation-panel" role="alert">
              <span className="confirmation-icon"><ShieldAlert size={24} /></span>
              <div>
                <p className="eyebrow">Xác nhận cuối cùng</p>
                <h3>Thu hồi {selected?.name}</h3>
                <p>Tài sản sẽ ngừng hiệu lực và <strong>không thể chuyển lại trạng thái hoạt động</strong>. Yêu cầu được ưu tiên tới người phê duyệt CNTT và toàn bộ quyết định sẽ được ghi Audit Log.</p>
              </div>
            </div>
          ) : (
            <>
              <fieldset className="request-types">
                <legend>Loại yêu cầu</legend>
                {([
                  ['CREATE', 'Cấp phát mới', 'Tạo khóa hoặc chứng thư mới', Plus],
                  ['RENEW', 'Gia hạn', 'Thay thế tài sản sắp hết hạn', RotateCw],
                  ['REVOKE', 'Thu hồi', 'Ngừng hiệu lực một tài sản', XCircle],
                ] as const).map(([value, title, description, Icon]) => (
                  <label className={type === value ? 'selected' : ''} key={value}>
                    <input
                      type="radio"
                      name="type"
                      value={value}
                      checked={type === value}
                      onChange={() => { setType(value); setSubmitted(false); setConfirmRevoke(false); if (value === 'CREATE') setAssetId(''); }}
                    />
                    <span className="request-type-icon"><Icon size={19} /></span>
                    <span><strong>{title}</strong><small>{description}</small></span>
                    <span className="radio-mark"><Check size={13} /></span>
                  </label>
                ))}
              </fieldset>
              {type !== 'CREATE' && (
                <label className={`form-field ${assetInvalid ? 'field-error' : ''}`}>
                  <span>Tài sản <em>*</em></span>
                  <select value={assetId} onChange={(event) => setAssetId(event.target.value)} required aria-invalid={assetInvalid} aria-describedby="asset-help">
                    <option value="" disabled>Chọn tài sản của bạn</option>
                    {assets.filter((asset) => asset.status === 'ACTIVE' || asset.status === 'EXPIRING_SOON').map((asset) => (
                      <option value={asset.id} key={asset.id}>{asset.code} · {asset.name}</option>
                    ))}
                  </select>
                  <small id="asset-help">{assetInvalid ? 'Hãy chọn tài sản cần xử lý.' : 'Chỉ tài sản đang hoạt động hoặc sắp hết hạn được phép chọn.'}</small>
                </label>
              )}
              {type === 'CREATE' && (
                <div className="form-row">
                  <label className="form-field">
                    <span>Loại tài sản <em>*</em></span>
                    <select value={assetType} onChange={(e) => setAssetType(e.target.value as 'KEY' | 'CERTIFICATE')}>
                      <option value="KEY">Khóa mã hóa</option>
                      <option value="CERTIFICATE">Chứng thư số</option>
                    </select>
                  </label>
                  <label className="form-field">
                    <span>Chính sách</span>
                    <select value={policyVersionId} onChange={(e) => setPolicyVersionId(e.target.value)}>
                      {compatiblePolicies.map((policy) => (
                        <option value={policy.id} key={policy.id}>{policy.name} v{policy.version}</option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
              <label className={`form-field ${reasonInvalid ? 'field-error' : ''}`}>
                <span>Lý do nghiệp vụ <em>*</em></span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Mô tả mục đích sử dụng và phạm vi cần thiết…"
                  aria-invalid={reasonInvalid}
                  aria-describedby="reason-help"
                />
                <small id="reason-help">{reasonInvalid ? 'Vui lòng nhập lý do để người duyệt có đủ thông tin.' : 'Không nhập private key, mật khẩu hoặc dữ liệu bí mật.'}</small>
              </label>
              {type === 'REVOKE' ? (
                <div className="inline-alert inline-alert-danger">
                  <ShieldAlert size={19} />
                  <div><strong>Hành động không thể hoàn tác</strong><p>Tài sản đã thu hồi không thể chuyển lại Active. Bạn sẽ xác nhận hậu quả ở bước tiếp theo.</p></div>
                </div>
              ) : (
                <div className="policy-preview">
                  <ShieldCheck size={19} />
                  <div><strong>Kiểm tra chính sách tự động</strong><p>Thông số sẽ được kiểm tra trước khi yêu cầu được gửi. Người tạo không thể tự phê duyệt.</p></div>
                </div>
              )}
            </>
          )}
          {submitError && <div className="login-error" role="alert">{submitError}</div>}
          <footer>
            {confirmRevoke ? (
              <>
                <button type="button" className="quiet-button" disabled={busy} onClick={() => setConfirmRevoke(false)}>Quay lại kiểm tra</button>
                <button type="submit" disabled={busy} className="danger-button">{busy ? 'Đang gửi…' : 'Xác nhận thu hồi'} <ShieldAlert size={17} /></button>
              </>
            ) : (
              <>
                <button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Hủy</button>
                <button type="submit" disabled={busy} className={type === 'REVOKE' ? 'danger-button' : 'primary-button'}>
                  {busy ? 'Đang gửi…' : type === 'REVOKE' ? 'Tiếp tục thu hồi' : 'Gửi yêu cầu'} <ArrowRight size={17} />
                </button>
              </>
            )}
          </footer>
        </form>
      </section>
    </div>
  );
}
