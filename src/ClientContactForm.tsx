import {useState, type FormEvent} from 'react';
import {rpc} from './api';
import {ErrorText} from './Auth';

export function ClientContactForm({phone, alternatePhone, onSaved}: {
  phone: string;
  alternatePhone?: string;
  onSaved: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const values = new FormData(event.currentTarget);
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await rpc('finance_update_own_phones', {
        p_phone: values.get('phone'),
        p_alternate_phone: values.get('alternatePhone')
      });
      await onSaved();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save phone numbers.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="fields">
        <label>Phone number
          <input name="phone" type="tel" autoComplete="tel" defaultValue={phone} required maxLength={25} />
        </label>
        <label>Alternate phone number (optional)
          <input name="alternatePhone" type="tel" defaultValue={alternatePhone ?? ''} maxLength={25} />
        </label>
      </div>
      <ErrorText message={error} />
      {saved && <p role="status">Phone numbers saved.</p>}
      <button type="submit" className="button primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save phone numbers'}
      </button>
    </form>
  );
}
