import {useCallback, useEffect, useRef, useState} from 'react';
import {createVault, unlockVault, recoverVault, decryptWalletRecord, encryptWalletRecord} from './vault';
import {rpc, supabase, date} from './api';
import type {Client, VaultRow, VaultItem} from './types';
import {ErrorText} from './Auth';

export function VaultPanel({
  row,
  setRow,
  keyValue,
  setKey,
  clients,
  onChanged
}: {
  row: VaultRow | null;
  setRow: (r: VaultRow) => void;
  keyValue: CryptoKey | null;
  setKey: (k: CryptoKey | null) => void;
  clients: Client[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [records, setRecords] = useState<Record<string, Record<string, string>>>({});

  const decryptSeq = useRef(0);
  const mountedRef = useRef(true);
  const keyRef = useRef(keyValue);
  keyRef.current = keyValue;

  const clear = useCallback(() => {
    decryptSeq.current++;
    setKey(null);
    setRecords({});
    setRecovery('');
  }, [setKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      decryptSeq.current++;
    };
  }, []);

  useEffect(() => {
    if (!keyValue) {
      decryptSeq.current++;
      setRecords({});
      setRecovery('');
    }
  }, [keyValue]);

  const load = useCallback(async (key: CryptoKey) => {
    const seq = ++decryptSeq.current;
    setError('');
    const {data, error: readError} = await supabase
      .from('finance_vault_items')
      .select('client_id,envelope');
    if (seq !== decryptSeq.current || !mountedRef.current || !keyRef.current) return;
    if (readError) {
      setError(readError.message);
      return;
    }
    const out: Record<string, Record<string, string>> = {};
    let failures = 0;
    for (const item of (data || []) as VaultItem[]) {
      if (seq !== decryptSeq.current || !mountedRef.current || !keyRef.current) return;
      try {
        out[item.client_id] = await decryptWalletRecord(key, item.client_id, item.envelope);
      } catch (e) {
        failures++;
        console.error('Failed to decrypt record for client ' + item.client_id, e);
      }
    }
    if (seq !== decryptSeq.current || !mountedRef.current || !keyRef.current) return;
    setRecords(out);
    if (failures > 0) {
      setError(
        `Warning: ${failures} client record(s) could not be decrypted. The vault key or data may have changed.`
      );
    }
  }, []);

  const loadedKeyRef = useRef<CryptoKey | null>(null);
  useEffect(() => {
    if (keyValue && loadedKeyRef.current !== keyValue) {
      loadedKeyRef.current = keyValue;
      void load(keyValue);
    } else if (!keyValue) {
      loadedKeyRef.current = null;
    }
  }, [keyValue, load]);

  async function unlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    setError('');
    try {
      if (!row) {
        const result = await createVault(String(f.get('password')));
        const saved = await rpc<VaultRow>('finance_save_vault_metadata', {
          p_envelope: result.metadata
        });
        setRow(saved);
        setKey(result.key);
        setRecovery(result.recoveryCode);
        await load(result.key);
      } else if (recoveryMode) {
        const result = await recoverVault(
          String(f.get('recovery')),
          String(f.get('password')),
          row.envelope
        );
        const saved = await rpc<VaultRow>('finance_save_vault_metadata', {
          p_envelope: result.metadata,
          p_expected_updated_at: row.updated_at
        });
        setRow(saved);
        setKey(result.key);
        await load(result.key);
      } else {
        const key = await unlockVault(String(f.get('password')), row.envelope);
        setKey(key);
        await load(key);
      }
      form.reset();
    } catch (e) {
      clear();
      setError((e as Error).message);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  return (
    <>
      <div className="page-intro">
        <div>
          <p className="eyebrow">YOUR PRIVATE RECORDS</p>
          <h1>Secret wallet.</h1>
          <p className="muted">
            A separate password. Encrypted before your records leave this device.
          </p>
        </div>
        {keyValue && (
          <button type="button" className="button secondary" onClick={clear}>
            Lock wallet
          </button>
        )}
      </div>
      {!keyValue ? (
        <section className="panel narrow">
          <h2>
            {!row
              ? 'Set up your wallet'
              : recoveryMode
              ? 'Recover your wallet'
              : 'Wallet is locked'}
          </h2>
          <p className="muted">
            Use a separate wallet password with at least 12 characters. It is never sent to Supabase.
          </p>
          <form onSubmit={unlock}>
            {recoveryMode && (
              <label>
                Recovery code
                <input name="recovery" type="password" required autoComplete="off" />
              </label>
            )}
            <label>
              {!row || recoveryMode ? 'New wallet password' : 'Wallet password'}
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete={!row || recoveryMode ? 'new-password' : 'current-password'}
                required
              />
            </label>
            <button type="submit" className="button primary" disabled={busy}>
              {busy
                ? 'Unlocking…'
                : !row
                ? 'Create encrypted wallet'
                : recoveryMode
                ? 'Recover wallet'
                : 'Unlock wallet'}
            </button>
          </form>
          {row && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRecoveryMode(!recoveryMode)}
            >
              {recoveryMode ? 'Use wallet password' : 'Use recovery code'}
            </button>
          )}
          <ErrorText message={error} />
        </section>
      ) : (
        <>
          <div className="notice success">
            Wallet unlocked. It locks automatically after five minutes without activity and when you leave this browser tab.
          </div>
          {recovery && (
            <div className="notice recovery">
              <strong>Save your recovery kit now.</strong>
              <p>
                This code can unlock your wallet. Store it privately outside this application. We cannot recover it for you.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  download('velmurugan-wallet-recovery.json', {
                    application: 'Velmurugan Capital',
                    version: 1,
                    recoveryCode: recovery,
                    createdAt: new Date().toISOString()
                  });
                  setRecovery('');
                }}
              >
                Download recovery kit
              </button>
            </div>
          )}
          <section className="panel">
            <div className="panel-head">
              <h2>Encrypted client records</h2>
              <span className="badge">Only the financer</span>
            </div>
            {clients.length === 0 ? (
              <p className="empty">Create a client to add private details.</p>
            ) : (
              clients.map(c => (
                <details key={c.id} className="wallet-record">
                  <summary>
                    {c.name}
                    <span>{c.customer_code}</span>
                  </summary>
                  <form
                    onSubmit={async e => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      setBusy(true);
                      setError('');
                      try {
                        const record = {
                          ...records[c.id],
                          name: c.name,
                          customer_id: c.customer_code,
                          notes: String(f.get('notes'))
                        };
                        await rpc('finance_save_vault_item', {
                          p_client: c.id,
                          p_envelope: await encryptWalletRecord(keyValue, c.id, record)
                        });
                        if (mountedRef.current && keyRef.current) {
                          setRecords(r => ({...r, [c.id]: record}));
                        }
                        onChanged();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        if (mountedRef.current) setBusy(false);
                      }
                    }}
                  >
                    {records[c.id]?.password && (
                      <label>
                        Client login password
                        <input
                          type="password"
                          readOnly
                          value={records[c.id].password}
                          autoComplete="off"
                          onFocus={e => (e.currentTarget.type = 'text')}
                          onBlur={e => (e.currentTarget.type = 'password')}
                        />
                        <small>Visible while focused. Keep it private.</small>
                      </label>
                    )}
                    <label>
                      Private notes
                      <textarea
                        name="notes"
                        defaultValue={records[c.id]?.notes || ''}
                        maxLength={20000}
                      />
                    </label>
                    <button type="submit" className="button secondary" disabled={busy}>
                      Save encrypted notes
                    </button>
                    <small>
                      Saved record encrypted in Supabase · {date(c.created_at)}
                    </small>
                  </form>
                </details>
              ))
            )}
            <ErrorText message={error} />
          </section>
        </>
      )}
    </>
  );
}

export function download(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
