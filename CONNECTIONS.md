# GitHub and Supabase connection status

Updated 3 November 2026. Application source was uploaded to GitHub main (15abfb8), and the core database schema is now deployed to the connected Supabase finance project.

## GitHub

Target: https://github.com/flare8278-cell/Velmurugan_Finance. The GitHub connection now has confirmed write access under flare8278-cell. Application source was uploaded to main while preserving the starter commit. The repository is currently public; no secret keys or borrower data were uploaded.

The local project can be committed independently of the connection. Credentials must never enter commits, Git remote URLs or configuration examples. Source spreadsheets, backup files, local environment files and Supabase CLI link metadata are excluded from Git.

## Supabase

Supabase is connected: project `querjeebfguwnhhgpwxm`, URL https://querjeebfguwnhhgpwxm.supabase.co, name Velmurugan Finance, region eu-west-1. The project was inspected and had no application tables or migration history before deployment. Core schema and access-index migrations were applied and verified. No paid project or branch was created.

The plugin connection enables database management without pasting secret keys in chat. A project URL and publishable key are public application configuration; database passwords, service-role keys and personal access tokens are not.

For a local read-only reachability check, copy .env.example to .env.local and enter only the project URL and publishable key. Run `node scripts/check-supabase.mjs`. This contacts the public Auth settings endpoint without writing data. Passing this check does not make the demo interface use Supabase.

Migration: supabase/migrations/202611030001_finance_core.sql. This is a once-only migration for a fresh development schema. Never apply supabase/tests/bootstrap_local.sql to a real project; it is exclusively for the disposable PostgreSQL test runner.

After migration, validate policies through real Supabase API calls with separate user sessions. Bootstrap the single owner under controlled administration. Owner access deliberately stays blocked until the server-side email-verification flow is implemented. Login, account provisioning, wallet and UI integration still require implementation as described in BACKEND.md.
