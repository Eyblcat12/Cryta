import React, { useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useDialogBehavior } from './useDialogBehavior';

export function TestEmailDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (email: string) => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogBehavior(dialogRef, closeRef, onClose);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.testEmail(email.trim());
      onSuccess(email.trim());
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể gửi email kiểm tra.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="presentation">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng gửi email kiểm tra" />
      <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="test-email-title">
        <header>
          <div>
            <p className="eyebrow">Xác minh SMTP</p>
            <h2 id="test-email-title">Gửi email kiểm tra</h2>
            <span>Thư được gửi trực tiếp qua cấu hình SMTP hiện tại.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <form onSubmit={submit}>
          <label className="form-field">
            <span>Email nhận <em>*</em></span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admin@congty.com"
              required
              autoFocus
            />
            <small>Chỉ dùng địa chỉ bạn có quyền kiểm tra hộp thư.</small>
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer>
            <button type="button" className="quiet-button" onClick={onClose} disabled={busy}>Hủy</button>
            <button className="primary-button" disabled={busy}>
              <Send size={16} />
              {busy ? 'Đang gửi…' : 'Gửi email thử'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
