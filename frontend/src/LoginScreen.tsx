import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api, ApiError } from './api';
import type { MfaChallenge } from './api/contracts/mfa';
import type { AuthUser } from './types';

const MfaFlow = lazy(() => import('./MfaScreen').then(module => ({ default: module.MfaFlow })));

export function LoginScreen({ onLogin, notice }: { onLogin: (user: AuthUser) => void; notice?: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [oidcOutcome] = useState(() => new URLSearchParams(location.search).get('oidc'));
  const [oidcEnabled, setOidcEnabled] = useState(oidcOutcome === 'complete' || oidcOutcome === 'denied');
  const [local, setLocal] = useState(false);
  const [finishing, setFinishing] = useState(oidcOutcome === 'complete');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(oidcOutcome === 'denied' ? 'Không thể xác minh đăng nhập SSO. Hãy thử lại hoặc liên hệ quản trị viên.' : '');
  const [mfa, setMfa] = useState<MfaChallenge | null>(null);
  const pending = useRef(false);
  const consumedCallback = useRef(false);

  useEffect(() => { if (!mfa) document.title = 'Đăng nhập · Crypta'; }, [mfa]);
  useEffect(() => {
    const controller = new AbortController();
    void api.oidcStatus(controller.signal).then(status => setOidcEnabled(status.enabled)).catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (consumedCallback.current || (oidcOutcome !== 'complete' && oidcOutcome !== 'denied')) return;
    consumedCallback.current = true;
    navigate('/login', { replace: true, state: location.state });
    if (oidcOutcome === 'complete') {
      void api.finishOidc().then(result => {
        if ('mfa' in result) setMfa(result);
        else onLogin(result);
      }).catch(reason => setError(reason instanceof ApiError ? reason.message : 'Không thể hoàn tất đăng nhập SSO.'))
        .finally(() => setFinishing(false));
    }
  }, [oidcOutcome, location.state, navigate, onLogin]);

  async function startSso() {
    if (pending.current) return;
    pending.current = true;
    setError('');
    setBusy(true);
    try {
      const { redirect } = await api.startOidc();
      window.location.assign(redirect);
    } catch {
      setError('SSO tạm thời không khả dụng. Hãy thử lại hoặc dùng tài khoản cục bộ nếu bạn có quyền.');
      pending.current = false;
      setBusy(false);
    }
  }

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
    <div className="login-heading"><span className="login-icon"><KeyRound size={24}/></span><h1 id="login-title">{oidcEnabled && local ? 'Đăng nhập bằng mật khẩu Crypta' : 'Chào mừng trở lại'}</h1>
      <p>{oidcEnabled && local ? 'Dùng tài khoản cục bộ đã được cấp quyền, gồm tài khoản quản trị khẩn cấp.' : 'Đăng nhập bằng tài khoản tổ chức để tiếp tục.'}</p></div>
    {notice && <div className="inline-alert" role="status"><CheckCircle2 size={18}/><div><strong>Thông tin phiên đăng nhập</strong><p>{notice}</p></div></div>}
    {finishing ? <div role="status" className="login-sso-status">Đang xác minh phiên SSO…</div> : oidcEnabled && !local ? <>
      {error && <div className="login-error" role="alert">{error}</div>}
      <button type="button" className="primary-button login-submit" disabled={busy} onClick={() => void startSso()}>
        {busy ? 'Đang kết nối Keycloak…' : <>Đăng nhập bằng SSO <ArrowRight size={17}/></>}
      </button>
      <button type="button" className="text-button account-login-link" disabled={busy} onClick={() => { setLocal(true); setError(''); }}>Dùng tài khoản cục bộ</button>
    </> : <><form onSubmit={submit}>
      <label className="form-field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required autoFocus placeholder="ten@congty.com"/></label>
      <label className="form-field"><span>Mật khẩu</span><input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required minLength={8}/></label>
      {error && <div className="login-error" role="alert">{error}</div>}
      <button className="primary-button login-submit" disabled={busy}>{busy ? 'Đang xác thực…' : <>Đăng nhập <ArrowRight size={17}/></>}</button>
    </form>
      <div className="login-account-links">
        <Link className="text-button account-login-link" to="/account/forgot-password">Quên mật khẩu?</Link>
        {oidcEnabled && <button type="button" className="text-button account-login-link" disabled={busy} onClick={() => { setLocal(false); setError(''); setPassword(''); }}>Quay lại SSO</button>}
      </div>
    </>}
    <p className="login-security"><ShieldCheck size={15}/> Phiên đăng nhập dùng cookie HttpOnly và refresh token xoay vòng.</p>
  </section></main>;
}
