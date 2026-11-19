import {createClient} from '@supabase/supabase-js';
import type {Session} from '@supabase/supabase-js';
import publicConfig from '../public-config.json' with {type: 'json'};

export const projectUrl =
  import.meta.env?.VITE_SUPABASE_URL || publicConfig.supabaseUrl;
const key =
  import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || publicConfig.supabasePublishableKey;

export const configured = Boolean(key);

export const supabase = createClient(projectUrl, key || 'not-configured', {
  auth: {
    persistSession: true,
    storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'velmurugan-auth'
  }
});

export async function api(action: string, body: Record<string, unknown> = {}) {
  const {
    data: {session}
  } = await supabase.auth.getSession();
  const response = await fetch(projectUrl + '/functions/v1/finance-api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: key || '',
      ...(session ? {Authorization: 'Bearer ' + session.access_token} : {})
    },
    body: JSON.stringify({action, ...body})
  });
  const data = await response.json();
  if (!response.ok) {
    throw Error(data.error || 'The server could not complete this request.');
  }
  return data;
}

export async function signIn(kind: 'owner' | 'client', identifier: string, password: string) {
  const data = await api(
    kind + '-login',
    kind === 'owner' ? {email: identifier, password} : {customer_id: identifier, password}
  );
  const result = await supabase.auth.setSession(data.session);
  if (result.error) throw result.error;
  return result.data.session as Session;
}

export async function rpc<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  const {data, error} = await supabase.rpc(name, params);
  if (error) throw Error(error.message);
  return data as T;
}

export async function logout() {
  try {
    await rpc('finance_lock_session');
  } catch {}
  try {
    await supabase.auth.signOut({scope: 'local'});
  } finally {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem('velmurugan-auth');
    }
  }
}

export const businessDate = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

export const money = (value: number | string) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2
  }).format(Number(value));

export const date = (value: string) =>
  value
    ? new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
      })
    : '—';
