import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from './api';
import { useResource } from './useResource';

type Mode = 'request' | 'reset' | 'invitation';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const resetPath = '/account/forgot-password';
let emailLink: { path: string; token: string } | undefined;

function takeAccountActionLink() {
  const { pathname, hash, search } = window.location;
  const path = pathname.replace(/\/+$/, '');
  if (path !== '/account/activate' && path !== '/account/reset-password') return;
  const token = new URLSearchParams(hash.slice(1)).get('token');
  if (hash || search || path !== pathname) window.history.replaceState(window.history.state, '', path);
  return { path, token: token && tokenPattern.test(token) ? token : '' };
}

export function captureAccountActionLink() {
  emailLink = takeAccountActionLink();
}

export function AccountActionScreen({ mode }: { mode: Mode }) {
  const path = mode === 'invitation' ? '/account/activate' : '/account/reset-password';
  const [token, setToken] = useState(() => emailLink?.path === path ? emailLink.token : '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [invalidLink, setInvalidLink] = useState(mode !== 'request' && !token);
  const pending = useRef(false);
  const submission = useRef<AbortController>();
  const heading = useRef<HTMLHeadingElement>(null);
  const available = useResource('account-actions-public', api.accountActionAvailability);
  const title = done ? mode === 'request' ? 'Kiểm tra hộp thư' : 'Mật khẩu đã được lưu'
    : invalidLink ? 'Liên kết không còn hiệu lực'
    : mode === 'request' ? 'Quên mật khẩu?' : mode === 'invitation' ? 'Kích hoạt tài khoản' : 'Đặt lại mật khẩu';

  useEffect(() => {
    document.documentElement.dataset.theme = window.localStorage.getItem('crypta-theme') === 'dark' ? 'dark' : 'light';
    return () => submission.current?.abort();
  }, []);
  useEffect(() => { document.title = `${title} · Crypta`; heading.current?.focus(); }, [title]);
  useEffect(() => { if (emailLink?.path === path) emailLink = undefined; }, [path]);
  useEffect(() => {
    if (mode === 'request') return;
    function receiveLink() {
      if (!window.location.hash || window.location.pathname.replace(/\/+$/, '') !== path) return;
      const link = takeAccountActionLink();
      if (!link) return;
      submission.current?.abort();
      submission.current = undefined;
      pending.current = false;
      setToken(link.token);
      setInvalidLink(!link.token);
      setPassword(''); setConfirmation(''); setError(''); setDone(false); setBusy(false);
    }
    window.addEventListener('hashchange', receiveLink);
    return () => window.removeEventListener('hashchange', receiveLink);
  }, [mode, path]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || !available.data?.enabled || available.error || invalidLink) return;
    setError('');
    if (mode !== 'request') {
      if (password !== confirmation) { setError('Hai ô mật khẩu phải khớp nhau.'); return; }
      if (new TextEncoder().encode(password).length > 72) { setError('Mật khẩu vượt giới hạn 72 byte. Hãy dùng mật khẩu ngắn hơn.'); return; }
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{12,64}$/u.test(password)) {
        setError('Mật khẩu cần 12–64 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.'); return;
      }
    }
    pending.current = true;
    const controller = new AbortController();
    submission.current = controller;
    setBusy(true);
    try {
      if (mode === 'request') await api.requestPasswordReset(email.trim(), controller.signal);
      else await api.completeAccountAction(mode, token, password, controller.signal);
      if (controller.signal.aborted) return;
      setPassword(''); setConfirmation(''); setToken(''); setEmail(''); setDone(true);
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiError && reason.code === 'ACCOUNT_LINK_INVALID') {
        setToken(''); setPassword(''); setConfirmation(''); setInvalidLink(true);
      } else {
        setError(reason instanceof ApiError ? reason.message : 'Không thể xác nhận kết quả. Hãy kiểm tra kết nối rồi thử lại.');
      }
    } finally {
      if (submission.current === controller) {
        submission.current = undefined;
        pending.current = false;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }

  const formAvailable = !done && !invalidLink && available.data?.enabled === true && !available.error;
  return <main className="login-page"><section className="login-card account-action-card" aria-labelledby="account-action-title">
    <div className="login-brand"><span className="brand-mark"><ShieldCheck size={24}/></span><span><strong>Crypta</strong><small>Quản lý tài sản mật mã</small></span></div>
    <div className="login-heading"><span className="login-icon"><KeyRound size={24}/></span><h1 id="account-action-title" ref={heading} tabIndex={-1}>{title}</h1></div>
    {done ? <div className="inline-alert" role="status"><p>{mode === 'request'
      ? 'Nếu email đủ điều kiện, Crypta sẽ gửi liên kết đặt lại mật khẩu. Hãy kiểm tra cả thư rác.'
      : 'Bạn có thể đăng nhập bằng mật khẩu mới.'}</p></div> : invalidLink
      ? <div className="login-error" role="alert"><p>Liên kết có thể đã hết hạn hoặc đã được sử dụng.</p>{mode === 'invitation'
        ? <p>Liên hệ quản trị viên để nhận lời mời mới.</p>
        : <><p>Nếu vừa lưu mật khẩu, hãy thử đăng nhập bằng mật khẩu mới.</p><Link to={resetPath}>Yêu cầu liên kết mới</Link></>}</div>
      : available.loading ? <p role="status">Đang kiểm tra tính năng email tài khoản…</p>
      : available.error ? <div className="login-error" role="alert">{available.error} <button type="button" className="text-button" onClick={available.retry}>Thử lại</button></div>
      : !available.data?.enabled ? <p className="login-error" role="alert">Tính năng email tài khoản chưa được bật. Hãy liên hệ quản trị viên.</p> : null}
    {formAvailable && <form onSubmit={submit} aria-busy={busy}>
      {mode === 'request' ? <label className="form-field"><span>Email công việc</span><input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} disabled={busy}/></label>
      : <><p>{mode === 'invitation' ? 'Đặt mật khẩu để sử dụng tài khoản Crypta được mời.' : 'Sau khi lưu, các phiên của tài khoản sẽ kết thúc.'}</p>
        <label className="form-field"><span>Mật khẩu mới</span><input type="password" autoComplete="new-password" required minLength={12} maxLength={64} value={password} onChange={event=>setPassword(event.target.value)} disabled={busy}/><small>Ít nhất 12 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</small></label>
        <label className="form-field"><span>Nhập lại mật khẩu</span><input type="password" autoComplete="new-password" required maxLength={64} value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={busy}/></label></>}
      {error && <div className="login-error" role="alert">{error}</div>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? 'Đang gửi…' : mode === 'request' ? 'Gửi yêu cầu' : mode === 'invitation' ? 'Kích hoạt tài khoản' : 'Lưu mật khẩu mới'}</button>
    </form>}
    <Link className="text-button account-login-link" to="/login">Về đăng nhập</Link>
  </section></main>;
}

export const ForgotPassword = () => <AccountActionScreen mode="request"/>;
export const ResetPassword = () => <AccountActionScreen mode="reset"/>;
export const AcceptInvitation = () => <AccountActionScreen mode="invitation"/>;
