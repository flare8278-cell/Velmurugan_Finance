import {useCallback, useEffect, useRef, useState} from 'react';
import type {FormEvent, ReactNode} from 'react';
import {Login, VerifyEmail, ErrorText} from './Auth';
import {api, businessDate, date, logout, money, rpc, supabase} from './api';
import {VaultPanel, download} from './VaultPanel';
import {encryptWalletRecord} from './vault';
import type {Client, Loan, Payment, Profile, Question, VaultRow, Workspace} from './types';

type Page =
  | 'overview'
  | 'clients'
  | 'loans'
  | 'collections'
  | 'questions'
  | 'wallet'
  | 'reports'
  | 'settings';
type Modal = 'client' | 'loan' | 'payment' | 'credentials' | 'question' | null;

const labels: Record<Page, string> = {
  overview: 'Overview',
  clients: 'Clients',
  loans: 'Loans',
  collections: 'Collections',
  questions: 'Questions',
  wallet: 'Secret wallet',
  reports: 'Statements',
  settings: 'Settings & backups'
};

const icons: Record<Page, string> = {
  overview: '▦',
  clients: '♙',
  loans: '↗',
  collections: '↙',
  questions: '☏',
  wallet: '◇',
  reports: '▤',
  settings: '⚙'
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
    setReceipt(null);
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
    if (profile && !owner && ['clients', 'wallet', 'settings'].includes(page)) {
      setPage('overview');
    }
  }, [profile, owner, page]);

  useEffect(() => {
    if (!vaultKey && modal === 'credentials') {
      setModal(null);
      setFormError('');
    }
  }, [vaultKey, modal]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const activity = () => {
      clearTimeout(timeout);
      if (vaultKey) timeout = setTimeout(() => setVaultKey(null), 5 * 60 * 1000);
    };
    const visible = () => {
      if (document.hidden) setVaultKey(null);
      else if (
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
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMobile(false);
        if (!saving) setModal(null);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
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
        const record = {
          customer_id: c.customer_code,
          name: c.name,
          phone: c.phone,
          password,
          notes: String(f.get('notes') || '')
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
        <p className="muted">Connecting securely…</p>
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
          <button
            type="button"
            className="button secondary"
            onClick={() => void refreshProfile()}
          >
            Try again
          </button>
          <button type="button" className="text-button" onClick={() => void signOut()}>
            Sign out
          </button>
        </section>
      </div>
    );
  }

  if (owner && !profile.verified) {
    return (
      <VerifyEmail profile={profile} onSuccess={refreshProfile} onLogout={signOut} />
    );
  }

  const totals = data.loans.reduce(
    (a, l) => ({
      capital: a.capital + Number(l.balance.principal),
      interest: a.interest + Number(l.balance.interest),
      monthly:
        a.monthly +
        (Number(l.balance.principal) * Number(l.monthly_rate)) / 100
    }),
    {capital: 0, interest: 0, monthly: 0}
  );

  const pages: Page[] = owner
    ? ['overview', 'clients', 'loans', 'collections', 'questions', 'wallet', 'reports', 'settings']
    : ['overview', 'loans', 'collections', 'questions', 'reports'];

  const client = (id: string) => data.clients.find(c => c.id === id);
  const loan = (id: string) => data.loans.find(l => l.id === id);
  const visibleClients = data.clients.filter(c =>
    [c.name, c.customer_code, c.phone].some(v =>
      v.toLowerCase().includes(search.toLowerCase())
    )
  );
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
              <th>Receipt / date</th>
              {owner && <th>Client</th>}
              <th>Received</th>
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
                    Receipt ↗
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
    <div className="app-shell">
      <aside className={'sidebar ' + (mobile ? 'open' : '')}>
        <a
          className="brand"
          href="#"
          onClick={e => {
            e.preventDefault();
            setPage('overview');
          }}
        >
          <span className="brand-mark">V</span>
          <div>
            Finance<span className="gold"> OS</span>
            <small>VELMURUGAN CAPITAL</small>
          </div>
        </a>
        <div className="business-switch">
          <span className="avatar">V</span>
          <div>
            <strong>Velmurugan Finance</strong>
            <small>{owner ? 'Financer workspace' : 'Your private account'}</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
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
            >
              <span>{icons[p]}</span>
              {!owner && p === 'overview'
                ? 'My account'
                : !owner && p === 'collections'
                ? 'Payment history'
                : labels[p]}
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
            Workspace <span>/ {labels[page]}</span>
          </div>
          <div className="topbar-actions">
            <span className="date-label">{date(businessDate())}</span>
            <button
              type="button"
              className="text-button"
              disabled={loading}
              onClick={() => void reload()}
            >
              {loading ? 'Refreshing…' : '↻ Refresh'}
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
                <>
                  <PageIntro
                    eyebrow={owner ? 'YOUR BUSINESS, AT A GLANCE' : 'YOUR ACCOUNT, IN VIEW'}
                    title={
                      owner
                        ? 'Good to see you.'
                        : 'Hello, ' + (data.clients[0]?.name.split(' ')[0] || 'there') + '.'
                    }
                    subtitle="Your loans, payments and next steps in one place."
                    actions={
                      owner ? (
                        <>
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => open('payment')}
                          >
                            ↙ Get money
                          </button>
                          <button
                            type="button"
                            className="button primary"
                            onClick={() => open('loan')}
                          >
                            ↗ Give money
                          </button>
                        </>
                      ) : null
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
                      {owner
                        ? 'Keep every client’s financial journey organised. Your records are saved securely in Supabase.'
                        : 'Know your remaining capital, interest and payment history, wherever you are.'}
                    </p>
                    <span aria-hidden="true">₹</span>
                  </section>
                  <div className="stats">
                    <Stat
                      label="Capital remaining"
                      value={money(totals.capital)}
                      hint="After principal repayments"
                      feature
                    />
                    <Stat
                      label="Unpaid interest"
                      value={money(totals.interest)}
                      hint="Posted charges less payments"
                    />
                    <Stat
                      label="Next interest estimate"
                      value={money(totals.monthly)}
                      hint="At current capital and rates"
                    />
                    <Stat
                      label={owner ? 'Clients' : 'Your loans'}
                      value={String(owner ? data.clients.length : data.loans.length)}
                      hint={owner ? 'Individual client records' : 'Separate rates and due dates'}
                    />
                  </div>
                  <div className="dashboard-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>{owner ? 'Client accounts' : 'Your loans'}</h2>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setPage(owner ? 'clients' : 'loans')}
                        >
                          View all →
                        </button>
                      </div>
                      {owner ? (
                        <ClientTable
                          clients={data.clients.slice(0, 5)}
                          loans={data.loans}
                          onView={id => {
                            setChosenClient(id);
                            setPage('loans');
                          }}
                        />
                      ) : (
                        <LoanCards
                          loans={data.loans}
                          clients={data.clients}
                          owner={false}
                          onPayment={() => {}}
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Your next steps</h2>
                      </div>
                      <div className="panel-body steps">
                        {owner ? (
                          <>
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
                          </>
                        ) : (
                          <>
                            <p>Payments clear unpaid interest first, then capital.</p>
                            <p>Your first interest is due at the end of the month after borrowing.</p>
                            <p>No additional late penalty is applied to these loans.</p>
                          </>
                        )}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setPage(owner ? 'wallet' : 'questions')}
                        >
                          {owner ? 'Open secret wallet' : 'Ask a question'} →
                        </button>
                      </div>
                    </section>
                  </div>
                </>
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
                        + Add client
                      </button>
                    }
                  />
                  <section className="panel">
                    <div className="panel-head">
                      <h2>
                        Client directory <small>{data.clients.length} records</small>
                      </h2>
                      <input
                        className="search"
                        placeholder="Search name, ID or phone…"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        aria-label="Search clients"
                      />
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Client</th>
                            <th>ID / contact</th>
                            <th>Login</th>
                            <th>Access</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleClients.map(c => (
                            <tr key={c.id}>
                              <td>
                                <div className="person">
                                  <span className="avatar">{c.name[0]}</span>
                                  <div>
                                    <strong>{c.name}</strong>
                                    <small>{c.address || 'Address not provided'}</small>
                                    <small>{c.work}</small>
                                  </div>
                                </div>
                              </td>
                              <td>
                                {c.customer_code}
                                <small>{c.phone || 'Phone not provided'}</small>
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
                                    onClick={() => {
                                      if (!vaultKey) {
                                        setPage('wallet');
                                        notify(
                                          'Unlock the wallet first to securely save the password.'
                                        );
                                      } else open('credentials', c.id);
                                    }}
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
                          No matching clients. Add your first client to get started.
                        </p>
                      )}
                    </div>
                  </section>
                </>
              )}
              {page === 'loans' && (
                <>
                  <PageIntro
                    eyebrow="CAPITAL & TERMS"
                    title={owner ? 'Your loans.' : 'Loan details.'}
                    subtitle="Separate balances, rates and due dates for every loan."
                    actions={
                      owner ? (
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => open('loan', chosenClient)}
                        >
                          ↗ Give money
                        </button>
                      ) : null
                    }
                  />
                  {owner && (
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
                  )}
                  <LoanCards
                    loans={data.loans.filter(
                      l => !chosenClient || l.client_id === chosenClient
                    )}
                    clients={data.clients}
                    owner={owner}
                    onPayment={l => open('payment', l.client_id, l.id)}
                  />
                </>
              )}
              {page === 'collections' && (
                <>
                  <PageIntro
                    eyebrow="EVERY PAYMENT ACCOUNTED FOR"
                    title={owner ? 'Your collections.' : 'Payment history.'}
                    subtitle="Interest and principal are recorded separately on every receipt."
                    actions={
                      owner ? (
                        <button
                          type="button"
                          className="button primary"
                          onClick={() => open('payment')}
                        >
                          ↙ Get money
                        </button>
                      ) : null
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
                      label="Interest collected"
                      value={money(
                        data.payments.reduce((n, p) => n + Number(p.interest_paid), 0)
                      )}
                    />
                    <Stat
                      label="Capital recovered"
                      value={money(
                        data.payments.reduce((n, p) => n + Number(p.principal_paid), 0)
                      )}
                    />
                    <Stat label="Receipts" value={String(data.payments.length)} />
                  </div>
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Payment ledger</h2>
                    </div>
                    {transactionTable(data.payments)}
                  </section>
                </>
              )}
              {page === 'questions' && (
                <>
                  <PageIntro
                    eyebrow="A PRIVATE CONVERSATION"
                    title={owner ? 'Client questions.' : 'Your questions.'}
                    subtitle="Questions and replies are visible only to the client and financer."
                    actions={
                      <button
                        type="button"
                        className="button primary"
                        onClick={() => open('question')}
                      >
                        + New question
                      </button>
                    }
                  />
                  <div className="questions-layout">
                    <section className="panel thread-list">
                      {data.queries.map(q => (
                        <button
                          type="button"
                          key={q.id}
                          className={thread === q.id ? 'selected' : ''}
                          onClick={() => setThread(q.id)}
                        >
                          <strong>{q.subject}</strong>
                          <small>
                            {owner ? client(q.client_id)?.name : date(q.created_at)}
                          </small>
                          <span className={'badge ' + (q.status === 'open' ? 'warm' : '')}>
                            {q.status}
                          </span>
                        </button>
                      ))}
                      {!data.queries.length && <p className="empty">No questions yet.</p>}
                    </section>
                    <section className="panel">
                      {data.queries.find(q => q.id === thread) ? (
                        (() => {
                          const q = data.queries.find(q => q.id === thread)!;
                          return (
                            <>
                              <div className="panel-head">
                                <h2>{q.subject}</h2>
                                {owner && (
                                  <button
                                    type="button"
                                    className="text-button"
                                    onClick={async () => {
                                      try {
                                        await rpc('finance_resolve_question', {
                                          p_query: q.id,
                                          p_resolved: q.status !== 'resolved'
                                        });
                                        await reload();
                                      } catch (e) {
                                        notify(errorMessage(e));
                                      }
                                    }}
                                  >
                                    {q.status === 'resolved' ? 'Reopen' : 'Resolve'}
                                  </button>
                                )}
                              </div>
                              <div className="messages">
                                {data.messages
                                  .filter(m => m.query_id === q.id)
                                  .map(m => (
                                    <article
                                      key={m.id}
                                      className={
                                        m.author === profile.client_id
                                          ? 'message client-message'
                                          : 'message'
                                      }
                                    >
                                      <small>
                                        {data.clients.some(c => c.auth_user_id === m.author)
                                          ? 'Client'
                                          : 'Financer'}{' '}
                                        · {date(m.created_at)}
                                      </small>
                                      <p>{m.body}</p>
                                    </article>
                                  ))}
                              </div>
                              {q.status === 'open' ? (
                                <form
                                  className="reply-form"
                                  onSubmit={async e => {
                                    e.preventDefault();
                                    const form = e.currentTarget;
                                    setSaving(true);
                                    try {
                                      await rpc('finance_reply_question', {
                                        p_query: q.id,
                                        p_body: new FormData(form).get('body')
                                      });
                                      form.reset();
                                      await reload();
                                    } catch (e) {
                                      notify(errorMessage(e));
                                    } finally {
                                      setSaving(false);
                                    }
                                  }}
                                >
                                  <label>
                                    Your reply
                                    <textarea
                                      name="body"
                                      required
                                      minLength={1}
                                      maxLength={4000}
                                    />
                                  </label>
                                  <button
                                    type="submit"
                                    className="button primary"
                                    disabled={saving}
                                  >
                                    Send reply →
                                  </button>
                                </form>
                              ) : (
                                <p className="empty">This question has been resolved.</p>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        <p className="empty">Choose a question to read the conversation.</p>
                      )}
                    </section>
                  </div>
                </>
              )}
              {page === 'wallet' && owner && (
                <VaultPanel
                  row={vaultRow}
                  setRow={setVaultRow}
                  keyValue={vaultKey}
                  setKey={setVaultKey}
                  clients={data.clients}
                  onChanged={() => notify('Encrypted wallet record saved.')}
                />
              )}
              {page === 'reports' && (
                <>
                  <PageIntro
                    eyebrow="A COMPLETE RECORD"
                    title="Account statements."
                    subtitle="Review loans, interest and receipts together."
                    actions={
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => window.print()}
                      >
                        Print / Save PDF
                      </button>
                    }
                  />
                  <div className="filter-group">
                    <label htmlFor="reports-client-select" className="filter">
                      Client
                    </label>
                    <select
                      id="reports-client-select"
                      value={chosenClient}
                      onChange={e => setChosenClient(e.target.value)}
                    >
                      <option value="">{owner ? 'All clients' : 'My account'}</option>
                      {data.clients.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.name} · {c.customer_code}
                        </option>
                      ))}
                    </select>
                  </div>
                  {data.clients
                    .filter(c => !chosenClient || c.id === chosenClient)
                    .map(c => (
                      <section className="panel statement" key={c.id}>
                        <div className="panel-head">
                          <div>
                            <h2>{c.name}</h2>
                            <small>
                              {c.customer_code} · As of {date(data.business_date)}
                            </small>
                          </div>
                        </div>
                        <LoanCards
                          loans={data.loans.filter(l => l.client_id === c.id)}
                          clients={data.clients}
                          owner={false}
                          onPayment={() => {}}
                        />
                        {transactionTable(
                          data.payments.filter(p => loan(p.loan_id)?.client_id === c.id)
                        )}
                      </section>
                    ))}
                </>
              )}
              {page === 'settings' && owner && (
                <>
                  <PageIntro
                    eyebrow="BUILT ON TRUST"
                    title="Settings & backups."
                    subtitle="Account protection, records and recovery."
                  />
                  <section className="panel settings-copy">
                    <h2>Your connected workspace</h2>
                    <p>
                      Financial records are stored in Supabase. The browser holds your login
                      session for this tab, not an offline copy of the financial database.
                      Always refresh before acting on a balance.
                    </p>
                    <h2>Loan calculation policy</h2>
                    <p>
                      Each loan has its own financer-set monthly rate. First interest is due
                      at the end of the next month. Whole-month simple interest uses
                      remaining principal; payments clear posted interest first. Unpaid
                      interest is separate, without compounding or an additional late penalty.
                      Each loan requires explicit agreement to these terms.
                    </p>
                    <h2>Business record export</h2>
                    <p>
                      Download a private copy of the current client and transaction records.
                      This export does not contain authentication data or constitute a
                      complete database backup.
                    </p>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        download('velmurugan-business-records-' + businessDate() + '.json', {
                          application: 'Velmurugan Finance',
                          exportedAt: new Date().toISOString(),
                          ...data
                        })
                      }
                    >
                      Download business records
                    </button>
                    <h2>Full backup and restore</h2>
                    <p>
                      Use the encrypted database backup procedure in the repository to back up
                      database data, schema and access policies. Keep a second encrypted copy
                      away from this laptop. Check backup success daily and test restoration
                      before relying on the system for real records.
                    </p>
                    <h2>Wallet recovery</h2>
                    <p>
                      The wallet locks automatically when this tab is hidden or after five
                      minutes without activity. Store its recovery kit privately. Neither the
                      financer login password nor a database administrator can recover
                      encrypted contents without the wallet password or recovery kit.
                    </p>
                    <h2>Corrections</h2>
                    <p>
                      Receipts are permanent records. Backdated payments, reversals and rate
                      changes require a reviewed accounting correction; editing a balance
                      directly is not available.
                    </p>
                  </section>
                </>
              )}
            </>
          )}
          <footer>
            Velmurugan Finance · Every transaction accounted for.
            <span>Supabase · Secure account records</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div role="status" className="toast">
          {toast}
        </div>
      )}
      {modal && (
        <ModalFrame
          title={
            {
              client: 'Add a client',
              loan: 'Give money',
              payment: 'Get money',
              credentials: 'Client login & secret wallet',
              question: 'Ask a question'
            }[modal]
          }
          onClose={() => {
            if (!saving) setModal(null);
          }}
        >
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
                        {money(l.balance.total)}
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
                  />
                </label>
                <div className="allocation">
                  <p>
                    Interest: <strong>{money(interestPortion)}</strong>
                  </p>
                  <p>
                    Capital: <strong>{money(capitalPortion)}</strong>
                  </p>
                  <small>
                    Preview only. The server checks the current balance when saving.
                  </small>
                </div>
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
                  Payment date: {date(businessDate())}. Current-date receipts only.
                </p>
              </>
            )}
            {modal === 'credentials' && (
              <>
                <p className="muted">
                  {client(chosenClient)?.name} · {client(chosenClient)?.customer_code}
                </p>
                <Field
                  label="Client password"
                  name="password"
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
                <label>
                  Private notes
                  <textarea name="notes" maxLength={20000} />
                </label>
                <p className="fine">
                  The password is stored as an Auth hash and as a separately encrypted copy
                  in your wallet. A reset revokes existing client sessions. Share the ID and
                  password privately.
                </p>
              </>
            )}
            {modal === 'question' && (
              <>
                {owner && (
                  <>
                    <label htmlFor="question-modal-client-select">Client</label>
                    <select id="question-modal-client-select" name="client" required>
                      <option value="">Select client</option>
                      {data.clients.map(c => (
                        <option value={c.id} key={c.id}>
                          {c.name}
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
            <button type="submit" className="button primary full" disabled={saving}>
              {saving ? 'Saving securely…' : 'Save to Supabase →'}
            </button>
          </form>
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
              <dd>{receipt.id}</dd>
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
  feature
}: {
  label: string;
  value: string;
  hint?: string;
  feature?: boolean;
}) {
  return (
    <section className={'stat ' + (feature ? 'feature' : '')}>
      <p>{label}</p>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </section>
  );
}

function ClientTable({
  clients,
  loans,
  onView
}: {
  clients: Client[];
  loans: Loan[];
  onView: (id: string) => void;
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
                  <div className="person">
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
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onView(c.id)}
                  >
                    View ↗
                  </button>
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
  onPayment
}: {
  loans: Loan[];
  clients: Client[];
  owner: boolean;
  onPayment: (l: Loan) => void;
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
          {owner && Number(l.balance.total) > 0 && (
            <button
              type="button"
              className="button secondary"
              onClick={() => onPayment(l)}
            >
              ↙ Record repayment
            </button>
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
