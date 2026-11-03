# Backend foundation

Core schema deployed to Supabase project `querjeebfguwnhhgpwxm` (Velmurugan Finance), 3 November 2026. The demo interface is not yet integrated with live authentication or financial records.

Cloud verification passed: public Auth endpoint reachable with publishable key; all eight public finance tables have RLS enabled; anonymous SELECT and authenticated direct INSERT are denied. A transaction-wrapped cloud test created a temporary owner/client/loan, verified a ₹5,000 charge and a ₹7,000 interest-first receipt reducing principal to ₹98,000, and rolled all fixtures back. An unverified caller was denied owner operations.

Security advisor flags the four authenticated SECURITY DEFINER RPCs. They are intentional privileged entrypoints with fixed search_path and explicit owner/client scope checks, and anonymous execution is revoked. This is an acknowledged review item, not a claim of a warning-free security audit. See https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable. Performance follow-up adds missing foreign-key indexes and wraps the profile auth lookup in a scalar SELECT. Remaining unused-index INFO notices are expected in an empty database.

Migration history was created by Supabase MCP: cloud version 20261103044201 maps to local 202611030001_finance_core.sql. Consult the cloud migration list before future CLI pushes; reconcile this legacy local timestamp before treating CLI migration history as authoritative. No real borrower records or passwords were imported.

## Database migration

`supabase/migrations/202611030001_finance_core.sql` creates clients, profiles, loans, interest charges, payments with principal/interest allocations, private session verification grants, audit records and read-only question-thread tables. Row-level security applies to every exposed table. One owner profile is allowed. No anonymous data access or direct financial writes are granted.

RPCs available to authenticated callers:

- finance_create_client(p_code, p_name, p_phone, p_address, p_work)
- finance_create_loan(p_client, p_amount, p_rate, p_date, p_terms_approved)
- finance_loan_snapshot(p_loan)
- finance_record_payment(p_request, p_loan, p_amount, p_date, p_method, p_reference)

Monetary amounts are PostgreSQL numeric decimals. Every receipt includes the original payment, interest paid, principal paid, actor and a UUID receipt ID. Backend allocation is authoritative. Same-loan mutations lock the loan; concurrent retries lock the request ID. A changed payload using an existing request ID is rejected.

## Implemented calculation policy

Only `monthly_remaining_v1` is implemented: a whole monthly charge on remaining principal, first due at the following calendar month's end, simple interest without compounding or penalties, interest first then principal, monthly charges rounded to paise. A loan requires explicit approval of these terms. No automatic amount/rate schedule is assumed. Rates are set per loan and immutable through the current API. Due posting catches up when snapshots or payments are requested and uses one charge per loan/due date. There is no scheduled job yet.

Current-date payments only. Backdated receipts, waivers, rate changes, reversals, imported opening balances and financial corrections are deliberately not exposed until their full accounting policies are implemented. Original borrowing date cannot be used as a substitute for an existing loan's reconciled opening position.

## Authentication boundary

Supabase Auth integration is not yet implemented in the UI. Owner access fails closed unless a trusted backend has issued an unexpired verification grant matching both owner user ID and JWT session ID. No browser permission exists to create that grant. The email-code sender/verifier, client-ID login adapter, provisioning/reset operations and account recovery are pending. Do not manually insert verification grants in production as a substitute for the email check.

Production bootstrap requires a real Supabase Auth owner user and one controlled profile insertion. Client identity linking also needs privileged verified-owner administration; no public self-link endpoint exists. Keep service credentials exclusively in backend secret storage. Disable public account registration during provisioning design.

The secret wallet is not implemented. Do not store client passwords or other secrets in these ordinary tables. Query tables support isolated reads only; writing/replying/resolving requires the next set of validated operations.

## Testing

Tests use an isolated PostgreSQL cluster with minimal mock `auth.uid()` / `auth.jwt()` and auth users. This validates SQL and RLS but does not replace tests against actual Supabase Auth and PostgREST before launch. `supabase/tests/bootstrap_local.sql` must NEVER run in a real Supabase project.

Run the migration once in a fresh development Supabase project or local Supabase stack. Do not apply it blindly to an existing financial database. The SQL test file is transaction-wrapped and rolls back its fixtures.

## Next integration steps

1. Configure owner-controlled Supabase development project and production email provider.
2. Implement session-bound owner email verification, client-ID login and safe account provisioning/recovery.
3. Connect a React production interface to the RPCs; show server results and explicit errors.
4. Add validated question operations, receipts/statements and controlled financial corrections.
5. Implement and test separate encrypted wallet plus recovery.
6. Configure independent backups, restore testing and reviewed import before live use.

The GitHub app currently exposes a different repository; finance repository access is not configured. No exposed personal access token has been used or saved. No code has been pushed remotely.
