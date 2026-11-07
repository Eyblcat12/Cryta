import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { api, ApiError } from './api';
import type { MfaChallenge } from './api/contracts/mfa';
import type { AuthUser } from './types';

const MfaFlow = lazy(() => import('./MfaScreen').then(module => ({ default: module.MfaFlow })));

export function LoginScreen({ onLogin, notice }: { onLogin: (user: AuthUser) => void; notice?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const pending = useRef(false);

  useEffect(() => { if (!mfa) document.title = 'Đăng nhập · Crypta'; }, [mfa]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setError('');
    setBusy(true);
    try {
      const result = await api.login(email, password);
      setPassword('');
      if ('mfa' in result) setMfa(result);
      else onLogin(result);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Không thể đăng nhập.');
    } finally { pending.current = false; setBusy(false); }
  }

  if (mfa) return <Suspense fallback={<main className="session-loading" role="status">Đang tải xác thực hai bước…</main>}>
    <MfaFlow initial={mfa} onCancel={() => setMfa(null)} onAuthenticated={onLogin}/>
  </Suspense>;
  return <main className="login-page"><section className="login-card" aria-labelledby="login-title">
    <div className="login-brand"><span className="brand-mark"><ShieldCheck size={24}/></span><span><strong>Crypta</strong><small>Quản lý tài sản mật mã</small></span></div>
    <div className="login-heading"><span className="login-icon"><KeyRound size={24}/></span><h1 id="login-title">Chào mừng trở lại</h1><p>Đăng nhập bằng tài khoản tổ chức để tiếp tục.</p></div>
    {notice && <div className="inline-alert" role="status"><CheckCircle2 size={18}/><div><strong>Thông tin phiên đăng nhập</strong><p>{notice}</p></div></div>}
    <form onSubmit={submit}>
      <label className="form-field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required autoFocus placeholder="ten@congty.com"/></label>
      <label className="form-field"><span>Mật khẩu</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8}/></label>
      {error && <div className="login-error" role="alert">{error}</div>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? 'Đang xác thực…' : <>Đăng nhập <ArrowRight size={17}/></>}</button>
    </form>
    <Link className="text-button account-login-link" to="/account/forgot-password">Quên mật khẩu?</Link>
    <p className="login-security"><ShieldCheck size={15}/> Phiên đăng nhập dùng cookie HttpOnly và refresh token xoay vòng.</p>
  </section></main>;
}
