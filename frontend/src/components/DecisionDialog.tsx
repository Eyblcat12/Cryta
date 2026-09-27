import React, { useRef, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { ApiError } from '../api';
import { useDialogBehavior } from './useDialogBehavior';

export function DecisionDialog({
  action,
  requestId,
  onClose,
  onSuccess,
}: {
  action: 'APPROVE' | 'REJECT';
  requestId: string;
  onClose: () => void;
  onSuccess: (action: 'APPROVE' | 'REJECT', requestId: string, note: string) => Promise<void>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const invalid = action === 'REJECT' && submitted && note.trim().length < 5;

  useDialogBehavior(dialogRef, closeRef, onClose);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (action === 'REJECT' && note.trim().length < 5) return;
    setBusy(true);
    setSubmitError('');
    try {
      await onSuccess(action, requestId, note);
    } catch (error) {
      setSubmitError(error instanceof ApiError ? error.message : 'Không thể gửi quyết định.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng xác nhận" />
      <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="decision-title">
        <header>
          <div>
            <p className="eyebrow">Xác nhận quyết định</p>
            <h2 id="decision-title">{action === 'APPROVE' ? `Phê duyệt ${requestId}` : `Từ chối ${requestId}`}</h2>
            <span>Quyết định sẽ được ghi Audit Log và thông báo cho người gửi.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className={`inline-alert ${action === 'APPROVE' ? '' : 'inline-alert-danger'}`}>
            <ShieldCheck size={19} />
            <div>
              <strong>{action === 'APPROVE' ? 'Đã vượt qua kiểm tra bắt buộc' : 'Người gửi cần biết cách khắc phục'}</strong>
              <p>{action === 'APPROVE' ? 'Scope, Separation of Duties và trạng thái tài sản đều hợp lệ.' : 'Lý do từ chối phải cụ thể, không chứa dữ liệu bí mật.'}</p>
            </div>
          </div>
          <label className={`form-field ${invalid ? 'field-error' : ''}`}>
            <span>Ghi chú quyết định {action === 'REJECT' && <em>*</em>}</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={action === 'APPROVE' ? 'Ghi chú tùy chọn cho người gửi…' : 'Nêu rõ lý do và cách sửa yêu cầu…'}
              aria-invalid={invalid}
              aria-describedby="decision-help"
            />
            <small id="decision-help">{invalid ? 'Vui lòng nhập lý do từ chối.' : 'Không nhập private key, token hoặc dữ liệu bí mật.'}</small>
          </label>
          {submitError && <div className="login-error" role="alert">{submitError}</div>}
          <footer>
            <button type="button" disabled={busy} className="quiet-button" onClick={onClose}>Hủy</button>
            <button type="submit" disabled={busy} className={action === 'APPROVE' ? 'primary-button' : 'danger-button'}>
              {busy ? 'Đang gửi…' : action === 'APPROVE' ? 'Xác nhận phê duyệt' : 'Xác nhận từ chối'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
