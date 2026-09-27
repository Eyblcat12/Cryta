import React, { useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { ApiError } from '../api';
import { useDialogBehavior } from './useDialogBehavior';

export function PasswordChangeDialog({
  onLogout,
  onSuccess,
}: {
  onLogout: () => Promise<void>;
  onSuccess: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDialogBehavior(dialogRef, currentRef, () => {});

  // Relaxed requirement for easy testing: at least 6 characters and matching confirmation
  const valid = newPassword.length >= 6 && newPassword === confirm;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!valid) {
      setError('Mật khẩu mới cần ít nhất 6 ký tự và hai ô phải khớp nhau.');
      return;
    }
    setBusy(true);
    try {
      await onSuccess(currentPassword, newPassword);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể đổi mật khẩu.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer">
      <div className="modal-scrim" />
      <section ref={dialogRef} className="decision-dialog" role="dialog" aria-modal="true" aria-labelledby="password-title">
        <header>
          <div>
            <p className="eyebrow">Bảo vệ tài khoản</p>
            <h2 id="password-title">Đổi mật khẩu ban đầu</h2>
            <span>Bạn cần đặt mật khẩu riêng trước khi tiếp tục sử dụng Crypta.</span>
          </div>
          <ShieldCheck size={22} />
        </header>
        <form onSubmit={submit} noValidate>
          <label className="form-field">
            <span>Mật khẩu hiện tại</span>
            <input
              ref={currentRef}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </label>
          <label className="form-field">
            <span>Mật khẩu mới</span>
            <input
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              minLength={6}
            />
            <small>Ít nhất 6 ký tự (đã được nới lỏng cho môi trường test).</small>
          </label>
          <label className="form-field">
            <span>Nhập lại mật khẩu mới</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer>
            <button type="button" className="quiet-button" disabled={busy} onClick={() => void onLogout()}>
              Đăng xuất
            </button>
            <button className="primary-button" disabled={busy || !currentPassword}>
              {busy ? 'Đang cập nhật…' : 'Đổi mật khẩu'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
