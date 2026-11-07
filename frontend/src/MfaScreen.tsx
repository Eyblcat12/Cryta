import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from './api';
import type { MfaChallenge, MfaStepUp } from './api/contracts/mfa';
import type { AuthUser } from './types';
import { useResource } from './useResource';
import { PageHeader } from './WorkspaceUi';

function message(error: unknown) {
  return error instanceof ApiError ? error.message : 'Không thể xác nhận thao tác. Kiểm tra kết nối rồi thử lại.';
}

function useMfaTask() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(operation: () => Promise<void>, onError?: (reason: unknown) => boolean) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try { await operation(); }
    catch (reason) { if (!onError?.(reason)) setError(message(reason)); }
    finally { pending.current = false; setBusy(false); }
  }
  return { busy, error, setError, run };
}

function MfaFrame({ title, eyebrow, embedded, children }: { title: string; eyebrow?: string; embedded?: boolean; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!embedded) document.title = `${title} · Crypta`;
    heading.current?.focus({ preventScroll: true });
  }, [title, embedded]);
  const card = <section className="login-card mfa-card" aria-labelledby="mfa-title">
    {!embedded && <div className="login-brand"><span className="brand-mark"><ShieldCheck size={24} aria-hidden="true"/></span>
      <span><strong>Crypta</strong><small>Quản lý tài sản mật mã</small></span></div>}
    <div className="mfa-heading">
      {eyebrow && <small>{eyebrow}</small>}
      {embedded ? <h2 id="mfa-title" ref={heading} tabIndex={-1}>{title}</h2>
        : <h1 id="mfa-title" ref={heading} tabIndex={-1}>{title}</h1>}
    </div>
    {children}
  </section>;
  return embedded ? card : <main className="login-page mfa-page">{card}</main>;
}

function EnrollmentKey({ manualKey, uri }: { manualKey: string; uri: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [qrReady, setQrReady] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    let active = true;
    setQrReady(false);
    setCopyStatus('');
    void import('qrcode').then(async ({ toCanvas }) => {
      if (!active || !canvas.current) return;
      await toCanvas(canvas.current, uri, { errorCorrectionLevel: 'M', margin: 4, scale: 5 });
      if (active) setQrReady(true);
    }).catch(() => { if (active) setQrReady(false); });
    return () => { active = false; };
  }, [uri]);
  return <div className="mfa-enrollment">
    <canvas ref={canvas} role="img" aria-label="Mã QR kết nối ứng dụng xác thực" hidden={!qrReady}/>
    <div>
      <strong>Quét mã trong ứng dụng xác thực</strong>
      <p>Nếu không quét được, hãy nhập khóa thiết lập bên dưới vào ứng dụng.</p>
      <code className="mfa-manual-key">{manualKey}</code>
      <button className="text-button" type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(manualKey); setCopyStatus('Đã sao chép khóa thiết lập.'); }
        catch { setCopyStatus('Hãy chọn và sao chép khóa thiết lập bên trên.'); }
      }}>Sao chép khóa thiết lập</button>
      <div className="mfa-live" role="status">{copyStatus}</div>
    </div>
  </div>;
}

function RecoveryCodes({ codes, busy, error, onDone }: { codes: string[]; busy: boolean; error: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState('');
  const content = codes.join('\n') + '\n';
  function download() {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'crypta-ma-khoi-phuc.txt';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus('Đã yêu cầu tải tệp mã khôi phục.');
  }
  return <>
    <p>Mỗi mã dùng một lần khi bạn không thể dùng ứng dụng xác thực. Bộ mã này chỉ hiển thị trong lần tạo này.</p>
    <ol className="mfa-codes" aria-label="Mười mã khôi phục">{codes.map(code => <li key={code}><code>{code}</code></li>)}</ol>
    <div className="mfa-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={download}>Tải mã khôi phục</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={async () => {
        try { await navigator.clipboard.writeText(content); setStatus('Đã sao chép bộ mã khôi phục.'); }
        catch { setStatus('Bạn có thể tải tệp mã khôi phục hoặc sao chép thủ công.'); }
      }}>Sao chép mã</button>
    </div>
    <p className="mfa-live" role="status">{status}</p>
    <label className="mfa-ack"><input type="checkbox" checked={saved} disabled={busy} onChange={event => setSaved(event.target.checked)}/>
      <span>Tôi đã lưu các mã ở nơi an toàn, có thể truy cập khi mất điện thoại.</span></label>
    {error && <div className="login-error" role="alert">{error}</div>}
    <button type="button" className="primary-button" disabled={!saved || busy} onClick={onDone}>{busy ? 'Đang hoàn tất…' : 'Hoàn tất thiết lập'}</button>
  </>;
}

export function MfaFlow({ initial, embedded, onCancel, onAuthenticated }: {
  initial: MfaChallenge; embedded?: boolean; onCancel: () => void; onAuthenticated: (user: AuthUser) => void;
}) {
  const [challenge, setChallenge] = useState(initial);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [ended, setEnded] = useState<'expired' | 'locked' | null>(null);
  const task = useMfaTask();
  const setup = challenge.mfa !== 'VERIFY';
  function cancel() { api.abandonMfa(); onCancel(); }
  function switchRecovery(value: boolean) { setRecovery(value); setCode(''); task.setError(''); }
  function onError(error: unknown) {
    if (error instanceof ApiError && ['MFA_CHALLENGE_EXPIRED','MFA_RATE_LIMITED'].includes(error.code)) {
      setEnded(error.code === 'MFA_RATE_LIMITED' ? 'locked' : 'expired');
      setCode(''); setCodes(null); api.abandonMfa();
      return true;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      setEnded('expired'); setCode(''); setCodes(null); return true;
    }
    return false;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void task.run(async () => {
      if (setup) {
        setCodes((await api.verifyMfaEnrollment(challenge.challenge, code)).recoveryCodes);
      } else if (recovery) {
        setChallenge(await api.recoverMfa(challenge.challenge, code));
        setRecovery(false);
      } else {
        onAuthenticated(await api.verifyMfa(challenge.challenge, code));
      }
      setCode('');
    }, onError);
  }
  if (ended) return <MfaFrame embedded={embedded} title={ended === 'locked' ? 'Tạm dừng xác thực' : 'Phiên xác thực đã hết hạn'}>
    <p>{ended === 'locked' ? 'Bạn đã thử nhiều lần. Hãy chờ 5 phút rồi thử lại.' : 'Hãy bắt đầu lại để nhận phiên xác thực mới.'}</p>
    <button className="primary-button" onClick={cancel}>{embedded ? 'Về bảo mật tài khoản' : 'Về trang đăng nhập'}</button>
  </MfaFrame>;
  if (codes) return <MfaFrame embedded={embedded} eyebrow="Thiết lập MFA · Bước 2 / 2" title="Lưu mã khôi phục">
    <RecoveryCodes codes={codes} busy={task.busy} error={task.error} onDone={() => void task.run(async () => {
      onAuthenticated(await api.finishMfaEnrollment(challenge.challenge));
    }, onError)}/>
    <button className="text-button" disabled={task.busy} onClick={cancel}>Hủy thiết lập</button>
  </MfaFrame>;
  return <MfaFrame embedded={embedded} eyebrow={setup ? 'Thiết lập MFA · Bước 1 / 2' : recovery ? 'Khôi phục quyền truy cập' : 'Xác thực hai bước'}
    title={setup ? challenge.mfa === 'ENROLL' ? 'Kết nối ứng dụng xác thực' : 'Kết nối ứng dụng xác thực mới'
      : recovery ? 'Sử dụng mã khôi phục' : 'Nhập mã xác thực'}>
    <p>{setup ? 'Thêm Crypta vào ứng dụng xác thực rồi nhập mã 6 số để kiểm tra kết nối.'
      : recovery ? 'Nhập một mã chưa dùng để thiết lập lại ứng dụng xác thực.' : 'Mở ứng dụng xác thực và nhập mã 6 số mới nhất.'}</p>
    {challenge.mfa !== 'VERIFY' && <EnrollmentKey {...challenge.enrollment}/>}
    <form onSubmit={submit}>
      <label className="form-field"><span>{recovery ? 'Mã khôi phục' : 'Mã xác thực 6 số'}</span>
        <input value={code} onChange={event => setCode(event.target.value)} autoComplete={recovery ? 'off' : 'one-time-code'}
          inputMode={recovery ? 'text' : 'numeric'} autoCapitalize={recovery ? 'characters' : 'off'} spellCheck={false}
          className={recovery ? undefined : 'mfa-otp'} required pattern={recovery ? undefined : '[0-9]{6}'}
          maxLength={recovery ? 80 : 6} aria-invalid={!!task.error} aria-describedby={task.error ? 'mfa-code-error' : undefined}/></label>
      {task.error && <div className="login-error" id="mfa-code-error" role="alert">{task.error}</div>}
      <button type="submit" className="primary-button" disabled={task.busy}>{task.busy ? 'Đang xác thực…'
        : setup ? 'Xác minh và tiếp tục' : recovery ? 'Xác nhận và thiết lập lại' : 'Xác minh và đăng nhập'}</button>
    </form>
    {!setup && <button className="text-button" disabled={task.busy} onClick={() => switchRecovery(!recovery)}>
      {recovery ? 'Quay lại mã ứng dụng' : 'Dùng mã khôi phục'}</button>}
    {recovery && <details><summary>Không còn mã khôi phục?</summary><p>Liên hệ quản trị viên để xác minh danh tính và được hướng dẫn khôi phục quyền truy cập.</p></details>}
    <button className="text-button" disabled={task.busy} onClick={cancel}>{embedded ? 'Hủy thay ứng dụng' : 'Về trang đăng nhập'}</button>
  </MfaFrame>;
}

export function MfaSecurityPage({ user, onAuthenticated }: { user: AuthUser; onAuthenticated: (user: AuthUser) => void }) {
  const [purpose, setPurpose] = useState<MfaStepUp | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [replacement, setReplacement] = useState<MfaChallenge | null>(null);
  const [notice, setNotice] = useState('');
  const status = useResource(`mfa:${user.id}`, api.mfaStatus, 0, user.mfaEnrolled === true);
  const task = useMfaTask();
  useEffect(() => () => api.abandonMfa(), []);
  function choose(next: MfaStepUp | null) { setPurpose(next); setPassword(''); setCode(''); task.setError(''); }
  function stepUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purpose) return;
    void task.run(async () => {
      const result = await api.stepUpMfa(password, code, purpose);
      if ('mfa' in result) setReplacement(result);
      else setCodes(result.recoveryCodes);
      choose(null);
    });
  }
  return <>
    <PageHeader eyebrow="Bảo mật tài khoản" title="Xác thực hai bước" description="Quản lý ứng dụng xác thực và phương án khôi phục tài khoản."/>
    {replacement ? <MfaFlow initial={replacement} embedded onAuthenticated={onAuthenticated} onCancel={() => setReplacement(null)}/>
      : codes ? <MfaFrame embedded title="Lưu mã khôi phục">
        <RecoveryCodes codes={codes} busy={false} error="" onDone={() => { setCodes(null); status.retry(); setNotice('Đã tạo bộ mã khôi phục mới.'); }}/>
      </MfaFrame> : purpose ? <MfaFrame embedded title={purpose === 'CODES' ? 'Xác nhận tạo bộ mã khôi phục mới' : 'Xác nhận thay ứng dụng xác thực'}>
        <p>{purpose === 'CODES' ? 'Sau khi tạo bộ mới, các mã khôi phục cũ sẽ hết hiệu lực.' : 'Sau khi kết nối ứng dụng mới, các phiên đăng nhập cũ sẽ được thu hồi.'}</p>
        <form onSubmit={stepUp}>
          <label className="form-field"><span>Mật khẩu hiện tại</span><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required minLength={8}/></label>
          <label className="form-field"><span>Mã xác thực 6 số</span><input className="mfa-otp" value={code} onChange={event => setCode(event.target.value)} autoComplete="one-time-code" inputMode="numeric" required maxLength={6} pattern="[0-9]{6}"/></label>
          {task.error && <div className="login-error" role="alert">{task.error}</div>}
          <div className="mfa-actions"><button className="primary-button" disabled={task.busy}>{task.busy ? 'Đang xác thực…' : purpose === 'CODES' ? 'Xác nhận và tạo mã mới' : 'Xác nhận và thay ứng dụng'}</button>
            <button className="secondary-button" type="button" disabled={task.busy} onClick={() => choose(null)}>Hủy</button></div>
        </form>
      </MfaFrame> : <section className="login-card mfa-card mfa-settings" aria-label="Phương thức xác thực">
        {user.mfaEnrolled ? <>
          <div className="mfa-method"><div><strong>Ứng dụng xác thực TOTP</strong><p>Mã 6 số theo thời gian</p></div><span className="mfa-enabled"><CheckCircle2 size={17} aria-hidden="true"/> Đang bật</span></div>
          {status.error && <div className="login-error" role="alert">{status.error} <button className="text-button" onClick={status.retry}>Thử lại</button></div>}
          <div className="mfa-method"><div><strong>Mã khôi phục</strong><p>{status.data ? `Còn ${status.data.remaining} mã chưa dùng` : status.error ? 'Chưa xác nhận được số mã' : 'Đang kiểm tra số mã…'}</p></div>
            <button className="secondary-button" onClick={() => choose('CODES')}>Tạo bộ mã mới</button></div>
          <div className="mfa-method"><div><strong>Thay ứng dụng xác thực</strong><p>Xác nhận bằng mật khẩu và mã hiện tại</p></div>
            <button className="secondary-button" onClick={() => choose('REPLACE')}>Thay ứng dụng</button></div>
          {notice && <div className="inline-alert" role="status">{notice}</div>}
        </> : <p><KeyRound size={17} aria-hidden="true"/> Tài khoản của bạn chưa thiết lập xác thực hai bước.</p>}
      </section>}
  </>;
}
