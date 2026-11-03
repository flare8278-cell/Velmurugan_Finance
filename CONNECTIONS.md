# GitHub and Supabase connection status

Prepared 3 November 2026. Neither a remote push nor a cloud database deployment has happened yet.

## GitHub

Target: https://github.com/flare8278-cell/Velmurugan_Finance. The supplied repository is currently public. Its initial README and ignore file have been merged locally, preserving its initial commit. GitHub application access currently provides read but not push permission, and the local credential manager has no usable GitHub login. Enable this repository in the GitHub connection or authenticate Git locally before pushing. No force push is needed.

The local project can be committed independently of the connection. Credentials must never enter commits, Git remote URLs or configuration examples. Source spreadsheets, backup files, local environment files and Supabase CLI link metadata are excluded from Git.

## Supabase

Connect the Supabase plugin when offered in the chat. Then identify the finance project by URL or project reference. Before applying migrations, inspect the project's existing schemas and migration history. Prefer a new development project for this foundation. Existing financial data requires a backup and reviewed migration plan.

The plugin connection enables database management without pasting secret keys in chat. A project URL and publishable key are public application configuration; database passwords, service-role keys and personal access tokens are not.

For a local read-only reachability check, copy .env.example to .env.local and enter only the project URL and publishable key. Run `node scripts/check-supabase.mjs`. This contacts the public Auth settings endpoint without writing data. Passing this check does not make the demo interface use Supabase.

Migration: supabase/migrations/202611030001_finance_core.sql. This is a once-only migration for a fresh development schema. Never apply supabase/tests/bootstrap_local.sql to a real project; it is exclusively for the disposable PostgreSQL test runner.

After migration, validate policies through real Supabase API calls with separate user sessions. Bootstrap the single owner under controlled administration. Owner access deliberately stays blocked until the server-side email-verification flow is implemented. Login, account provisioning, wallet and UI integration still require implementation as described in BACKEND.md.
