import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createVault,
  encryptWalletRecord,
  decryptWalletRecord
} from '../../src/vault.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../..');

test('Client type and Borrower/Owner UI expose primary and alternate phone via finance_update_own_phones', () => {
  const typesCode = readFileSync(resolve(root, 'src/types.ts'), 'utf8');
  assert.match(typesCode, /alternate_phone\??:\s*string/, 'Client type must include alternate_phone');

  const formCode = readFileSync(resolve(root, 'src/ClientContactForm.tsx'), 'utf8');
  assert.match(formCode, /finance_update_own_phones/, 'ClientContactForm must call finance_update_own_phones');
  assert.match(formCode, /p_phone:\s*values\.get\('phone'\)/, 'ClientContactForm must pass p_phone');
  assert.match(formCode, /p_alternate_phone:\s*values\.get\('alternatePhone'\)/, 'ClientContactForm must pass p_alternate_phone');

  const appCode = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
  assert.match(appCode, /import\s+\{ClientContactForm\}\s+from\s+'\.\/ClientContactForm'/, 'App must import ClientContactForm');
  assert.match(appCode, /<ClientContactForm[\s\S]*?onSaved=\{async\s*\(\)\s*=>\s*\{[\s\S]*?await onReload\(\)/, 'Profile must mount ClientContactForm and refresh workspace after save');
  assert.match(appCode, /Primary Phone Number/, 'Profile must show Primary Phone Number');
  assert.match(appCode, /Alternate Phone Number/, 'Profile must show Alternate Phone Number');
  assert.match(appCode, /c\.alternate_phone\s*&&[\s\S]*?Alt:\s*\{c\.alternate_phone\}/, 'Owner clients table must show alternate_phone');
  assert.match(appCode, /detailClient\.alternate_phone/, 'Owner client detail modal must show alternate_phone');

  const cssCode = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
  assert.match(cssCode, /\.borrower-contact-edit/, 'CSS must style borrower-contact-edit');
  assert.match(cssCode, /\.borrower-contact-edit p\[role="status"\]/, 'CSS must style save confirmation status');
});

test('Credential save reads & decrypts existing vault row, preserves fields/notes, and aborts on failure', async () => {
  const appCode = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
  assert.match(appCode, /import\s+\{decryptWalletRecord,\s*encryptWalletRecord\}\s+from\s+'\.\/vault'/, 'App must import decryptWalletRecord');

  const credStart = appCode.indexOf("modal === 'credentials'");
  const credEnd = appCode.indexOf("modal === 'question'", credStart);
  assert.ok(credStart !== -1 && credEnd !== -1, 'Must locate credentials submit branch');
  const credBranch = appCode.slice(credStart, credEnd);

  assert.match(credBranch, /\.from\('finance_vault_items'\)[\s\S]*?\.select\('client_id,envelope'\)[\s\S]*?\.eq\('client_id',\s*c\.id\)[\s\S]*?\.maybeSingle\(\)/, 'Must read existing vault item for client before saving credentials');
  assert.match(credBranch, /await decryptWalletRecord\(\s*vaultKey,\s*c\.id,/, 'Must decrypt existing vault item before creating new envelope');
  assert.ok(credBranch.indexOf('decryptWalletRecord') < credBranch.indexOf('encryptWalletRecord'), 'Must decrypt before re-encrypting');
  assert.match(credBranch, /Could not decrypt existing wallet record/, 'Must throw explicit error and abort if decryption fails');
  assert.match(credBranch, /submittedNotes\.trim\(\)\s*\?\s*submittedNotes\s*:\s*priorNotes/, 'Blank notes must preserve prior notes');
  assert.match(credBranch, /\.\.\.existingRecord,/, 'Must spread existingRecord to preserve custom encrypted fields');

  // Verify WebCrypto behavior cleanly: existing custom fields + notes survive, bad key aborts
  const { key } = await createVault('CorrectVaultPass123!');
  const { key: wrongKey } = await createVault('DifferentVaultPass456!');
  const clientId = '00000000-0000-0000-0000-000000000077';

  const priorRecord = {
    customer_id: '26VMC077',
    name: 'Selvam',
    phone: '9876543210',
    notes: 'Existing guarantor & ID note',
    guarantor: 'Ramesh'
  };
  const existingEnvelope = await encryptWalletRecord(key, clientId, priorRecord);

  // Decrypt succeeds with correct key
  const decrypted = await decryptWalletRecord(key, clientId, existingEnvelope);
  assert.deepEqual(decrypted, priorRecord);

  // Wrong key rejects before building new envelope
  await assert.rejects(() => decryptWalletRecord(wrongKey, clientId, existingEnvelope));
});
