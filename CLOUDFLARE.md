# Cloudflare Pages deployment

This deploys the local demonstration, not a live authenticated financial portal. The published app remains labelled LOCAL DEMO and uses fictional records stored in each visitor's browser. Supabase has the backend schema but the interface is not yet integrated. Never enter real borrower information in this release.

## One-time owner setup

1. Sign in at https://dash.cloudflare.com/.
2. Open Workers & Pages, create an application, and choose Pages / connect a Git repository. Choose Pages rather than a Workers deployment requiring a deploy command.
3. Authorise GitHub under flare8278-cell and allow the Velmurugan_Finance repository.
4. Select flare8278-cell/Velmurugan_Finance, then use these build settings:

| Setting | Value |
|---|---|
| Project name | velmurugan-finance (or an available variation) |
| Production branch | main |
| Framework preset | None |
| Root directory | Repository root; leave blank |
| Build command | npm run build |
| Build output directory | dist |
| Environment variables | None required for this demo |

5. Save and deploy. Cloudflare assigns a pages.dev address; do not assume the exact address before the deployment succeeds.
6. Share the returned address for verification. Later pushes to main trigger new builds once Git integration is enabled.

The build has no third-party dependencies. It copies only index.html and workspace.css into dist. Do not set repository root as the published output directory. Secrets, source spreadsheets, SQL, and backend documentation are not part of the website output. Environment variables do not automatically connect this static HTML to Supabase.

## Verification after deployment

- Open the Pages address and check dashboard, client search, Give money/Get money, collections and mobile navigation.
- Verify the public globe page, motion controls and buffering fallback.
- Confirm the LOCAL DEMO message is visible and reloads preserve only that browser's demo data.
- Check that SQL files, .env.local and backend documentation are not served as static assets.
- No live owner/client login, email code, wallet, or cross-device data synchronisation is claimed by this release.

Official setup: https://developers.cloudflare.com/pages/get-started/git-integration/
