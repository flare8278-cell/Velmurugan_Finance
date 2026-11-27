import {useCallback, useEffect, useRef, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {Login, VerifyEmail, ErrorText} from './Auth';
import {AdministratorPanel} from './AdministratorPanel';
import {ClientContactForm} from './ClientContactForm';
import {api, businessDate, date, logout, money, rpc, supabase} from './api';
import {VaultPanel, download} from './VaultPanel';
import {decryptWalletRecord, encryptWalletRecord} from './vault';
import {
  PageIcon,
  OverviewIcon,
  LoansIcon,
  GiveMoneyIcon,
  GetMoneyIcon,
  ReceiptIcon,
  PlusIcon,
  RefreshIcon,
  CopyIcon,
  CheckIcon,
  XIcon,
  SearchIcon,
  UserIcon,
  PhoneIcon,
  ChevronRightIcon,
  ArrowRightIcon,
  LockIcon,
  ShieldIcon
} from './icons';
import {generateDocxArchive, downloadDocx} from './docxArchive';
import type {
  Client,
  Loan,
  Payment,
  Profile,
  Question,
  Message,
  VaultItem,
  VaultRow,
  Workspace,
  Page
} from './types';

type Modal =
  | 'client'
  | 'edit_client'
  | 'loan'
  | 'edit_loan'
  | 'payment'
  | 'credentials'
  | 'question'
  | 'client_detail'
  | 'delete_client'
  | 'purge_ledger'
  | null;

const labels: Record<Page, string> = {
  overview: 'Overview',
  clients: 'Clients',
  loans: 'Loans',
  collections: 'Collections',
  questions: 'Questions',
  wallet: 'Secret wallet',
  reports: 'Statements',
  settings: 'Settings & backups',
  profile: 'Profile'
};

const empty: Workspace = {
  clients: [],
  loans: [],
  payments: [],
  charges: [],
  queries: [],
  messages: [],
  refreshed_at: '',
  business_date: ''
};

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : 'Unable to complete this operation.';

export function CopyButton({text, label = 'Copy'}: {text: string; label?: string}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };
  return (
    <button
      type="button"
      className={'copy-button ' + (copied ? 'copied' : '')}
      onClick={handleCopy}
      title={copied ? 'Copied to clipboard!' : `Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
      <span>{copied ? 'Copied!' : label}</span>
    </button>
  );
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [initial, setInitial] = useState(true);
  const [sessionPresent, setSessionPresent] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [page, setPage] = useState<Page>('overview');
  const [data, setData] = useState<Workspace>(empty);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mobile, setMobile] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [activeClient, setActiveClient] = useState<Client | null>(null);
  const [chosenClient, setChosenClient] = useState('');
  const [chosenLoan, setChosenLoan] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [thread, setThread] = useState('');
  const [vaultRow, setVaultRow] = useState<VaultRow | null>(null);
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentLoan, setPaymentLoan] = useState('');
  const [receipt, setReceipt] = useState<Payment | null>(null);
  const [driveUrl, setDriveUrl] = useState('');
  const [archiveDownloaded, setArchiveDownloaded] = useState(false);
  const [purgeInput, setPurgeInput] = useState('');
  const [purgeSafetyResult, setPurgeSafetyResult] = useState('');

  const requestId = useRef(crypto.randomUUID());
  const authEpoch = useRef(0);
  const profileRef = useRef<Profile | null>(null);

  const notify = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 5000);
  };

  const owner = profile?.role === 'owner';

  const resetPrivate = useCallback(() => {
    authEpoch.current++;
    setData(empty);
    setVaultKey(null);
    setVaultRow(null);
    setModal(null);
    setActiveClient(null);
    setReceipt(null);
    setPurgeInput('');
    setPurgeSafetyResult('');
    setChosenClient('');
    setChosenLoan('');
    setThread('');
    setLoadError('');
    setSearch('');
  }, []);

  const reload = useCallback(
    async (currentEpoch?: number) => {
      const epoch = currentEpoch ?? authEpoch.current;
      setLoading(true);
      setLoadError('');
      try {
        const p = await rpc<Profile>('finance_session_info');
        if (epoch !== authEpoch.current) return;
        setProfile(p);
        profileRef.current = p;
        if (p.role === 'owner' && !p.verified) {
          resetPrivate();
          return;
        }
        if (p.role === 'client' && !p.active) {
          resetPrivate();
          return;
        }
        const result = await rpc<Workspace>('finance_get_workspace');
        if (epoch !== authEpoch.current) return;
        setData(result);
        if (p.role === 'owner') {
          const r = await supabase
            .from('finance_vault_metadata')
            .select('owner_id,envelope,updated_at')
            .maybeSingle();
          if (r.error) throw Error(r.error.message);
          if (epoch === authEpoch.current) {
            setVaultRow(r.data as VaultRow | null);
          }
        }
      } catch (e) {
        if (epoch === authEpoch.current) {
          setData(empty);
          setVaultKey(null);
          setLoadError(errorMessage(e));
        }
      } finally {
        if (epoch === authEpoch.current) setLoading(false);
      }
    },
    [resetPrivate]
  );

  const refreshProfile = useCallback(async () => {
    const epoch = ++authEpoch.current;
    const {
      data: {session}
    } = await supabase.auth.getSession();
    if (epoch !== authEpoch.current) return;
    setSessionPresent(Boolean(session));
    setProfileError('');
    if (!session) {
      setProfile(null);
      profileRef.current = null;
      resetPrivate();
      setInitial(false);
      return;
    }
    try {
      const p = await rpc<Profile>('finance_session_info');
      if (epoch !== authEpoch.current) return;
      setProfile(p);
      profileRef.current = p;
      if (p.role === 'client' || p.verified) {
        await reload(epoch);
      }
    } catch (e) {
      if (epoch !== authEpoch.current) return;
      setProfile(null);
      profileRef.current = null;
      resetPrivate();
      setProfileError(errorMessage(e));
      setInitial(false);
    } finally {
      if (epoch === authEpoch.current) {
        setInitial(false);
      }
    }
  }, [reload, resetPrivate]);

  const signOut = useCallback(async () => {
    authEpoch.current++;
    resetPrivate();
    setProfile(null);
    profileRef.current = null;
    setSessionPresent(false);
    setProfileError('');
    await logout();
  }, [resetPrivate]);

  useEffect(() => {
    void refreshProfile();
    const {
      data: {subscription}
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        authEpoch.current++;
        resetPrivate();
        setProfile(null);
        profileRef.current = null;
        setSessionPresent(false);
        setProfileError('');
        setInitial(false);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setSessionPresent(true);
        // Defer async work to avoid blocking Supabase's auth event dispatcher
        setTimeout(() => {
          void refreshProfile();
        }, 0);
      }
    });
    return () => subscription.unsubscribe();
  }, [refreshProfile, resetPrivate]);

  useEffect(() => {
    if (profile && !owner && !['overview', 'loans', 'profile'].includes(page)) {
      setPage('overview');
    }
  }, [profile, owner, page]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const activity = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (vaultKey) {
          setVaultKey(null);
          notify('Secret wallet locked after inactivity.');
        }
      }, 5 * 60 * 1000);
    };
    const visible = () => {
      if (document.hidden) {
        if (vaultKey) {
          setVaultKey(null);
          notify('Secret wallet locked for privacy.');
        }
      } else if (
        profileRef.current &&
        (profileRef.current.role === 'client' || profileRef.current.verified)
      ) {
        void reload();
      }
    };
    for (const event of ['pointerdown', 'keydown']) window.addEventListener(event, activity);
    document.addEventListener('visibilitychange', visible);
    activity();
    return () => {
      clearTimeout(timeout);
      for (const event of ['pointerdown', 'keydown'])
        window.removeEventListener(event, activity);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [vaultKey, reload]);

  useEffect(() => {
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobile(false);
        if (!saving) {
          setModal(null);
          setActiveClient(null);
        }
      }
    };
    window.addEventListener('keydown', closeOnEsc);
    return () => window.removeEventListener('keydown', closeOnEsc);
  }, [saving]);

  function open(kind: Modal, client = '', loan = '') {
    setFormError('');
    setChosenClient(client);
    setChosenLoan(loan);
    setPaymentLoan(loan || data.loans.find(l => Number(l.balance.total) > 0)?.id || '');
    setPaymentAmount('');
    requestId.current = crypto.randomUUID();
    setModal(kind);
  }

  function openDetail(c: Client) {
    setActiveClient(c);
    setChosenClient(c.id);
    setModal('client_detail');
  }

  function close() {
    setModal(null);
    setActiveClient(null);
    setFormError('');
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const f = new FormData(e.currentTarget);
    setSaving(true);
    setFormError('');
    try {
      if (modal === 'client') {
        await rpc('finance_create_client', {
          p_code: f.get('code'),
          p_name: f.get('name'),
          p_phone: f.get('phone') || '',
          p_address: f.get('address') || '',
          p_work: f.get('work') || ''
        });
        notify('Client saved to Supabase.');
      } else if (modal === 'edit_client') {
        await rpc('finance_update_client', {
          p_client: chosenClient,
          p_name: f.get('name'),
          p_phone: f.get('phone') || '',
          p_address: f.get('address') || '',
          p_work: f.get('work') || ''
        });
        notify('Client record updated.');
        if (activeClient && activeClient.id === chosenClient) {
          setActiveClient({
            ...activeClient,
            name: String(f.get('name') || activeClient.name),
            phone: String(f.get('phone') || ''),
            address: String(f.get('address') || ''),
            work: String(f.get('work') || '')
          });
        }
      } else if (modal === 'edit_loan') {
        const newRate = Number(f.get('rate'));
        await rpc('finance_update_loan_rate', {
          p_loan: chosenLoan,
          p_rate: newRate
        });
        notify(`Loan interest rate updated to ${newRate}%.`);
      } else if (modal === 'delete_client') {
        await rpc('finance_delete_client_history', {
          p_client: chosenClient
        });
        notify('Client and entire loan history permanently deleted.');
        setActiveClient(null);
      } else if (modal === 'purge_ledger') {
        if (purgeInput.trim() !== 'PURGE-VELMURUGAN-FINANCE') {
          setFormError('Please type exact confirmation phrase: PURGE-VELMURUGAN-FINANCE');
          setSaving(false);
          return;
        }
        await rpc('finance_purge_ledger', {
          p_confirmation: 'PURGE-VELMURUGAN-FINANCE'
        });
        setPurgeSafetyResult(
          `Permanent ledger purge completed. Admin owner account (${profile?.email || 'owner'}), system security policies, and audit configurations preserved. All customer accounts and loans erased.`
        );
        notify('Ledger permanently purged.');
        setPurgeInput('');
      } else if (modal === 'loan') {
        await rpc('finance_disburse', {
          p_request: requestId.current,
          p_client: f.get('client'),
          p_amount: Number(f.get('amount')),
          p_rate: Number(f.get('rate')),
          p_date: f.get('date'),
          p_terms_approved: f.get('approve') === 'on'
        });
        notify('Loan saved to Supabase.');
      } else if (modal === 'payment') {
        const result = await rpc<Payment>('finance_record_payment', {
          p_request: requestId.current,
          p_loan: f.get('loan'),
          p_amount: Number(f.get('amount')),
          p_date: businessDate(),
          p_method: f.get('method'),
          p_reference: f.get('reference') || ''
        });
        setReceipt(result);
        notify('Payment saved. Interest cleared before capital.');
      } else if (modal === 'credentials') {
        if (!vaultKey)
          throw Error('Unlock the secret wallet before creating or resetting a password.');
        const c = data.clients.find(c => c.id === chosenClient);
        if (!c) throw Error('Client not found.');
        const password = String(f.get('password'));

        const {data: existingItem, error: readError} = await supabase
          .from('finance_vault_items')
          .select('client_id,envelope')
          .eq('client_id', c.id)
          .maybeSingle();
        if (readError) throw Error(readError.message);

        let existingRecord: Record<string, unknown> = {};
        if (existingItem) {
          let decrypted: unknown;
          try {
            decrypted = await decryptWalletRecord(
              vaultKey,
              c.id,
              (existingItem as VaultItem).envelope
            );
          } catch {
            throw Error(
              'Could not decrypt existing wallet record for this client. Password setup aborted to preserve existing notes.'
            );
          }
          if (!decrypted || typeof decrypted !== 'object' || Array.isArray(decrypted)) {
            throw Error(
              'Existing wallet record format is invalid. Password setup aborted to preserve existing notes.'
            );
          }
          existingRecord = decrypted as Record<string, unknown>;
        }

        const submittedNotes = String(f.get('notes') || '');
        const priorNotes =
          typeof existingRecord.notes === 'string' ? existingRecord.notes : '';
        const notes = submittedNotes.trim() ? submittedNotes : priorNotes;
        const altPhone = c.alternate_phone || '';

        const record: Record<string, unknown> = {
          ...existingRecord,
          customer_id: c.customer_code,
          name: c.name,
          phone: c.phone,
          ...(altPhone || 'alternate_phone' in existingRecord
            ? {alternate_phone: altPhone}
            : {}),
          password,
          notes
        };

        await api(c.auth_user_id ? 'reset-client-password' : 'provision-client', {
          client_id: c.id,
          password,
          envelope: await encryptWalletRecord(vaultKey, c.id, record)
        });
        notify('Client login saved. Credentials are encrypted in your wallet.');
      } else if (modal === 'question') {
        await rpc('finance_ask_question', {
          p_client: owner ? f.get('client') : profile!.client_id,
          p_subject: f.get('subject'),
          p_body: f.get('body')
        });
        notify('Question saved.');
      }
      setModal(null);
      await reload();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (initial) {
    return (
      <div className="center-page">
        <div className="spinner" />
        <p>Connecting securely…</p>
      </div>
    );
  }

  if (!sessionPresent) {
    return <Login onSuccess={refreshProfile} />;
  }

  if (!profile) {
    return (
      <div className="center-page">
        <section className="login-card">
          <h2>Account access</h2>
          <ErrorText
            message={profileError || 'This login is not linked to a finance account.'}
          />
          <div style={{display: 'flex', gap: 10, marginTop: 16}}>
            <button
              type="button"
              className="button secondary"
              onClick={() => void refreshProfile()}
            >
              Try again
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (owner && !profile.verified) {
    return (
      <VerifyEmail profile={profile} onSuccess={refreshProfile} onLogout={signOut} />
    );
  }

  if (!owner && !profile.active) {
    return (
      <div className="center-page">
        <section className="login-card">
          <h2>Account inactive</h2>
          <p className="fine">
            This client account is currently marked inactive by the financer.
            Please reach out directly to check access or discuss your account.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </section>
      </div>
    );
  }

  const pages: Page[] = owner
    ? [
        'overview',
        'clients',
        'loans',
        'collections',
        'questions',
        'wallet',
        'reports',
        'settings'
      ]
    : ['overview', 'loans', 'profile'];

  const visibleClients = data.clients.filter(
    c =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.customer_code.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.toLowerCase().includes(search.toLowerCase()) ||
      (c.alternate_phone || '').toLowerCase().includes(search.toLowerCase())
  );

  const client = (id: string) => data.clients.find(c => c.id === id);
  const loan = (id: string) => data.loans.find(l => l.id === id);

  const totals = {
    capital: data.loans.reduce((n, l) => n + Number(l.balance.principal), 0),
    interest: data.loans.reduce((n, l) => n + Number(l.balance.interest), 0),
    monthly: data.loans.reduce(
      (n, l) => n + (Number(l.balance.principal) * Number(l.monthly_rate)) / 100,
      0
    )
  };

  const selectedPaymentLoan = loan(paymentLoan);
  const interestPortion = Math.min(
    Number(paymentAmount || 0),
    Number(selectedPaymentLoan?.balance.interest || 0)
  );
  const capitalPortion = Math.min(
    Number(selectedPaymentLoan?.balance.principal || 0),
    Math.max(0, Number(paymentAmount || 0) - interestPortion)
  );

  function transactionTable(payments: Payment[]) {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Payment</th>
              {owner && <th>Client</th>}
              <th>Amount</th>
              <th>Interest</th>
              <th>Capital</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td>
                  <strong>{p.id.slice(0, 8).toUpperCase()}</strong>
                  <small>
                    {date(p.paid_on)} · {p.method}
                  </small>
                </td>
                {owner && <td>{client(loan(p.loan_id)?.client_id || '')?.name || '—'}</td>}
                <td>{money(p.amount)}</td>
                <td>{money(p.interest_paid)}</td>
                <td>{money(p.principal_paid)}</td>
                <td>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setReceipt(p)}
                  >
                    <ReceiptIcon size={13} /> Receipt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!payments.length && <p className="empty">No payments recorded.</p>}
      </div>
    );
  }

  return (
    <div className={'app-shell ' + (!owner ? 'borrower-shell' : '')}>
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <a
          className="brand"
          href="#"
          onClick={e => {
            e.preventDefault();
            setPage('overview');
            setMobile(false);
          }}
        >
          <span className="brand-mark">V</span>
          <span className="brand-text">
            <span className="brand-title">
              Velmurugan <b className="gold">Finance</b>
            </span>
            <small className="brand-subtitle">EST. 2026 · CLEAR ACCOUNTS</small>
          </span>
        </a>
        <div className="business-switch">
          <span className="avatar gold-avatar">
            {owner ? 'VF' : data.clients[0]?.name[0] || 'C'}
          </span>
          <div className="business-switch-text">
            <strong>Velmurugan Finance</strong>
            <small>{owner ? 'Active ledger' : 'Personal view'}</small>
          </div>
        </div>
        <p className="nav-label">{owner ? 'MAIN WORKSPACE' : 'CLIENT PORTAL'}</p>
        <nav>
          {pages.map(p => (
            <button
              type="button"
              key={p}
              className={'nav-item ' + (page === p ? 'active' : '')}
              onClick={() => {
                setPage(p);
                setMobile(false);
                setReceipt(null);
                setSearch('');
              }}
              aria-current={page === p ? 'page' : undefined}
            >
              <span>
                <PageIcon page={p} size={18} />
              </span>
              {!owner && p === 'overview' ? 'Home' : labels[p]}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <strong>A little clarity, every day.</strong>
            Every balance comes from your secure account records.
          </div>
          <div className="sidebar-user">
            <span className="avatar gold-avatar">
              {owner ? 'VF' : data.clients[0]?.name[0] || 'C'}
            </span>
            <div>
              <strong>{owner ? 'Financer' : data.clients[0]?.name || 'Client'}</strong>
              <small>{owner ? 'Verified access' : 'Private client access'}</small>
            </div>
          </div>
        </div>
      </aside>
      {mobile && (
        <button
          type="button"
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMobile(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-label="Open workspace menu"
            aria-expanded={mobile}
            onClick={() => setMobile(!mobile)}
          >
            ☰
          </button>
          <div>
            Workspace <span>/ {!owner && page === 'overview' ? 'Home' : labels[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="date-label">{date(businessDate())}</span>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => void reload()}
            >
              <RefreshIcon size={14} className={loading ? 'spin' : ''} />{' '}
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="button secondary small"
              onClick={() => void signOut()}
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="main-content">
          <div className="sync-line">
            <span className="sync-dot" />
            Connected to Supabase
            <span>
              {data.refreshed_at
                ? 'Updated ' +
                  new Date(data.refreshed_at).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })
                : 'Loading account records…'}
            </span>
          </div>
          <ErrorText message={loadError} />
          {loading && !data.refreshed_at ? (
            <section className="panel">
              <p className="empty">Loading your records securely…</p>
            </section>
          ) : loadError ? (
            <section className="panel">
              <p>Records could not be refreshed. No balance is being shown.</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => void reload()}
              >
                Retry
              </button>
            </section>
          ) : (
            <>
              {page === 'overview' && (
                owner ? (
                  <>
                    <PageIntro
                      eyebrow="YOUR BUSINESS, AT A GLANCE"
                      title="Good to see you."
                      subtitle="Your loans, payments and next steps in one place."
                      actions={
                        <>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => open('payment')}
                          >
                            <GetMoneyIcon size={15} /> Get money
                          </button>
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => open('loan')}
                          >
                            <GiveMoneyIcon size={15} /> Give money
                          </button>
                        </>
                      }
                    />
                    <section className="welcome-banner">
                      <p className="eyebrow">YOUR FINANCE, IN HARMONY</p>
                      <h2>
                        A clear picture.
                        <br />
                        <em>A confident next step.</em>
                      </h2>
                      <p>
                        Keep every client’s financial journey organised. Your records are saved securely in Supabase.
                      </p>
                      <span aria-hidden="true">₹</span>
                    </section>
                    <div className="stats">
                      <Stat
                        label="Capital remaining"
                        value={money(totals.capital)}
                        hint="After principal repayments · Click to view loans"
                        feature
                        onClick={() => setPage('loans')}
                      />
                      <Stat
                        label="Unpaid interest"
                        value={money(totals.interest)}
                        hint="Posted charges less payments · Click for collections"
                        onClick={() => setPage('collections')}
                      />
                      <Stat
                        label="Next interest estimate"
                        value={money(totals.monthly)}
                        hint="At current capital and rates · Click for statements"
                        onClick={() => setPage('reports')}
                      />
                      <Stat
                        label="Clients"
                        value={String(data.clients.length)}
                        hint="Individual client records · Click to view clients"
                        onClick={() => setPage('clients')}
                      />
                    </div>
                    <div className="dashboard-grid">
                      <section className="panel">
                        <div className="panel-head">
                          <h2>Client accounts</h2>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setPage('clients')}
                          >
                            View all <ChevronRightIcon size={13} />
                          </button>
                        </div>
                        <ClientTable
                          clients={data.clients.slice(0, 5)}
                          loans={data.loans}
                          onView={id => {
                            setChosenClient(id);
                            setPage('loans');
                          }}
                          onDetail={c => openDetail(c)}
                        />
                      </section>
                      <section className="panel">
                        <div className="panel-head">
                          <h2>Your next steps</h2>
                        </div>
                        <div className="panel-body steps">
                          <p>
                            <b>01</b>Create a client and their loans.
                          </p>
                          <p>
                            <b>02</b>Set up your encrypted secret wallet.
                          </p>
                          <p>
                            <b>03</b>Create the client’s ID and password.
                          </p>
                          <p>
                            <b>04</b>Record repayments and reconcile balances.
                          </p>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setPage('wallet')}
                          >
                            Open secret wallet <ChevronRightIcon size={13} />
                          </button>
                        </div>
                      </section>
                    </div>
                  </>
                ) : (
                  <BorrowerHomeView
                    borrower={data.clients[0]}
                    loans={data.loans}
                    payments={data.payments}
                    totals={totals}
                    onNavigate={setPage}
                    onReceipt={setReceipt}
                    onAskQuestion={() => open('question')}
                  />
                )
              )}
              {page === 'clients' && owner && (
                <>
                  <PageIntro
                    eyebrow="PEOPLE & ACCOUNTS"
                    title="Your clients."
                    subtitle="A separate, private account for every client."
                    actions={
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => open('client')}
                      >
                        <PlusIcon size={14} /> Add client
                      </button>
                    }
                  />
                  <section className="panel">
                    <div className="panel-head">
                      <h2>
                        Client directory <small>{data.clients.length} records</small>
                      </h2>
                      <div style={{position: 'relative', display: 'flex', alignItems: 'center'}}>
                        <input
                          className="search"
                          placeholder="Search name, ID or phone…"
                          value={search}
                          onChange={e => setSearch(e.target.value)}
                          aria-label="Search clients"
                        />
                      </div>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Client</th>
                            <th>ID / Contact</th>
                            <th>Login</th>
                            <th>Access</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleClients.map(c => (
                            <tr key={c.id}>
                              <td>
                                <div
                                  className="person"
                                  style={{cursor: 'pointer'}}
                                  onClick={() => openDetail(c)}
                                >
                                  <span className="avatar">{c.name[0]}</span>
                                  <div>
                                    <strong>{c.name}</strong>
                                    <small>{c.address || 'Address not provided'}</small>
                                    <small>{c.work}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                                  <strong className="account-code">{c.customer_code}</strong>
                                  <CopyButton text={c.customer_code} label="ID" />
                                </div>
                                {c.phone ? (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      marginTop: 4
                                    }}
                                  >
                                    <small>{c.phone}</small>
                                    <CopyButton text={c.phone} label="Phone" />
                                  </div>
                                ) : (
                                  <small>Phone not provided</small>
                                )}
                                {c.alternate_phone && (
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      marginTop: 4
                                    }}
                                  >
                                    <small>Alt: {c.alternate_phone}</small>
                                    <CopyButton text={c.alternate_phone} label="Alt phone" />
                                  </div>
                                )}
                              </td>
                              <td>
                                <span className={'badge ' + (!c.auth_user_id ? 'warm' : '')}>
                                  {c.auth_user_id ? 'Created' : 'Not created'}
                                </span>
                              </td>
                              <td>
                                <span className={'badge ' + (!c.active ? 'warm' : '')}>
                                  {c.active ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                              <td>
                                <div className="row-actions">
                                  <button
                                    type="button"
                                    className="button secondary small"
                                    onClick={() => openDetail(c)}
                                  >
                                    History & Details
                                  </button>
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => {
                                      setChosenClient(c.id);
                                      setPage('loans');
                                    }}
                                  >
                                    Loans
                                  </button>
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={() => open('credentials', c.id)}
                                  >
                                    {c.auth_user_id ? 'Reset password' : 'Create login'}
                                  </button>
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={async () => {
                                      try {
                                        await rpc('finance_set_client_active', {
                                          p_client: c.id,
                                          p_active: !c.active
                                        });
                                        await reload();
                                        notify(
                                          c.active
                                            ? 'Access disabled. Existing client sessions were revoked.'
                                            : 'Client access enabled.'
                                        );
                                      } catch (e) {
                                        notify(errorMessage(e));
                                      }
                                    }}
                                  >
                                    {c.active ? 'Disable' : 'Enable'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!visibleClients.length && (
                        <p className="empty">
                          {search ? 'No clients match your search.' : 'No client records yet.'}
                        </p>
                      )}
                    </div>
                  </section>
                </>
              )}
              {page === 'loans' && (
                owner ? (
                  <>
                    <PageIntro
                      eyebrow="CAPITAL & TERMS"
                      title="Active loans."
                      subtitle="Interest is simple and accrued monthly on the remaining principal."
                      actions={
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => open('loan')}
                        >
                          <GiveMoneyIcon size={15} /> Give money
                        </button>
                      }
                    />
                    <div className="filter-group">
                      <label htmlFor="loans-client-select" className="filter">
                        Client
                      </label>
                      <select
                        id="loans-client-select"
                        value={chosenClient}
                        onChange={e => setChosenClient(e.target.value)}
                      >
                        <option value="">All clients</option>
                        {data.clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.customer_code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <LoanCards
                      loans={data.loans.filter(
                        l => !chosenClient || l.client_id === chosenClient
                      )}
                      clients={data.clients}
                      owner={owner}
                      onPayment={l => open('payment', l.client_id, l.id)}
                      onEditRate={l => {
                        setChosenClient(l.client_id);
                        setChosenLoan(l.id);
                        setModal('edit_loan');
                      }}
                    />
                  </>
                ) : (
                  <BorrowerLoansView
                    loans={data.loans}
                    payments={data.payments}
                    onReceipt={setReceipt}
                    onAskQuestion={() => open('question')}
                  />
                )
              )}
              {page === 'collections' && owner && (
                <>
                  <PageIntro
                    eyebrow="EVERY PAYMENT ACCOUNTED FOR"
                    title="Your collections."
                    subtitle="Interest and principal are recorded separately on every receipt."
                    actions={
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => open('payment')}
                      >
                        <GetMoneyIcon size={15} /> Get money
                      </button>
                    }
                  />
                  <div className="stats">
                    <Stat
                      label="Total received"
                      value={money(
                        data.payments.reduce((n, p) => n + Number(p.amount), 0)
                      )}
                      feature
                    />
                    <Stat
                      label="Principal collected"
                      value={money(
                        data.payments.reduce((n, p) => n + Number(p.principal_paid), 0)
                      )}
                    />
                    <Stat
                      label="Interest collected"
                      value={money(
                        data.payments.reduce((n, p) => n + Number(p.interest_paid), 0)
                      )}
                    />
                  </div>
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Payments ledger</h2>
                    </div>
                    {transactionTable(data.payments)}
                  </section>
                </>
              )}
              {page === 'questions' && owner && (
                <>
                  <PageIntro
                    eyebrow="CLEAR QUESTIONS, CLEAR ANSWERS"
                    title="Client questions."
                    subtitle="Direct communication about loan balances, receipts and statements."
                    actions={
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => open('question')}
                      >
                        <PlusIcon size={14} /> Ask a question
                      </button>
                    }
                  />
                  <QuestionThreads
                    queries={data.queries}
                    messages={data.messages}
                    clients={data.clients}
                    activeThreadId={thread}
                    onSelectThread={setThread}
                    owner={true}
                    onReload={reload}
                    notify={notify}
                    onAskQuestion={() => open('question')}
                  />
                </>
              )}
              {page === 'profile' && !owner && (
                <BorrowerProfileView
                  borrower={data.clients[0]}
                  queries={data.queries}
                  messages={data.messages}
                  clients={data.clients}
                  activeThreadId={thread}
                  onSelectThread={setThread}
                  onReload={reload}
                  notify={notify}
                  onAskQuestion={() => open('question')}
                />
              )}
              {page === 'wallet' && owner && (
                <VaultPanel
                  row={vaultRow}
                  setRow={setVaultRow}
                  keyValue={vaultKey}
                  setKey={setVaultKey}
                  clients={data.clients}
                  onChanged={reload}
                />
              )}
              {page === 'reports' && owner && (
                <>
                  <PageIntro
                    eyebrow="STATEMENTS & REPORTS"
                    title="Account statements."
                    subtitle="Detailed ledger records ready for printing, PDF export and review."
                    actions={
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => window.print()}
                      >
                        Print statement
                      </button>
                    }
                  />
                  {owner && (
                    <div className="filter-group">
                      <label htmlFor="reports-client-select" className="filter">
                        Filter by client
                      </label>
                      <select
                        id="reports-client-select"
                        value={chosenClient}
                        onChange={e => setChosenClient(e.target.value)}
                      >
                        <option value="">All clients</option>
                        {data.clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.customer_code}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <section className="panel printable">
                    <div className="statement-head">
                      <div>
                        <h2>Velmurugan Finance</h2>
                        <p className="muted">
                          Salem · Clarity in every account · Statement as of{' '}
                          {date(businessDate())}
                        </p>
                      </div>
                      <span className="badge">Official statement</span>
                    </div>
                    <div className="stats">
                      <Stat
                        label="Total loans"
                        value={String(
                          data.loans.filter(
                            l => !chosenClient || l.client_id === chosenClient
                          ).length
                        )}
                      />
                      <Stat
                        label="Outstanding capital"
                        value={money(
                          data.loans
                            .filter(l => !chosenClient || l.client_id === chosenClient)
                            .reduce((n, l) => n + Number(l.balance.principal), 0)
                        )}
                        feature
                      />
                      <Stat
                        label="Unpaid interest"
                        value={money(
                          data.loans
                            .filter(l => !chosenClient || l.client_id === chosenClient)
                            .reduce((n, l) => n + Number(l.balance.interest), 0)
                        )}
                      />
                    </div>
                    <h3>Payments on record</h3>
                    {transactionTable(
                      data.payments.filter(p => {
                        if (!chosenClient) return true;
                        const l = loan(p.loan_id);
                        return l?.client_id === chosenClient;
                      })
                    )}
                  </section>
                </>
              )}
              {page === 'settings' && owner && (
                <>
                  <PageIntro
                    eyebrow="BACKUPS & AUDIT"
                    title="Settings & data protection."
                    subtitle="Review your data guarantees, export records and verify system state."
                  />
                  <AdministratorPanel />
                  <div className="dashboard-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Business records & executive archive</h2>
                      </div>
                      <div className="panel-body">
                        <p>
                          Financial records are stored in Supabase PostgreSQL with tamper-evident sequential receipting. All customer passwords, zero-knowledge secret vault ciphertext, and administrative credentials are automatically excluded from document archives.
                        </p>
                        <div className="settings-archive-actions">
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => {
                              const bytes = generateDocxArchive(data);
                              downloadDocx(`velmurugan-finance-archive-${businessDate()}.docx`, bytes);
                              setArchiveDownloaded(true);
                              notify('Executive DOCX archive downloaded successfully.');
                            }}
                          >
                            <ReceiptIcon size={15} /> Download executive archive (.docx)
                          </button>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => {
                              download(
                                `velmurugan-business-records-${businessDate()}.json`,
                                {
                                  application: 'Velmurugan Finance',
                                  exportedAt: new Date().toISOString(),
                                  ...data
                                }
                              );
                              notify('Business records downloaded (JSON).');
                            }}
                          >
                            Download raw ledger (JSON)
                          </button>
                        </div>
                        {archiveDownloaded && (
                          <div style={{marginTop: 12}}>
                            <span className="drive-status-badge verified">
                              <CheckIcon size={12} /> Executive DOCX archive downloaded for this session
                            </span>
                          </div>
                        )}

                        <div className="drive-connector-box">
                          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                            <ShieldIcon size={16} />
                            <strong style={{fontSize: 13, color: '#f0f6fc'}}>Google Drive & External Cold Storage</strong>
                          </div>
                          <p className="muted" style={{fontSize: 12, lineHeight: 1.5}}>
                            A folder URL identifies the destination folder only and cannot authorize Google Drive directly. Cloud synchronization requires an authorized OAuth connector. To archive your records to Google Drive or external cold storage, download the executive DOCX archive or JSON ledger above and upload it manually to your destination folder.
                          </p>
                          <div className="drive-connector-input-row">
                            <input
                              type="url"
                              placeholder="Destination reference (e.g. https://drive.google.com/drive/folders/...)"
                              value={driveUrl}
                              onChange={e => setDriveUrl(e.target.value)}
                              aria-label="Google Drive backup folder URL reference"
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="panel danger-zone-panel">
                      <div className="panel-head">
                        <h2>Permanent Ledger Purge (Danger Zone)</h2>
                      </div>
                      <div className="panel-body">
                        <div className="purge-warning-box">
                          <strong>Irreversible Permanent Purge Safeguard:</strong>
                          <p style={{margin: '6px 0 0'}}>
                            Permanent purge removes all customer accounts, loan contracts, payment receipts, and query tickets from active operations. Administrative owner profiles, encryption keys, and system audit configurations are preserved.
                          </p>
                        </div>
                        <div style={{display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
                          <button
                            type="button"
                            className="button danger"
                            onClick={() => {
                              setFormError('');
                              setPurgeInput('');
                              setModal('purge_ledger');
                            }}
                          >
                            Initiate permanent ledger purge...
                          </button>
                          <small style={{color: archiveDownloaded ? '#34d399' : '#f87171'}}>
                            {archiveDownloaded ? '✓ Pre-purge archive downloaded' : '⚠ Pre-purge archive recommended'}
                          </small>
                        </div>
                        {purgeSafetyResult && (
                          <div className="purge-safety-badge">
                            {purgeSafetyResult}
                          </div>
                        )}
                      </div>
                    </section>

                    <section className="panel">
                      <div className="panel-head">
                        <h2>Security policy</h2>
                      </div>
                      <div className="panel-body steps">
                        <p>
                          <b>01</b>All financial ledger operations are validated server-side by
                          Supabase PostgreSQL row-level security and RPC functions.
                        </p>
                        <p>
                          <b>02</b>Client login passwords and secret notes are stored with
                          zero-knowledge AES-GCM encryption. The server never receives your
                          master wallet key.
                        </p>
                        <p>
                          <b>03</b>Financer operations require verified email OTP tokens.
                        </p>
                        <p>
                          <b>04</b>Client session invalidation is immediate upon disabling access.
                        </p>
                      </div>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}

      {modal && (
        <ModalFrame
          title={
            {
              client: 'Add client',
              edit_client: 'Edit client details',
              loan: 'Give money',
              edit_loan: 'Update loan interest rate',
              payment: 'Get money',
              credentials: 'Client login & secret wallet',
              question: 'Ask a question',
              client_detail: 'Client account & history',
              delete_client: 'Delete client & all records',
              purge_ledger: 'Permanent ledger purge safeguard'
            }[modal] || ''
          }
          onClose={() => {
            if (!saving) close();
          }}
        >
          {modal === 'client_detail' && activeClient ? (
            (() => {
              const detailClient =
                data.clients.find(item => item.id === activeClient.id) || activeClient;
              return (
            <div className="client-detail-panel">
              <div className="client-detail-header">
                <div className="client-detail-identity">
                  <span className="avatar gold-avatar">{detailClient.name[0]}</span>
                  <div>
                    <div style={{display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap'}}>
                      <h3>{detailClient.name}</h3>
                      {owner && (
                        <button
                          type="button"
                          className="button secondary small"
                          style={{padding: '3px 8px', fontSize: 11}}
                          onClick={() => {
                            setChosenClient(detailClient.id);
                            setModal('edit_client');
                          }}
                        >
                          Edit info
                        </button>
                      )}
                    </div>
                    <div className="client-detail-chips">
                      <span className="pill account-code">
                        ID: {detailClient.customer_code}
                      </span>
                      <CopyButton text={detailClient.customer_code} label="ID" />
                      {detailClient.phone && (
                        <>
                          <a
                            href={'tel:' + detailClient.phone}
                            className="pill phone-link"
                            title="Call client"
                          >
                            <PhoneIcon size={12} /> {detailClient.phone}
                          </a>
                          <CopyButton text={detailClient.phone} label="Phone" />
                        </>
                      )}
                      {detailClient.alternate_phone && (
                        <>
                          <a
                            href={'tel:' + detailClient.alternate_phone}
                            className="pill phone-link"
                            title="Call alternate phone"
                          >
                            <PhoneIcon size={12} /> Alt: {detailClient.alternate_phone}
                          </a>
                          <CopyButton text={detailClient.alternate_phone} label="Alt phone" />
                        </>
                      )}
                      <span className={'badge ' + (detailClient.active ? '' : 'warm')}>
                        {detailClient.active ? 'Active' : 'Disabled'}
                      </span>
                      <span
                        className={'badge ' + (detailClient.auth_user_id ? '' : 'warm')}
                      >
                        {detailClient.auth_user_id ? 'Login Created' : 'No Login'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Financial Summary */}
              <div className="client-detail-stats">
                {(() => {
                  const clientLoans = data.loans.filter(
                    l => l.client_id === detailClient.id
                  );
                  const clientPayments = data.payments.filter(p =>
                    clientLoans.some(l => l.id === p.loan_id)
                  );
                  const totalBorrowed = clientLoans.reduce(
                    (acc, l) => acc + Number(l.original_principal),
                    0
                  );
                  const principalBalance = clientLoans.reduce(
                    (acc, l) => acc + Number(l.balance.principal),
                    0
                  );
                  const interestBalance = clientLoans.reduce(
                    (acc, l) => acc + Number(l.balance.interest),
                    0
                  );
                  const totalPaid = clientPayments.reduce(
                    (acc, p) => acc + Number(p.amount),
                    0
                  );

                  return (
                    <>
                      <div className="client-stat-card">
                        <small>Total Borrowed</small>
                        <strong>{money(totalBorrowed)}</strong>
                      </div>
                      <div className="client-stat-card">
                        <small>Principal Balance</small>
                        <strong
                          style={{
                            color: principalBalance > 0 ? 'var(--teal-dark)' : 'inherit'
                          }}
                        >
                          {money(principalBalance)}
                        </strong>
                      </div>
                      <div className="client-stat-card">
                        <small>Unpaid Interest</small>
                        <strong>{money(interestBalance)}</strong>
                      </div>
                      <div className="client-stat-card">
                        <small>Total Repaid</small>
                        <strong style={{color: 'var(--teal-text)'}}>
                          {money(totalPaid)}
                        </strong>
                      </div>
                    </>
                  );
                })()}
              </div>

              <div
                style={{
                  background: '#0f1d2e',
                  border: '1px solid rgba(56, 189, 248, 0.18)',
                  color: '#f0f6fc',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  marginBottom: 16
                }}
              >
                <p>
                  <strong>Primary Phone:</strong> {detailClient.phone || 'Not provided'}
                </p>
                <p>
                  <strong>Alternate Phone:</strong> {detailClient.alternate_phone || 'Not provided'}
                </p>
                <p>
                  <strong>Address:</strong> {detailClient.address || 'Address not recorded'}
                </p>
                <p>
                  <strong>Work / Occupation:</strong> {detailClient.work || 'Not specified'}
                </p>
                <p>
                  <strong>Client Since:</strong> {date(detailClient.created_at)}
                </p>
              </div>

              {/* Associated Loans Section */}
              <div className="client-detail-section">
                <h4>
                  <span>
                    Associated Loans (
                    {data.loans.filter(l => l.client_id === activeClient.id).length})
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      close();
                      open('loan', activeClient.id);
                    }}
                  >
                    + Give new loan
                  </button>
                </h4>
                <div className="client-history-list">
                  {data.loans.filter(l => l.client_id === activeClient.id).length === 0 ? (
                    <p className="empty">No loans on record for this client.</p>
                  ) : (
                    data.loans
                      .filter(l => l.client_id === activeClient.id)
                      .map(l => (
                        <div key={l.id} className="client-history-item">
                          <div>
                            <strong>Loan #{l.id.slice(0, 8).toUpperCase()}</strong>
                            <small>
                              Disbursed {date(l.disbursed_on)} · {l.monthly_rate}% / month
                            </small>
                            <small>Next due: {date(l.next_due_on)}</small>
                          </div>
                          <div style={{textAlign: 'right'}}>
                            <div className="money">
                              <strong>{money(l.balance.principal)}</strong> balance
                            </div>
                            <small style={{display: 'block'}}>
                              {money(l.balance.interest)} interest
                            </small>
                            <div style={{marginTop: 4, display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap'}}>
                              {Number(l.balance.total) > 0 && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => {
                                    close();
                                    open('payment', activeClient.id, l.id);
                                  }}
                                >
                                  Repay ↙
                                </button>
                              )}
                              {owner && (
                                <button
                                  type="button"
                                  className="text-button"
                                  onClick={() => {
                                    setChosenClient(activeClient.id);
                                    setChosenLoan(l.id);
                                    setModal('edit_loan');
                                  }}
                                >
                                  Change rate
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Payment History Section */}
              <div className="client-detail-section">
                <h4>
                  <span>
                    Payment History (
                    {(() => {
                      const clientLoans = data.loans.filter(
                        l => l.client_id === activeClient.id
                      );
                      return data.payments.filter(p =>
                        clientLoans.some(l => l.id === p.loan_id)
                      ).length;
                    })()}
                    )
                  </span>
                </h4>
                <div className="client-history-list">
                  {(() => {
                    const clientLoans = data.loans.filter(
                      l => l.client_id === activeClient.id
                    );
                    const payments = data.payments.filter(p =>
                      clientLoans.some(l => l.id === p.loan_id)
                    );
                    if (!payments.length)
                      return <p className="empty">No payments recorded yet.</p>;
                    return payments.map(p => (
                      <div key={p.id} className="client-history-item">
                        <div>
                          <strong>{money(p.amount)}</strong>
                          <small>
                            {date(p.paid_on)} · {p.method} · Ref: {p.reference || 'None'}
                          </small>
                          <small>
                            Interest: {money(p.interest_paid)} · Principal:{' '}
                            {money(p.principal_paid)}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setReceipt(p)}
                        >
                          <ReceiptIcon size={12} /> Receipt
                        </button>
                      </div>
                    ));
                  })()}
                </div>
              </div>

              {/* Quick Actions Footer */}
              <div className="client-quick-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    close();
                    open('loan', activeClient.id);
                  }}
                >
                  <GiveMoneyIcon size={14} /> Give money
                </button>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    close();
                    open('payment', activeClient.id);
                  }}
                >
                  <GetMoneyIcon size={14} /> Get money
                </button>
                {owner && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      close();
                      open('credentials', activeClient.id);
                    }}
                  >
                    <LockIcon size={14} /> Secret wallet
                  </button>
                )}
              </div>

              {owner && (
                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 14,
                    borderTop: '1px solid var(--line)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    flexWrap: 'wrap'
                  }}
                >
                  <button
                    type="button"
                    className="button secondary small"
                    onClick={async () => {
                      try {
                        const newActive = !activeClient.active;
                        await rpc('finance_set_client_active', {
                          p_client: activeClient.id,
                          p_active: newActive
                        });
                        setActiveClient({...activeClient, active: newActive});
                        notify(`Client marked as ${newActive ? 'active' : 'inactive'}.`);
                        await reload();
                      } catch (e) {
                        notify(errorMessage(e));
                      }
                    }}
                  >
                    {activeClient.active ? 'Archive client (make inactive)' : 'Reactivate client'}
                  </button>
                  <button
                    type="button"
                    className="button danger-outline small"
                    onClick={() => {
                      setChosenClient(activeClient.id);
                      setModal('delete_client');
                    }}
                  >
                    Delete client & history 🗑
                  </button>
                </div>
              )}
            </div>
              );
            })()
          ) : modal === 'credentials' && !vaultKey ? (
            vaultRow ? (
              <VaultPanel
                row={vaultRow}
                setRow={setVaultRow}
                keyValue={null}
                setKey={setVaultKey}
                clients={[]}
                onChanged={reload}
              />
            ) : (
              <div>
                <p>Set up your Secret Wallet and save its recovery kit before creating a client password.</p>
                <button type="button" className="button secondary" onClick={() => {
                  close();
                  setPage('wallet');
                }}>Set up Secret Wallet</button>
              </div>
            )
          ) : (
            <form onSubmit={submit}>
              {modal === 'client' && (
                <>
                  <div className="fields">
                    <Field label="Full name" name="name" required maxLength={100} />
                    <Field
                      label="Customer ID"
                      name="code"
                      required
                      pattern="[A-Za-z0-9-]{3,30}"
                      placeholder="26VMC001"
                      maxLength={30}
                    />
                    <Field label="Mobile number" name="phone" type="tel" maxLength={20} />
                    <Field label="Work" name="work" maxLength={100} />
                  </div>
                  <Field label="Address" name="address" maxLength={250} />
                  <p className="fine">
                    After saving, unlock the wallet and choose Create login to set a password
                    for this ID.
                  </p>
                </>
              )}
              {modal === 'edit_client' && (
                <>
                  {(() => {
                    const c =
                      data.clients.find(item => item.id === chosenClient) || activeClient;
                    return (
                      <>
                        <div className="fields">
                          <Field
                            label="Full name"
                            name="name"
                            defaultValue={c?.name || ''}
                            required
                            maxLength={100}
                          />
                          <Field
                            label="Customer ID (read only)"
                            name="code"
                            value={c?.customer_code || ''}
                            disabled
                          />
                        </div>
                        <div className="fields">
                          <Field
                            label="Mobile number"
                            name="phone"
                            type="tel"
                            defaultValue={c?.phone || ''}
                            maxLength={20}
                          />
                          <Field
                            label="Work"
                            name="work"
                            defaultValue={c?.work || ''}
                            maxLength={100}
                          />
                        </div>
                        <Field
                          label="Address"
                          name="address"
                          defaultValue={c?.address || ''}
                          maxLength={250}
                        />
                        <p className="fine">
                          Updates will be saved securely to the Supabase client records.
                        </p>
                      </>
                    );
                  })()}
                </>
              )}
              {modal === 'edit_loan' && (
                <>
                  {(() => {
                    const l = data.loans.find(item => item.id === chosenLoan);
                    const c = l ? data.clients.find(item => item.id === l.client_id) : null;
                    return (
                      <>
                        <p className="muted" style={{marginBottom: 16}}>
                          Update monthly interest rate for loan <strong>#{l?.id.slice(0, 8).toUpperCase()}</strong> ({c?.name}).
                        </p>
                        <div className="fields">
                          <Field
                            label="Originally borrowed"
                            name="orig_amount"
                            value={money(l?.original_principal || 0)}
                            disabled
                          />
                          <Field
                            label="New monthly interest rate (%)"
                            name="rate"
                            type="number"
                            defaultValue={l ? String(l.monthly_rate) : '2.0'}
                            required
                            min="0"
                            max="100"
                            step="0.0001"
                            autoFocus
                          />
                        </div>
                        <p className="fine">
                          The updated monthly interest rate applies to all future interest assessments and balance calculations.
                        </p>
                      </>
                    );
                  })()}
                </>
              )}
              {modal === 'delete_client' && (
                <>
                  {(() => {
                    const c =
                      data.clients.find(item => item.id === chosenClient) || activeClient;
                    const clientLoans = data.loans.filter(l => l.client_id === chosenClient);
                    const clientPayments = data.payments.filter(p =>
                      clientLoans.some(l => l.id === p.loan_id)
                    );
                    const totalBalance = clientLoans.reduce(
                      (acc, l) => acc + Number(l.balance.total),
                      0
                    );

                    return (
                      <div className="delete-confirm-box">
                        <div className="delete-warning-banner">
                          <strong>⚠️ Permanent Deletion Warning</strong>
                          <p style={{margin: '6px 0 0'}}>
                            You are about to permanently delete <strong>{c?.name}</strong> ({c?.customer_code}) and erase all records from the database.
                          </p>
                        </div>
                        {totalBalance > 0 && (
                          <div className="delete-outstanding-alert">
                            <strong>Active Balance Alert:</strong>
                            <p style={{margin: '4px 0 0'}}>
                              This client currently has an outstanding balance of{' '}
                              <strong>{money(totalBalance)}</strong>.
                            </p>
                          </div>
                        )}
                        <dl style={{margin: '14px 0', fontSize: 13, lineHeight: 1.8}}>
                          <dt style={{color: 'var(--muted)', fontWeight: 600}}>
                            Records to be erased:
                          </dt>
                          <dd>• {clientLoans.length} loan account(s)</dd>
                          <dd>• {clientPayments.length} repayment receipt(s)</dd>
                          <dd>• All monthly interest charges and questions</dd>
                          <dd>• Client secret wallet entry</dd>
                        </dl>
                        <p className="fine" style={{color: '#dc3545', margin: '8px 0 16px'}}>
                          This action is irreversible and cannot be undone.
                        </p>
                        <div style={{display: 'flex', gap: 10}}>
                          <button
                            type="button"
                            className="button secondary full"
                            onClick={() => close()}
                            disabled={saving}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="button danger full"
                            disabled={saving}
                          >
                            {saving ? 'Deleting permanently…' : 'Yes, Delete Everything'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
              {modal === 'purge_ledger' && (
                <div className="delete-confirm-box">
                  <div className="delete-warning-banner">
                    <strong>⚠️ Irreversible Permanent Purge Safeguard</strong>
                    <p style={{margin: '6px 0 0'}}>
                      You are about to permanently erase all client accounts, loans, payment receipts, secret wallet records, and client authentication accounts from Supabase.
                    </p>
                  </div>
                  <dl style={{margin: '14px 0', fontSize: 13, lineHeight: 1.8}}>
                    <dt style={{color: 'var(--muted)', fontWeight: 600}}>
                      Scope of ledger purge:
                    </dt>
                    <dd>• All client accounts and contact profiles</dd>
                    <dd>• All active and archived loan contracts</dd>
                    <dd>• All sequential payment receipts and interest assessments</dd>
                    <dd>• All support questions and wallet encryption items</dd>
                    <dd style={{color: '#34d399', fontWeight: 600}}>
                      ✓ Preserved: Owner administrative account ({profile?.email || 'owner'}) and system configurations
                    </dd>
                  </dl>
                  <div style={{margin: '12px 0'}}>
                    <label htmlFor="purge-confirmation-input" style={{color: '#f87171', fontWeight: 600}}>
                      Type <code>PURGE-VELMURUGAN-FINANCE</code> to confirm:
                    </label>
                    <input
                      id="purge-confirmation-input"
                      type="text"
                      value={purgeInput}
                      onChange={e => setPurgeInput(e.target.value)}
                      placeholder="PURGE-VELMURUGAN-FINANCE"
                      autoFocus
                      required
                      style={{
                        borderColor: purgeInput.trim() === 'PURGE-VELMURUGAN-FINANCE' ? '#34d399' : '#ef4444',
                        letterSpacing: '0.05em',
                        fontFamily: 'monospace'
                      }}
                    />
                  </div>
                  <p className="fine" style={{color: '#ef4444', margin: '8px 0 16px'}}>
                    This action is destructive and immediately executed on the database. Ensure you have downloaded an executive DOCX archive before proceeding.
                  </p>
                  <div style={{display: 'flex', gap: 10}}>
                    <button
                      type="button"
                      className="button secondary full"
                      onClick={() => close()}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="button danger full"
                      disabled={saving || purgeInput.trim() !== 'PURGE-VELMURUGAN-FINANCE'}
                    >
                      {saving ? 'Purging database…' : 'Yes, Purge Entire Ledger'}
                    </button>
                  </div>
                </div>
              )}
              {modal === 'loan' && (
                <>
                  <label htmlFor="loan-modal-client-select">Client</label>
                  <select
                    id="loan-modal-client-select"
                    name="client"
                    defaultValue={chosenClient}
                    required
                  >
                    <option value="">Select a client</option>
                    {data.clients
                      .filter(c => c.active)
                      .map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.customer_code}
                        </option>
                      ))}
                  </select>
                  <div className="fields">
                    <Field
                      label="Amount given (₹)"
                      name="amount"
                      type="number"
                      required
                      min="0.01"
                      max="100000000"
                      step="0.01"
                    />
                    <Field
                      label="Monthly rate (%)"
                      name="rate"
                      type="number"
                      required
                      min="0"
                      max="100"
                      step="0.0001"
                    />
                  </div>
                  <Field
                    label="Date given"
                    name="date"
                    type="date"
                    defaultValue={businessDate()}
                    max={businessDate()}
                    required
                  />
                  <label className="checkbox">
                    <input type="checkbox" name="approve" required />I confirm monthly simple
                    interest on remaining principal; first interest due at the next month’s end;
                    payments clear interest first; no compounding or extra late penalty.
                  </label>
                  <p className="fine">
                    A top-up creates a separate loan. For existing historical balances, use
                    the reviewed import procedure.
                  </p>
                </>
              )}
              {modal === 'payment' && (
                <>
                  <label htmlFor="payment-modal-loan-select">Loan</label>
                  <select
                    id="payment-modal-loan-select"
                    name="loan"
                    value={paymentLoan}
                    onChange={e => setPaymentLoan(e.target.value)}
                    required
                  >
                    <option value="">Select a loan</option>
                    {data.loans
                      .filter(l => Number(l.balance.total) > 0)
                      .map(l => (
                        <option key={l.id} value={l.id}>
                          {client(l.client_id)?.name} · {l.id.slice(0, 8)} ·{' '}
                          {money(l.balance.total)} (Principal: {money(l.balance.principal)},
                          Interest: {money(l.balance.interest)})
                        </option>
                      ))}
                  </select>

                  <label htmlFor="payment-modal-amount-input">
                    Amount received (₹)
                    <input
                      id="payment-modal-amount-input"
                      name="amount"
                      type="number"
                      required
                      min="0.01"
                      max={Math.min(
                        100000000,
                        Number(selectedPaymentLoan?.balance.total || 0)
                      )}
                      step="0.01"
                      value={paymentAmount}
                      onChange={e => setPaymentAmount(e.target.value)}
                      placeholder="Enter repayment amount"
                    />
                  </label>

                  {selectedPaymentLoan && (
                    <div className="repayment-calculator" aria-live="polite">
                      <div className="repayment-calc-head">
                        <span>Interest-First Allocation Preview</span>
                        <div className="repayment-quick-buttons">
                          {Number(selectedPaymentLoan.balance.interest) > 0 && (
                            <button
                              type="button"
                              className="quick-fill-btn"
                              onClick={() =>
                                setPaymentAmount(
                                  String(selectedPaymentLoan.balance.interest)
                                )
                              }
                            >
                              Interest: {money(selectedPaymentLoan.balance.interest)}
                            </button>
                          )}
                          <button
                            type="button"
                            className="quick-fill-btn"
                            onClick={() =>
                              setPaymentAmount(String(selectedPaymentLoan.balance.total))
                            }
                          >
                            Full Balance: {money(selectedPaymentLoan.balance.total)}
                          </button>
                        </div>
                      </div>
                      <div className="repayment-breakdown">
                        <div className="repayment-row">
                          <span>Outstanding Balance</span>
                          <strong>{money(selectedPaymentLoan.balance.total)}</strong>
                        </div>
                        <div className="repayment-row">
                          <small>• Accrued Interest Due</small>
                          <span className="money">
                            {money(selectedPaymentLoan.balance.interest)}
                          </span>
                        </div>
                        <div className="repayment-row">
                          <small>• Remaining Capital</small>
                          <span className="money">
                            {money(selectedPaymentLoan.balance.principal)}
                          </span>
                        </div>
                        <div className="repayment-row highlight">
                          <span>Payment Breakdown:</span>
                          <span />
                        </div>
                        <div className="repayment-row">
                          <span>1. Interest Cleared (100% first):</span>
                          <strong style={{color: 'var(--gold-text)'}}>
                            {money(interestPortion)}
                          </strong>
                        </div>
                        <div className="repayment-row">
                          <span>2. Capital Reduced:</span>
                          <strong style={{color: 'var(--teal-text)'}}>
                            {money(capitalPortion)}
                          </strong>
                        </div>
                        <div className="repayment-row highlight">
                          <span>New Remaining Principal:</span>
                          <strong style={{color: 'var(--navy)'}}>
                            {money(
                              Math.max(
                                0,
                                Number(selectedPaymentLoan.balance.principal) -
                                  capitalPortion
                              )
                            )}
                          </strong>
                        </div>
                      </div>
                      <p className="repayment-note">
                        Conforms to <code>monthly_remaining_v1</code>. Every payment clears
                        accrued interest before reducing outstanding principal.
                      </p>
                    </div>
                  )}

                  <div className="fields">
                    <label htmlFor="payment-modal-method-select">
                      Method
                      <select id="payment-modal-method-select" name="method">
                        <option value="cash">Cash</option>
                        <option value="bank">Bank transfer</option>
                        <option value="upi">UPI</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <Field label="Reference (optional)" name="reference" maxLength={200} />
                  </div>
                  <p className="fine">
                    Receipts cannot be deleted once recorded. A tamper-evident sequential ID
                    is assigned in Supabase.
                  </p>
                </>
              )}
              {modal === 'credentials' && (
                <>
                  <p className="muted">
                    Save the client password into your browser-encrypted secret wallet. The
                    wallet copy is encrypted in your browser before it is saved.
                  </p>
                  <label>
                    Password
                    <input
                      name="password"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={12}
                      maxLength={128}
                    />
                  </label>
                  <label>
                    Private notes for this client
                    <textarea
                      name="notes"
                      placeholder="Leave blank to keep existing wallet notes, or enter notes (e.g. Identity documents, guarantor details…)"
                      maxLength={20000}
                    />
                  </label>
                  <p className="fine">
                    Your financer wallet password never leaves your browser. Leaving private notes blank preserves any existing notes saved in the secret wallet.
                  </p>
                </>
              )}
              {modal === 'question' && (
                <>
                  {owner && (
                    <>
                      <label htmlFor="question-modal-client-select">Client</label>
                      <select
                        id="question-modal-client-select"
                        name="client"
                        defaultValue={chosenClient}
                        required
                      >
                        <option value="">Select a client</option>
                        {data.clients.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.customer_code}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  <Field label="Subject" name="subject" required maxLength={150} />
                  <label>
                    Your question
                    <textarea name="body" required maxLength={4000} />
                  </label>
                </>
              )}
              <ErrorText message={formError} />
              {modal !== 'delete_client' && modal !== 'purge_ledger' && (
                <button type="submit" className="button primary full" disabled={saving}>
                  <span>{saving ? 'Saving securely…' : 'Save to Supabase'}</span>
                  {!saving && <ArrowRightIcon size={14} />}
                </button>
              )}
            </form>
          )}
        </ModalFrame>
      )}

      {receipt && (
        <ModalFrame title="Payment receipt" onClose={() => setReceipt(null)}>
          <div className="receipt">
            <span className="eyebrow">VELMURUGAN FINANCE</span>
            <h2>{money(receipt.amount)}</h2>
            <p>Payment received · {date(receipt.paid_on)}</p>
            <dl>
              <dt>Receipt ID</dt>
              <dd>
                <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
                  <span>{receipt.id}</span>
                  <CopyButton text={receipt.id} label="Receipt ID" />
                </div>
              </dd>
              <dt>Client</dt>
              <dd>{client(loan(receipt.loan_id)?.client_id || '')?.name}</dd>
              <dt>Customer ID</dt>
              <dd>{client(loan(receipt.loan_id)?.client_id || '')?.customer_code}</dd>
              <dt>Loan</dt>
              <dd>{receipt.loan_id}</dd>
              <dt>Interest paid</dt>
              <dd>{money(receipt.interest_paid)}</dd>
              <dt>Capital paid</dt>
              <dd>{money(receipt.principal_paid)}</dd>
              <dt>Method / reference</dt>
              <dd>
                {receipt.method} · {receipt.reference || '—'}
              </dd>
            </dl>
            <button
              type="button"
              className="button secondary"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
          </div>
        </ModalFrame>
      )}

      {!owner && (
        <nav className="borrower-bottom-nav" aria-label="Borrower Navigation">
          <button
            type="button"
            className={'bottom-nav-item ' + (page === 'overview' ? 'active' : '')}
            onClick={() => {
              setPage('overview');
              setReceipt(null);
              window.scrollTo({top: 0, behavior: 'smooth'});
            }}
            aria-current={page === 'overview' ? 'page' : undefined}
          >
            <OverviewIcon size={20} />
            <span>Home</span>
          </button>
          <button
            type="button"
            className={'bottom-nav-item ' + (page === 'loans' ? 'active' : '')}
            onClick={() => {
              setPage('loans');
              setReceipt(null);
              window.scrollTo({top: 0, behavior: 'smooth'});
            }}
            aria-current={page === 'loans' ? 'page' : undefined}
          >
            <LoansIcon size={20} />
            <span>Loans</span>
          </button>
          <button
            type="button"
            className={'bottom-nav-item ' + (page === 'profile' ? 'active' : '')}
            onClick={() => {
              setPage('profile');
              setReceipt(null);
              window.scrollTo({top: 0, behavior: 'smooth'});
            }}
            aria-current={page === 'profile' ? 'page' : undefined}
          >
            <UserIcon size={20} />
            <span>Profile</span>
          </button>
        </nav>
      )}
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  subtitle,
  actions
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  feature,
  onClick
}: {
  label: string;
  value: string;
  hint?: string;
  feature?: boolean;
  onClick?: () => void;
}) {
  return (
    <section
      className={'stat ' + (feature ? 'feature' : '') + (onClick ? ' clickable' : '')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? e => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="stat-head">
        <p>{label}</p>
        {onClick && <span className="stat-arrow" aria-hidden="true">→</span>}
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </section>
  );
}

function ClientTable({
  clients,
  loans,
  onView,
  onDetail
}: {
  clients: Client[];
  loans: Loan[];
  onView: (id: string) => void;
  onDetail?: (c: Client) => void;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Capital</th>
            <th>Interest</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {clients.map(c => {
            const ls = loans.filter(l => l.client_id === c.id);
            return (
              <tr key={c.id}>
                <td>
                  <div
                    className="person"
                    style={{cursor: onDetail ? 'pointer' : 'default'}}
                    onClick={() => onDetail && onDetail(c)}
                  >
                    <span className="avatar">{c.name[0]}</span>
                    <div>
                      <strong>{c.name}</strong>
                      <small>{c.customer_code}</small>
                    </div>
                  </div>
                </td>
                <td>
                  {money(ls.reduce((n, l) => n + Number(l.balance.principal), 0))}
                </td>
                <td>
                  {money(ls.reduce((n, l) => n + Number(l.balance.interest), 0))}
                </td>
                <td>
                  <div style={{display: 'flex', gap: 6, alignItems: 'center'}}>
                    {onDetail && (
                      <button
                        type="button"
                        className="button secondary small"
                        onClick={() => onDetail(c)}
                      >
                        Details
                      </button>
                    )}
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onView(c.id)}
                    >
                      Loans <ChevronRightIcon size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!clients.length && <p className="empty">No client records yet.</p>}
    </div>
  );
}

function LoanCards({
  loans,
  clients,
  owner,
  onPayment,
  onEditRate
}: {
  loans: Loan[];
  clients: Client[];
  owner: boolean;
  onPayment: (l: Loan) => void;
  onEditRate?: (l: Loan) => void;
}) {
  return (
    <div className="loan-grid">
      {loans.map(l => (
        <article className="loan-card" key={l.id}>
          <div className="panel-head">
            <div>
              <h2>{clients.find(c => c.id === l.client_id)?.name}</h2>
              <small>Loan {l.id.slice(0, 8).toUpperCase()}</small>
            </div>
            <span
              className={
                'badge ' + (Number(l.balance.interest) > 0 ? 'warm' : '')
              }
            >
              {Number(l.balance.total) === 0
                ? 'Settled'
                : Number(l.balance.interest) > 0
                ? 'Interest unpaid'
                : 'Active'}
            </span>
          </div>
          <div className="loan-facts">
            <Fact label="Originally borrowed" value={money(l.original_principal)} />
            <Fact label="Monthly rate" value={String(l.monthly_rate) + '%'} />
            <Fact label="Capital remaining" value={money(l.balance.principal)} />
            <Fact label="Unpaid interest" value={money(l.balance.interest)} />
            <Fact label="Total outstanding" value={money(l.balance.total)} />
            <Fact
              label="Next interest estimate"
              value={money(
                (Number(l.balance.principal) * Number(l.monthly_rate)) / 100
              )}
            />
            <Fact label="Borrowed on" value={date(l.disbursed_on)} />
            <Fact label="First interest due" value={date(l.first_due_on)} />
            <Fact
              label="Next interest due"
              value={
                Number(l.balance.principal) > 0
                  ? date(l.next_due_on)
                  : 'No further capital interest'
              }
            />
          </div>
          <p className="fine">
            Posted interest is due separately from capital. No principal instalment
            schedule or extra overdue penalty has been added.
          </p>
          {owner && (
            <div style={{display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap'}}>
              {Number(l.balance.total) > 0 && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onPayment(l)}
                >
                  <GetMoneyIcon size={15} /> Record repayment
                </button>
              )}
              {onEditRate && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onEditRate(l)}
                >
                  <RefreshIcon size={14} /> Change rate
                </button>
              )}
            </div>
          )}
        </article>
      ))}
      {!loans.length && <p className="empty">No loans match this account.</p>}
    </div>
  );
}

function Fact({label, value}: {label: string; value: string}) {
  return (
    <div>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {label: string}) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}

function ModalFrame({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="close"
          aria-label="Close dialog"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function QuestionThreads({
  queries,
  messages,
  clients,
  activeThreadId,
  onSelectThread,
  owner,
  onReload,
  notify,
  onAskQuestion
}: {
  queries: Question[];
  messages: Message[];
  clients: Client[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  owner: boolean;
  onReload: () => Promise<void>;
  notify: (msg: string) => void;
  onAskQuestion?: () => void;
}) {
  const current = queries.find(q => q.id === activeThreadId) || queries[0];
  const client = (id: string) => clients.find(c => c.id === id);
  const threadMessages = current ? messages.filter(m => m.query_id === current.id) : [];

  return (
    <div className="questions-layout">
      <section className="panel thread-list">
        <div className="panel-head">
          <h2>All threads</h2>
        </div>
        {!queries.length ? (
          <p className="empty">No questions asked yet.</p>
        ) : (
          queries.map(q => (
            <button
              type="button"
              key={q.id}
              className={
                'thread-item ' +
                (current?.id === q.id ? 'active' : '')
              }
              onClick={() => onSelectThread(q.id)}
            >
              <strong>{q.subject}</strong>
              <small>
                {client(q.client_id)?.name || 'Client'} · {date(q.created_at)}
              </small>
              <span className={'badge ' + (q.status === 'open' ? 'warm' : '')}>
                {q.status}
              </span>
            </button>
          ))
        )}
      </section>
      <section className="panel thread-view">
        {!current ? (
          <div className="panel-body">
            <p className="empty">Select a thread to view messages.</p>
            {onAskQuestion && (
              <button
                type="button"
                className="button primary"
                onClick={onAskQuestion}
                style={{marginTop: 12}}
              >
                <PlusIcon size={14} /> Ask a question
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="panel-head">
              <div>
                <h2>{current.subject}</h2>
                <small>
                  {client(current.client_id)?.name || 'Client'} · Started{' '}
                  {date(current.created_at)}
                </small>
              </div>
              {owner && current.status === 'open' && (
                <button
                  type="button"
                  className="button secondary small"
                  onClick={async () => {
                    try {
                      await rpc('finance_resolve_question', {
                        p_query: current.id
                      });
                      await onReload();
                      notify('Question marked resolved.');
                    } catch (e) {
                      notify(errorMessage(e));
                    }
                  }}
                >
                  Mark resolved
                </button>
              )}
            </div>
            <div className="thread-body">
              {threadMessages.map(m => (
                <div
                  key={m.id}
                  className={
                    'message ' +
                    (m.author === 'owner' ? 'from-owner' : 'from-client')
                  }
                >
                  <small>
                    {m.author === 'owner'
                      ? 'Financer'
                      : client(current.client_id)?.name || 'Client'}{' '}
                    · {date(m.created_at)}
                  </small>
                  <p>{m.body}</p>
                </div>
              ))}
              {current.status === 'open' ? (
                <form
                  className="reply-form"
                  onSubmit={async e => {
                    e.preventDefault();
                    const form = e.currentTarget;
                    const body = String(new FormData(form).get('reply'));
                    if (!body.trim()) return;
                    try {
                      await rpc('finance_reply_question', {
                        p_query: current.id,
                        p_body: body
                      });
                      form.reset();
                      await onReload();
                    } catch (err) {
                      notify(errorMessage(err));
                    }
                  }}
                >
                  <textarea
                    name="reply"
                    placeholder="Write a clear reply…"
                    required
                    maxLength={4000}
                  />
                  <button type="submit" className="button primary">
                    Send reply <ArrowRightIcon size={14} />
                  </button>
                </form>
              ) : (
                <p className="fine">This question has been marked resolved.</p>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function BorrowerHomeView({
  borrower,
  loans,
  payments,
  totals,
  onNavigate,
  onReceipt,
  onAskQuestion
}: {
  borrower?: Client;
  loans: Loan[];
  payments: Payment[];
  totals: {capital: number; interest: number; monthly: number};
  onNavigate: (page: Page) => void;
  onReceipt: (payment: Payment) => void;
  onAskQuestion: () => void;
}) {
  const overdueLoans = loans.filter(l => Number(l.balance.interest) > 0);
  const overdueCount = overdueLoans.length;
  const overdueAmount = overdueLoans.reduce(
    (sum, l) => sum + Number(l.balance.interest),
    0
  );
  const totalBalance = totals.capital + totals.interest;
  const recentPayments = payments.slice(0, 5);

  return (
    <>
      <PageIntro
        eyebrow="YOUR ACCOUNT, AT A GLANCE"
        title={'Hello, ' + (borrower?.name.split(' ')[0] || 'there') + '.'}
        subtitle="Your active loans, monthly interest status, and payment receipts."
        actions={
          <button
            type="button"
            className="button secondary"
            onClick={onAskQuestion}
          >
            <PlusIcon size={14} /> Ask a question
          </button>
        }
      />

      {overdueCount > 0 ? (
        <section className="borrower-hero-card overdue">
          <div className="borrower-hero-top">
            <div className="borrower-hero-badge overdue">
              <span className="hero-badge-dot" /> Overdue Posted Monthly Interest
            </div>
            <span className="borrower-hero-counter">
              {overdueCount} {overdueCount === 1 ? 'loan has' : 'loans have'} unpaid interest
            </span>
          </div>
          <div className="borrower-hero-amount-block">
            <strong className="borrower-hero-val">{money(overdueAmount)}</strong>
            <span className="borrower-hero-label">Total posted unpaid interest</span>
          </div>
          <p className="borrower-hero-desc">
            Simple interest is accrued monthly on remaining principal. Under our payment rules, your repayments automatically clear all posted unpaid interest before reducing capital.
          </p>
          <div className="borrower-hero-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => onNavigate('loans')}
            >
              View loans & monthly detail <ChevronRightIcon size={13} />
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={onAskQuestion}
            >
              Ask financer about balance
            </button>
          </div>
        </section>
      ) : (
        <section className="borrower-hero-card clear">
          <div className="borrower-hero-top">
            <div className="borrower-hero-badge clear">
              <CheckIcon size={14} /> All Monthly Interest Cleared
            </div>
            <span className="borrower-hero-counter">0 overdue charges</span>
          </div>
          <div className="borrower-hero-amount-block">
            <strong className="borrower-hero-val">{money(0)}</strong>
            <span className="borrower-hero-label">No posted unpaid interest</span>
          </div>
          <p className="borrower-hero-desc">
            All posted monthly interest charges are completely up to date. Next interest will accrue on your scheduled due date.
          </p>
        </section>
      )}

      <div className="stats">
        <Stat
          label="Remaining capital"
          value={money(totals.capital)}
          hint="Outstanding principal · Click to view loans"
          feature
          onClick={() => onNavigate('loans')}
        />
        <Stat
          label="Posted unpaid interest"
          value={money(totals.interest)}
          hint={
            overdueCount > 0
              ? `${overdueCount} loan(s) pending settlement`
              : 'All interest settled to date'
          }
          onClick={() => onNavigate('loans')}
        />
        <Stat
          label="Total outstanding balance"
          value={money(totalBalance)}
          hint="Principal plus unpaid interest"
          onClick={() => onNavigate('loans')}
        />
        <Stat
          label="Active loans"
          value={String(loans.length)}
          hint="Click to inspect monthly rate breakdown"
          onClick={() => onNavigate('loans')}
        />
      </div>

      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Your active loans</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => onNavigate('loans')}
            >
              View details <ChevronRightIcon size={13} />
            </button>
          </div>
          <div className="borrower-loan-list">
            {loans.map(l => (
              <div
                key={l.id}
                className="borrower-loan-item"
                onClick={() => onNavigate('loans')}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate('loans');
                  }
                }}
              >
                <div className="borrower-loan-item-head">
                  <strong>Loan #{l.id.slice(0, 8).toUpperCase()}</strong>
                  <span
                    className={
                      'badge ' + (Number(l.balance.interest) > 0 ? 'warm' : '')
                    }
                  >
                    {Number(l.balance.total) === 0
                      ? 'Settled'
                      : Number(l.balance.interest) > 0
                      ? 'Interest unpaid'
                      : 'Active'}
                  </span>
                </div>
                <div className="borrower-loan-item-metrics">
                  <div>
                    <small>Capital remaining</small>
                    <strong>{money(l.balance.principal)}</strong>
                  </div>
                  <div>
                    <small>Monthly rate</small>
                    <strong>{l.monthly_rate}%</strong>
                  </div>
                  <div>
                    <small>Unpaid interest</small>
                    <strong
                      style={{
                        color:
                          Number(l.balance.interest) > 0
                            ? 'var(--gold-text)'
                            : 'inherit'
                      }}
                    >
                      {money(l.balance.interest)}
                    </strong>
                  </div>
                </div>
              </div>
            ))}
            {!loans.length && <p className="empty">No active loans found.</p>}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Recent payment receipts</h2>
            <button
              type="button"
              className="text-button"
              onClick={() => onNavigate('loans')}
            >
              All receipts <ChevronRightIcon size={13} />
            </button>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Receipt / Date</th>
                  <th>Amount</th>
                  <th>Interest</th>
                  <th>Capital</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map(p => (
                  <tr key={p.id}>
                    <td>
                      <strong>#{p.id.slice(0, 8).toUpperCase()}</strong>
                      <small>{date(p.paid_on)} · {p.method}</small>
                    </td>
                    <td>{money(p.amount)}</td>
                    <td>{money(p.interest_paid)}</td>
                    <td>{money(p.principal_paid)}</td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onReceipt(p)}
                      >
                        <ReceiptIcon size={13} /> Receipt
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!recentPayments.length && (
              <p className="empty">No payment receipts recorded yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="borrower-notice-card">
        <div className="notice-icon">ℹ️</div>
        <div className="notice-content">
          <strong>Installment Calculations & Schedule Specifications</strong>
          <p>
            Installment calculation structures, amortization schedules, and borrower identity document uploads await user specifications. All loans currently operate under standard simple monthly interest with interest cleared prior to capital reduction.
          </p>
        </div>
      </div>
    </>
  );
}

function BorrowerLoansView({
  loans,
  payments,
  onReceipt,
  onAskQuestion
}: {
  loans: Loan[];
  payments: Payment[];
  onReceipt: (payment: Payment) => void;
  onAskQuestion: () => void;
}) {
  const totalOriginal = loans.reduce(
    (acc, l) => acc + Number(l.original_principal),
    0
  );
  const totalPrincipal = loans.reduce(
    (acc, l) => acc + Number(l.balance.principal),
    0
  );
  const totalInterest = loans.reduce(
    (acc, l) => acc + Number(l.balance.interest),
    0
  );
  const totalPaid = payments.reduce((acc, p) => acc + Number(p.amount), 0);

  return (
    <>
      <PageIntro
        eyebrow="CAPITAL & MONTHLY INTEREST"
        title="Your loans & payment history."
        subtitle="Detailed monthly interest rates, capital balance, and official payment receipts."
        actions={
          <button
            type="button"
            className="button secondary"
            onClick={onAskQuestion}
          >
            <PlusIcon size={14} /> Ask a question
          </button>
        }
      />

      <div className="stats">
        <Stat label="Total borrowed" value={money(totalOriginal)} />
        <Stat label="Capital remaining" value={money(totalPrincipal)} feature />
        <Stat label="Unpaid interest" value={money(totalInterest)} />
        <Stat label="Total repayments" value={money(totalPaid)} />
      </div>

      <div className="loan-grid">
        {loans.map(l => (
          <article className="loan-card" key={l.id}>
            <div className="panel-head">
              <div>
                <h2>Loan #{l.id.slice(0, 8).toUpperCase()}</h2>
                <small>Disbursed on {date(l.disbursed_on)}</small>
              </div>
              <span
                className={
                  'badge ' + (Number(l.balance.interest) > 0 ? 'warm' : '')
                }
              >
                {Number(l.balance.total) === 0
                  ? 'Settled'
                  : Number(l.balance.interest) > 0
                  ? 'Interest unpaid'
                  : 'Active'}
              </span>
            </div>
            <div className="loan-facts">
              <Fact label="Originally borrowed" value={money(l.original_principal)} />
              <Fact label="Monthly rate" value={String(l.monthly_rate) + '%'} />
              <Fact label="Capital remaining" value={money(l.balance.principal)} />
              <Fact label="Unpaid interest" value={money(l.balance.interest)} />
              <Fact label="Total outstanding" value={money(l.balance.total)} />
              <Fact
                label="Next interest estimate"
                value={money(
                  (Number(l.balance.principal) * Number(l.monthly_rate)) / 100
                )}
              />
              <Fact label="Borrowed on" value={date(l.disbursed_on)} />
              <Fact label="First interest due" value={date(l.first_due_on)} />
              <Fact
                label="Next interest due"
                value={
                  Number(l.balance.principal) > 0
                    ? date(l.next_due_on)
                    : 'No further capital interest'
                }
              />
            </div>
            <div className="borrower-allocation-note">
              <strong>Payment Allocation Rule:</strong>
              <span>
                {' '}Under monthly_remaining_v1, repayments clear posted unpaid interest first ({money(l.balance.interest)}), then reduce remaining capital.
              </span>
            </div>
          </article>
        ))}
        {!loans.length && <p className="empty">No loans found for this account.</p>}
      </div>

      <section className="panel" style={{marginTop: 24}}>
        <div className="panel-head">
          <div>
            <h2>Official payment receipts</h2>
            <small>{payments.length} receipts on record</small>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Receipt ID</th>
                <th>Paid on</th>
                <th>Amount</th>
                <th>Interest cleared</th>
                <th>Capital reduced</th>
                <th>Method / Reference</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => (
                <tr key={p.id}>
                  <td>
                    <strong>#{p.id.slice(0, 8).toUpperCase()}</strong>
                    <CopyButton text={p.id} label="ID" />
                  </td>
                  <td>{date(p.paid_on)}</td>
                  <td><strong>{money(p.amount)}</strong></td>
                  <td>{money(p.interest_paid)}</td>
                  <td>{money(p.principal_paid)}</td>
                  <td>{p.method} · {p.reference || '—'}</td>
                  <td>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => onReceipt(p)}
                    >
                      <ReceiptIcon size={13} /> Receipt
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!payments.length && (
            <p className="empty">No payments recorded yet.</p>
          )}
        </div>
      </section>

      <section className="panel" style={{marginTop: 20}}>
        <div className="panel-head">
          <h2>Questions regarding your loans?</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{marginBottom: 14}}>
            If you have questions about your monthly interest assessment, principal reduction, or receipt details, you can contact Velmurugan Finance directly.
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={onAskQuestion}
          >
            <PlusIcon size={14} /> Ask a question about your loans
          </button>
        </div>
      </section>
    </>
  );
}

function BorrowerProfileView({
  borrower,
  queries,
  messages,
  clients,
  activeThreadId,
  onSelectThread,
  onReload,
  notify,
  onAskQuestion
}: {
  borrower?: Client;
  queries: Question[];
  messages: Message[];
  clients: Client[];
  activeThreadId: string;
  onSelectThread: (id: string) => void;
  onReload: () => Promise<void>;
  notify: (msg: string) => void;
  onAskQuestion: () => void;
}) {
  return (
    <>
      <PageIntro
        eyebrow="BORROWER PROFILE & MESSAGES"
        title="Profile & communications."
        subtitle="Your registered borrower records, financer contact details, and direct questions."
        actions={
          <button
            type="button"
            className="button primary"
            onClick={onAskQuestion}
          >
            <PlusIcon size={14} /> Ask a question
          </button>
        }
      />

      <section className="panel borrower-profile-card">
        <div className="borrower-profile-header">
          <div className="borrower-profile-identity">
            <span className="avatar gold-avatar">
              {borrower?.name[0] || 'C'}
            </span>
            <div>
              <h3>{borrower?.name || 'Borrower'}</h3>
              <div className="client-detail-chips">
                <span className="pill account-code">
                  ID: {borrower?.customer_code || '—'}
                </span>
                {borrower?.customer_code && (
                  <CopyButton text={borrower.customer_code} label="ID" />
                )}
                {borrower?.phone && (
                  <>
                    <a
                      href={'tel:' + borrower.phone}
                      className="pill phone-link"
                      title="Call primary phone"
                    >
                      <PhoneIcon size={12} /> {borrower.phone}
                    </a>
                    <CopyButton text={borrower.phone} label="Phone" />
                  </>
                )}
                {borrower?.alternate_phone && (
                  <>
                    <a
                      href={'tel:' + borrower.alternate_phone}
                      className="pill phone-link"
                      title="Call alternate phone"
                    >
                      <PhoneIcon size={12} /> Alt: {borrower.alternate_phone}
                    </a>
                    <CopyButton text={borrower.alternate_phone} label="Alt phone" />
                  </>
                )}
                <span className={'badge ' + (borrower?.active ? '' : 'warm')}>
                  {borrower?.active ? 'Active' : 'Disabled'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="borrower-profile-grid">
          <div className="borrower-profile-field">
            <small>Full Name</small>
            <strong>{borrower?.name || '—'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Customer Account ID</small>
            <strong>{borrower?.customer_code || '—'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Primary Phone Number</small>
            <strong>{borrower?.phone || 'Not provided'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Alternate Phone Number</small>
            <strong>{borrower?.alternate_phone || 'Not provided'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Occupation / Work</small>
            <strong>{borrower?.work || 'Not specified'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Account Status</small>
            <strong style={{color: '#34d399'}}>Active & Verified</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Registered Address</small>
            <strong>{borrower?.address || 'Not specified'}</strong>
          </div>
          <div className="borrower-profile-field">
            <small>Account Created</small>
            <strong>{borrower?.created_at ? date(borrower.created_at) : '—'}</strong>
          </div>
        </div>

        {borrower && (
          <div className="borrower-contact-edit">
            <div className="borrower-contact-edit-head">
              <h4>Update contact phone numbers</h4>
              <p className="fine">
                Keep a primary mobile number and an optional backup number on file for account reminders.
              </p>
            </div>
            <ClientContactForm
              phone={borrower.phone || ''}
              alternatePhone={borrower.alternate_phone || ''}
              onSaved={async () => {
                await onReload();
                notify('Phone numbers saved.');
              }}
            />
          </div>
        )}
      </section>

      <div className="borrower-notice-card">
        <div className="notice-icon">🛡️</div>
        <div className="notice-content">
          <strong>Identity Fields & Document Verification</strong>
          <p>
            Borrower identity fields, KYC document uploads (e.g. Aadhaar, PAN card, address proofs), and photo capture await user specifications. Your existing records are securely maintained in Velmurugan Finance's protected ledger.
          </p>
        </div>
      </div>

      <section className="panel" style={{marginTop: 20}}>
        <div className="panel-head">
          <h2>Financer contact & office</h2>
        </div>
        <div className="financer-contact-grid">
          <div className="contact-item">
            <small>Lender / Firm</small>
            <strong>Velmurugan Finance</strong>
          </div>
          <div className="contact-item">
            <small>Primary Contact</small>
            <strong>Imran (Financer)</strong>
          </div>
          <div className="contact-item">
            <small>Support Email</small>
            <div style={{display: 'flex', alignItems: 'center', gap: 6}}>
              <strong>imran5426117@gmail.com</strong>
              <CopyButton text="imran5426117@gmail.com" label="Email" />
            </div>
          </div>
          <div className="contact-item">
            <small>Office Location</small>
            <strong>Salem, Tamil Nadu</strong>
          </div>
        </div>
      </section>

      <section className="panel" style={{marginTop: 20}}>
        <div className="panel-head">
          <h2>Inquiries & direct messages</h2>
          <button
            type="button"
            className="button secondary small"
            onClick={onAskQuestion}
          >
            <PlusIcon size={13} /> Ask question
          </button>
        </div>
        <QuestionThreads
          queries={queries}
          messages={messages}
          clients={clients}
          activeThreadId={activeThreadId}
          onSelectThread={onSelectThread}
          owner={false}
          onReload={onReload}
          notify={notify}
          onAskQuestion={onAskQuestion}
        />
      </section>
    </>
  );
}
