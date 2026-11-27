import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

test('Types and icons support borrower navigation and Profile page', () => {
  const typesCode = readFileSync(resolve(root, 'src/types.ts'), 'utf8');
  assert.match(typesCode, /'profile'/, 'Page type must include profile');

  const iconsCode = readFileSync(resolve(root, 'src/icons.tsx'), 'utf8');
  assert.match(iconsCode, /case 'profile':[\s\S]*?return <UserIcon/, 'PageIcon must return UserIcon for profile');
  assert.match(iconsCode, /export function OverviewIcon/, 'Must export OverviewIcon');
  assert.match(iconsCode, /export function LoansIcon/, 'Must export LoansIcon');
  assert.match(iconsCode, /export function UserIcon/, 'Must export UserIcon');
});

test('App.tsx implements borrower Home, Loans, Profile views and mobile bottom tabs', () => {
  const appCode = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');

  // Borrower pages definition
  assert.match(appCode, /:\s*\['overview',\s*'loans',\s*'profile'\]/, 'Borrower pages must be overview, loans, profile');
  assert.match(appCode, /profile:\s*'Profile'/, 'labels must define profile: Profile');

  // Page safety redirect
  assert.match(appCode, /!\[\s*'overview',\s*'loans',\s*'profile'\s*\]\.includes\(page\)/, 'Must restrict borrower to allowed pages');

  // Mobile bottom navigation
  assert.match(appCode, /<nav className="borrower-bottom-nav"/, 'Must render borrower-bottom-nav when not owner');
  assert.match(appCode, /bottom-nav-item/, 'Must contain bottom-nav-item buttons');
  assert.match(appCode, /aria-current=\{page === 'overview' \? 'page' : undefined\}/, 'Must set aria-current for Home tab');
  assert.match(appCode, /aria-current=\{page === 'loans' \? 'page' : undefined\}/, 'Must set aria-current for Loans tab');
  assert.match(appCode, /aria-current=\{page === 'profile' \? 'page' : undefined\}/, 'Must set aria-current for Profile tab');

  // Borrower views
  assert.match(appCode, /<BorrowerHomeView/, 'Must render BorrowerHomeView on overview');
  assert.match(appCode, /<BorrowerLoansView/, 'Must render BorrowerLoansView on loans');
  assert.match(appCode, /<BorrowerProfileView/, 'Must render BorrowerProfileView on profile');

  // Overdue posted monthly interest derivation
  assert.match(appCode, /loans\.filter\(l => Number\(l\.balance\.interest\) > 0\)/, 'Must filter loans with positive balance.interest for overdue interest');
  assert.match(appCode, /Overdue Posted Monthly Interest/, 'Must display overdue posted monthly interest banner');

  // Installment calculations and identity fields notice
  assert.match(appCode, /Installment calculation structures, amortization schedules, and borrower identity document uploads await user specifications/, 'Must note installment schedules await user specs');
  assert.match(appCode, /Borrower identity fields, KYC document uploads.*await user specifications/, 'Must note identity verification awaits user specs');

  // Preserved questions and receipt viewing
  assert.match(appCode, /<QuestionThreads/, 'Must preserve QuestionThreads under Profile');
  assert.match(appCode, /setReceipt/, 'Must support viewing official payment receipts');
});

test('styles.css contains mobile bottom nav and borrower view styling', () => {
  const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');

  // Hidden on desktop, fixed bottom on mobile
  assert.match(css, /\.borrower-bottom-nav\s*\{\s*display:\s*none;/, 'bottom nav must be hidden on desktop');
  assert.match(css, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.borrower-bottom-nav\s*\{[\s\S]*?position:\s*fixed/, 'bottom nav must be fixed at <=600px');
  assert.match(css, /\.borrower-shell\s+\.main-content\s*\{[\s\S]*?padding-bottom:/, 'main-content must have bottom padding on mobile in borrower-shell');

  // Component styles
  assert.match(css, /\.borrower-hero-card/, 'CSS must style borrower-hero-card');
  assert.match(css, /\.borrower-hero-card\.overdue/, 'CSS must style overdue hero card');
  assert.match(css, /\.borrower-allocation-note/, 'CSS must style borrower allocation note');
  assert.match(css, /\.borrower-notice-card/, 'CSS must style borrower notice card');
  assert.match(css, /\.borrower-profile-card/, 'CSS must style borrower profile card');
  assert.match(css, /\.bottom-nav-item\.active/, 'CSS must style active bottom nav tab');
});
