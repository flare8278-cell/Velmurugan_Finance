# Velmurugan Finance

Current deliverable: interactive local prototype with a Music Academy-inspired workspace, customer accounts, loan entry, interest-first repayments, collections and a borrower preview. Open index.html in a modern browser. Keep workspace.css beside it. No build is required for this prototype.

The main workspace uses Academy OS's plum sidebar, cream canvas, lavender accents and white cards. The original moving-globe landing page remains accessible through Public page. All records are fictional and browser-local; this is not live authentication, an encrypted vault or a cloud ledger.

ARCHITECTURE.md describes the planned React/TypeScript and Supabase production application. SETUP.md documents the prototype's finance assumptions and remaining setup.

The workspace now uses navy, teal and gold finance colours. A Supabase PostgreSQL backend foundation is implemented in supabase/migrations; see BACKEND.md for the API, access boundaries and remaining integration. The demo is not yet connected to this backend.

Run `python scripts/verify-backend.py` to test migrations, calculations, access isolation and concurrent payments in a disposable local PostgreSQL cluster. PostgreSQL tools are required; PG_BIN may point to their installation directory.

## Repository

Use a private owner-controlled repository. Do not commit credentials, customer records or backups. Authenticate GitHub through a scoped app connection. Never place a personal access token in source files, remote URLs or documentation. No GitHub token has been stored by this implementation.

## Next build stages

1. Finalise owner login and client password recovery/vault policy.
2. Scaffold production React application and local database migrations.
3. Implement session verification, client-ID login and server-enforced permissions.
4. Implement authoritative loan ledger and idempotent receipts.
5. Implement private questions, reviewed vault and tested backups.
6. Connect owner-controlled services, reconcile imports and pilot.

## Repository description

An FinTech Application
