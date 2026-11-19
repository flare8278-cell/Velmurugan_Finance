import type {CipherEnvelope, VaultMetadata} from './vault';

export type Page =
  | 'overview'
  | 'clients'
  | 'loans'
  | 'collections'
  | 'questions'
  | 'wallet'
  | 'reports'
  | 'settings';

export type Profile = {
  role: 'owner' | 'client';
  active: boolean;
  email: string;
  verified: boolean;
  session_live: boolean;
  client_id: string | null;
  client_active: boolean | null;
};

export type Client = {
  id: string;
  customer_code: string;
  name: string;
  phone: string;
  address: string;
  work: string;
  auth_user_id: string | null;
  active: boolean;
  created_at: string;
};

export type Loan = {
  id: string;
  client_id: string;
  original_principal: number;
  monthly_rate: number;
  disbursed_on: string;
  first_due_on: string;
  next_due_on: string;
  balance: {
    principal: number;
    interest: number;
    total: number;
  };
};

export type Payment = {
  id: string;
  loan_id: string;
  amount: number;
  interest_paid: number;
  principal_paid: number;
  paid_on: string;
  method: string;
  reference: string;
  created_at: string;
};

export type Question = {
  id: string;
  client_id: string;
  subject: string;
  status: 'open' | 'resolved';
  created_at: string;
};

export type Message = {
  id: string;
  query_id: string;
  author: string;
  body: string;
  created_at: string;
};

export type Workspace = {
  clients: Client[];
  loans: Loan[];
  payments: Payment[];
  queries: Question[];
  messages: Message[];
  charges: unknown[];
  refreshed_at: string;
  business_date: string;
};

export type VaultRow = {
  owner_id: string;
  envelope: VaultMetadata;
  updated_at: string;
};

export type VaultItem = {
  client_id: string;
  envelope: CipherEnvelope;
};
