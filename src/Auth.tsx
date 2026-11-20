import {lazy, Suspense, useEffect, useState} from 'react';
import {api, configured, signIn} from './api';
import {ArrowRightIcon} from './icons';
import type {Profile} from './types';

const Globe = lazy(() => import('./Globe'));

export function Login({onSuccess}: {onSuccess: () => Promise<void>}) {
  const [kind, setKind] = useState<'owner' | 'client'>('owner');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <main className="login-page">
      <section className="login-story">
        <Suspense
          fallback={
            <div className="interactive-globe-container globe-fallback" aria-hidden="true" style={{pointerEvents: 'none'}}>
              <img className="login-earth-video" src="/earth-rotating-poster.jpg" alt="" />
            </div>
          }
        >
          <Globe />
        </Suspense>
        <div className="login-story-content">
          <a className="brand" href="/">
            V<span>Velmurugan <b>Finance</b></span>
          </a>
          <div className="login-story-hero">
            <p className="eyebrow">CAPITAL & CONFIDENCE</p>
            <h1>
              Every account.<br />
              <em>A clearer picture.</em>
            </h1>
            <p>Secure records for your business. Clear balances for the people who trust you.</p>
          </div>
        </div>
      </section>
      <section className="login-side">
        <div className="login-card">
          <span className="mini-mark">V</span>
          <h2>Welcome back.</h2>
          <p className="muted">Sign in to your finance workspace.</p>
          <div className="segments" aria-label="Account type" role="group">
            <button
              type="button"
              className={kind === 'owner' ? 'active' : ''}
              aria-pressed={kind === 'owner'}
              onClick={() => {
                setKind('owner');
                setError('');
              }}
            >
              Financer
            </button>
            <button
              type="button"
              className={kind === 'client' ? 'active' : ''}
              aria-pressed={kind === 'client'}
              onClick={() => {
                setKind('client');
                setError('');
              }}
            >
              Client
            </button>
          </div>
          <form
            onSubmit={async e => {
              e.preventDefault();
              const f = e.currentTarget;
              const data = new FormData(f);
              setBusy(true);
              setError('');
              try {
                await signIn(kind, String(data.get('identifier')), String(data.get('password')));
                f.reset();
                await onSuccess();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              {kind === 'owner' ? 'Login email' : 'Customer ID'}
              <input
                name="identifier"
                type={kind === 'owner' ? 'email' : 'text'}
                autoComplete="username"
                defaultValue={kind === 'owner' ? 'imran5426117@gmail.com' : ''}
                placeholder={kind === 'client' ? 'e.g. 26VMC001' : ''}
                required
                maxLength={200}
                key={kind}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={128}
              />
            </label>
            <ErrorText message={error} />
            {!configured && (
              <ErrorText message="The application is missing its public Supabase configuration. Contact the owner." />
            )}
            <button className="button primary full" disabled={busy || !configured}>
              <span>{busy ? 'Signing in…' : 'Sign in'}</span>
              {!busy && <ArrowRightIcon size={15} />}
            </button>
          </form>
          <p className="fine">
            {kind === 'owner'
              ? 'Your application password is separate from your Gmail password. A verification code is required after sign-in.'
              : 'Your financer creates your ID and password. For a password reset, contact your financer.'}
          </p>
        </div>
      </section>
    </main>
  );
}

export function VerifyEmail({
  profile,
  onSuccess,
  onLogout
}: {
  profile: Profile;
  onSuccess: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  return (
    <main className="center-page">
      <section className="login-card">
        <span className="mini-mark">✓</span>
        <p className="eyebrow">ONE MORE STEP</p>
        <h2>Verify your sign-in.</h2>
        <p className="muted">
          A six-digit code will be sent to <strong>{profile.email}</strong>. Financial records stay
          locked until you verify.
        </p>
        <button
          className="button secondary full"
          disabled={busy || cooldown > 0}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const r = (await api('send-code')) as {challenge_id: string};
              setChallenge(r.challenge_id);
              setSent(true);
              setCooldown(60);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? 'Please wait…'
            : cooldown > 0
            ? `Resend code in ${cooldown}s`
            : sent
            ? 'Send a new code'
            : 'Send verification code'}
        </button>
        {sent && (
          <form
            onSubmit={async e => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await api('verify-code', {
                  challenge_id: challenge,
                  code: String(new FormData(e.currentTarget).get('code'))
                });
                await onSuccess();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Verification code
              <input
                name="code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
              />
            </label>
            <button className="button primary full" disabled={busy}>
              <span>{busy ? 'Verifying…' : 'Verify and continue'}</span>
              {!busy && <ArrowRightIcon size={15} />}
            </button>
          </form>
        )}
        <ErrorText message={error} />
        <p className="fine">Codes expire in ten minutes and can be used only once.</p>
        <button className="text-button" onClick={() => void onLogout()}>
          ← Sign out
        </button>
      </section>
    </main>
  );
}

export function ErrorText({message}: {message: string}) {
  return message ? (
    <p role="alert" className="error-box">
      {message}
    </p>
  ) : null;
}
