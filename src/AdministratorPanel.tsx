import {useState, type FormEvent} from 'react';
import {api} from './api';
import {ErrorText} from './Auth';

export function AdministratorPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState('');

  async function createAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const email = String(values.get('email')).trim();
    const password = String(values.get('password'));
    setError('');
    setCreated('');
    if (password !== values.get('confirm')) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await api('create-owner', {email, password});
      form.reset();
      setCreated(email);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Administrator creation failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>Administrator access</h2></div>
      <div className="panel-body">
        <p>Administrators can manage clients and records, create other administrators, and delete the ledger. Each administrator verifies sign-in through their own email.</p>
        <form onSubmit={createAdministrator}>
          <fieldset disabled={busy} className="fields">
            <label>Administrator email<input name="email" type="email" autoComplete="off" required maxLength={254} /></label>
            <label>Set password<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
            <label>Confirm password<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={128} /></label>
          </fieldset>
          <ErrorText message={error} />
          {created && <p role="status">Administrator created for {created}.</p>}
          <button type="submit" className="button primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create administrator'}
          </button>
        </form>
      </div>
    </section>
  );
}
