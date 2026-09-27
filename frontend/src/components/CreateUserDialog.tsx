import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { api, ApiError } from '../api';
import type { UserRole } from '../types';
import { useDialogBehavior } from './useDialogBehavior';

function generateInitialPassword() {
  return 'Password@123';
}

export function CreateUserDialog({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => Promise<void>;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [scopes, setScopes] = useState<string[]>([]);
  const [password, setPassword] = useState(generateInitialPassword);
  const [showPassword, setShowPassword] = useState(false);
  const [reference, setReference] = useState<{
    departments: Array<{ id: string; code: string; name: string }>;
    roles: Array<{ code: string; name: string }>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useDialogBehavior(dialogRef, closeRef, onClose);

  useEffect(() => {
    void api.userReference()
      .then((data) => {
        setReference(data);
        setDepartmentId(data.departments[0]?.id ?? '');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Không thể tải danh mục phòng ban.'));
  }, []);

  const toggleScope = (id: string) =>
    setScopes((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (name.trim().length < 2 || !email.includes('@') || !departmentId) {
      setError('Hãy nhập đầy đủ họ tên, email và phòng ban.');
      return;
    }
    if (role === 'APPROVER' && !scopes.length) {
      setError('Approver phải được gán ít nhất một phạm vi phòng ban.');
      return;
    }
    setBusy(true);
    try {
      await api.createUser({
        displayName: name.trim(),
        email: email.trim(),
        departmentId,
        temporaryPassword: password,
        roles: [role],
        approverDepartmentIds: role === 'APPROVER' ? scopes : [],
      });
      await onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không thể tạo tài khoản.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer">
      <button className="modal-scrim" onClick={onClose} aria-label="Đóng form tạo người dùng" />
      <section ref={dialogRef} className="request-modal" role="dialog" aria-modal="true" aria-labelledby="create-user-title">
        <header>
          <div>
            <p className="eyebrow">Quản trị truy cập</p>
            <h2 id="create-user-title">Thêm người dùng</h2>
            <span>Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên.</span>
          </div>
          <button ref={closeRef} className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        </header>
        <form onSubmit={submit} noValidate>
          <div className="form-row">
            <label className="form-field">
              <span>Họ và tên <em>*</em></span>
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" />
            </label>
            <label className="form-field">
              <span>Email tổ chức <em>*</em></span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" />
            </label>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span>Phòng ban <em>*</em></span>
              <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} disabled={!reference}>
                {reference?.departments.map((item) => (
                  <option value={item.id} key={item.id}>{item.name} ({item.code})</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Vai trò chính <em>*</em></span>
              <select value={role} onChange={(event) => { setRole(event.target.value as UserRole); setScopes([]); }}>
                <option value="USER">Nhân viên</option>
                <option value="APPROVER">Người phê duyệt</option>
                <option value="ADMIN">Security Admin</option>
              </select>
            </label>
          </div>
          {role === 'APPROVER' && (
            <fieldset className="scope-options">
              <legend>Phạm vi phê duyệt <em>*</em></legend>
              {reference?.departments.map((item) => (
                <label key={item.id}>
                  <input type="checkbox" checked={scopes.includes(item.id)} onChange={() => toggleScope(item.id)} />
                  <span>{item.name}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="form-field">
            <span>Mật khẩu ban đầu <em>*</em></span>
            <div className="password-input-row">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
              <button type="button" className="quiet-button" onClick={() => setShowPassword((value) => !value)}>
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>
              <button type="button" className="quiet-button" onClick={() => setPassword(generateInitialPassword())}>
                Mặc định
              </button>
            </div>
            <small>Mật khẩu tạm thời cho người dùng đăng nhập lần đầu.</small>
          </div>
          {error && <div className="login-error" role="alert">{error}</div>}
          <footer>
            <button type="button" className="quiet-button" disabled={busy} onClick={onClose}>Hủy</button>
            <button className="primary-button" disabled={busy || !reference}>
              {busy ? 'Đang tạo…' : 'Tạo tài khoản'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
