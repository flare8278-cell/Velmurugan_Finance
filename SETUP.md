# Velmurugan Finance

## Current deliverable

Open index.html in a modern browser. One HTML file, inline styles and scripts, no framework or build step. The supplied visual brief is adapted to the finance platform with a violet globe landing screen, owner workspace and phone-friendly borrower preview. Google Fonts and the exact supplied background media URLs need internet; the interface has system-font and poster fallbacks.

This is an interactive local prototype, not a live financial system. It uses fictional customers and browser localStorage. It has no authentication or cross-device sync. Do not enter real borrower information. Browser storage is not a reliable production database. Export/restore covers demo records only.

## Confirmed business rules

- Each loan has an owner-entered monthly interest percentage. Amount alone does not choose the rate: ₹1 lakh at 5% and ₹2 lakh at 3–4% were examples, not an agreed rate schedule.
- First interest is due at the end of the calendar month after borrowing: a loan taken in October has its first due date on 30 November.
- Payments clear posted unpaid interest, then reduce principal. The allocation is calculated, not manually chosen.
- Additional money is a separate loan under the same customer, preserving different dates and rates.

## Prototype conventions requiring confirmation before real use

The demo posts one whole simple monthly interest charge at each month-end due date, based on principal remaining at that point. Same-day payments run after the charge. There is no daily accrual, proration, compounding or additional penalty. Unpaid interest carries forward separately. Reducing principal before the next charge lowers that charge. Interest that has already been posted is not recalculated.

Example: ₹100,000 borrowed on 31 October at 5% per month → ₹5,000 interest posted on 30 November. A ₹7,000 payment that day pays ₹5,000 interest and ₹2,000 principal. Principal becomes ₹98,000; December's interest estimate becomes ₹4,900. If nothing is paid in November, December adds ₹5,000; the unpaid interest becomes ₹10,000 without an additional penalty.

Still confirm: due-date grace periods; any daily accrual; interest treatment after early repayment; late charges and their start dates; future rate changes and whether they apply to existing loans; reversals and backdated corrections. Until agreed, the UI explicitly says that no additional late charge is applied. This is a business rule supplied by the client, not a statement that every lender must allocate payments this way.

The demo disallows future-dated entries, overpayments and payments earlier than the last payment on a loan. It records amounts to paise. A production ledger should use database numeric/decimal amounts and immutable events with explicit corrections, receipt IDs and audit records, rather than editable running totals.

## Source spreadsheet

FINANCE NAME LIST.xlsx was inspected read-only. It contains customer ID, name, amount, interest, date, two mobile numbers, address, work, photo, folder, ID proof and map columns. Some additional lending rows omit the customer ID/name. At least one date is invalid (30 February 2026). Interest cells contain fractions such as 0.1, but their rate period must be confirmed before import. Do not infer a monthly rate solely from number formatting.

No source customers have been copied into the public interface. Before importing: confirm rates and dates, map continuation rows to explicit customers, resolve missing IDs, preserve original rows, produce an exception report, and reconcile totals with the owner. Photos and ID proofs need private file storage, separate from general borrower-visible profile data.

## Laptop and phone architecture

Recommended: laptop browser / borrower phone → HTTPS web application → Supabase Auth + PostgreSQL with Row Level Security. A static site host serves the interface; Supabase hosts the database. This still uses cloud hosting, but the owner does not operate a server. A local-only HTML file cannot by itself make updated balances available to remote phones when the laptop is off.

Live owner transactions should use database transactions/functions that validate role, loan ownership, balances and idempotency. Borrowers authenticate with a verified login; customer ID plus email is not sufficient authentication. Link each auth user to their customer record through a privileged owner workflow. Enforce borrower-only reads at the database layer, prohibit borrower writes to financial tables, and prohibit role self-promotion. Never embed a Supabase service-role/secret key in HTML.

Borrowers should see a refresh after login, a visible last-updated time, and optionally live notifications plus periodic refresh while open. An offline screen must clearly show stale data. The owner must be online to commit a change. If the laptop is off, phones can read the last cloud-committed data. Do not silently merge offline financial writes.

Suggested tables: private customer contact records, borrower-visible profiles, loans, effective-dated loan rates, posted interest charges, payment receipts, payment allocations, correction/reversal events, owner memberships and audit events. Link disbursements and receipts to explicit loan IDs. No live cloud tables or accounts have been created yet.

## Supabase duration, cost and retention — verified 26 October 2026

The published Free plan is $0/month, not a fixed number of trial days. There is no advertised fixed expiry for an active project within the free limits. Continued service is subject to current terms, limits and future changes; do not promise permanent free hosting or guaranteed retention.

Current included limits: 500 MB database per project, 50,000 monthly active users, 1 GB file storage, 5 GB egress, and two active free projects. Photos/ID documents and downloads may consume limits faster than text ledger records. How many years it will fit cannot be established without actual data volume and usage; monitor usage and budget before approaching limits.

Low activity over seven days can trigger free-project pausing. The current pausing documentation says paused projects can be restored in Studio within one year. Older Supabase changelogs still mention 90 days; rely on current project notices and documentation, not historical promises. After the restore window, the current knowledge-base article directs users to download the database backup and Storage objects before deletion. This is a recovery mechanism, not a substitute for independent backups.

Free does not include automatic database backups. Pro currently starts at US$25/month, includes the first project and daily database backups retained seven days, and avoids inactivity pausing. Additional resources/projects can cost more. Database backups do not include the actual Storage files, which need separate backup. Signing up for Free does not itself require choosing a paid plan; do not enable paid upgrades without the owner's decision.

Sources:
- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/kb/troubleshooting/restore-project-after-90-days-pause (current title refers to one year)

## Required data protection before real use

1. Keep the production account, billing and recovery email under the owner's control; enable MFA and retain recovery codes safely.
2. Run scheduled encrypted database exports daily and after significant import/migration operations. Include schema, policies, roles/permissions and required authentication recovery procedures; test what is actually restored.
3. Copy private uploaded files separately. Keep at least one encrypted backup outside Supabase and outside the owner's laptop, plus a second independent copy. Limit access and keep encryption recovery keys separately.
4. Check backup jobs and alert on failure. A powered-off laptop cannot run a scheduled backup: use an independent scheduled runner or another always-on device.
5. Perform a restore into a separate test database before launch and periodically thereafter. Reconcile customer count, original principal, receipts, allocations, unpaid interest and balances; verify borrower isolation after restore.
6. Agree recovery targets with the owner. A once-daily backup can lose up to about 24 hours of work. Retain receipts independently and choose more frequent backups if that loss is unacceptable. Decide retention periods and document responsibilities.
7. Monitor quota and pause notices. Plan an upgrade or migration before a limit stops operations. Paid hosting alone does not remove the need for external copies and restore tests.

## Work split

Codex: interface and documented calculation prototype. Antigravity: independent read-only calculation and data-safety review, task 8957132e6559498a under master-code. It has been notified through MCP but must be actively prompted to check its messages. Neither assistant can start the other through this coordination server.

The shared project was registered as velmurugan-finance in D:/master code/projects.json. Existing MCP client processes need reload to discover the added registration. The review remains under master-code so it remains accessible before reload. Codex owns index.html and SETUP.md; Antigravity should report findings without changing them.

## Remaining live setup

Approve the remaining financial rules; create an owner-controlled Supabase project; implement and test schema, login, RLS and atomic ledger transactions; connect the interface; configure the static web address and backups; test owner/borrower isolation with separate accounts; reconcile the reviewed spreadsheet import. Do not treat the preview selector as a production login.


## Globe playback correction

The supplied MP4 is about 37.8 MB. Playback can stall while the external resource buffers. The page now renders an inline canvas globe using rotating 3D points whenever the original video is not advancing, and switches back when playback is ready. This fallback is decorative and is not an exact recreation of the supplied video. No media has been downloaded or localised, and there are no new external libraries.

A visible Play/Pause animation control allows the user to control motion. Reduced-motion preference starts paused and can be explicitly overridden with Play. Video and fallback animation pause when the tab is hidden or the owner/borrower workspace is open.
