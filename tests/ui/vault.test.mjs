import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createVault,
  unlockVault,
  recoverVault,
  encryptWalletRecord,
  decryptWalletRecord
} from '../../src/vault.ts';

test('Wallet lifecycle: create, lock, unlock, encrypt, decrypt, and recover', async () => {
  const password = 'CorrectHorseBatteryStaple123!';
  const newPassword = 'NewSecretPassword456!';
  const clientId = '00000000-0000-0000-0000-000000000001';
  const secretData = {
    customer_id: '26VMC001',
    name: 'Arun Kumar',
    password: 'ClientInitialPassword789#',
    notes: 'Confidential borrower note'
  };

  // 1. Create Vault
  const {key, metadata, recoveryCode} = await createVault(password);
  assert.equal(metadata.v, 1);
  assert.equal(metadata.kdf, 'PBKDF2-SHA256');
  assert.equal(metadata.iterations, 600000);
  assert.ok(metadata.salt);
  assert.ok(metadata.wrappedKey);
  assert.ok(metadata.recoveryWrappedKey);
  assert.ok(recoveryCode);

  // 2. Encrypt & Decrypt Record
  const envelope = await encryptWalletRecord(key, clientId, secretData);
  assert.equal(envelope.v, 1);
  assert.ok(envelope.iv);
  assert.ok(envelope.ciphertext);

  const decrypted = await decryptWalletRecord(key, clientId, envelope);
  assert.deepEqual(decrypted, secretData);

  // 3. Unlock with correct password
  const unlockedKey = await unlockVault(password, metadata);
  const decrypted2 = await decryptWalletRecord(unlockedKey, clientId, envelope);
  assert.deepEqual(decrypted2, secretData);

  // 4. Unlock with wrong password must throw
  await assert.rejects(
    async () => {
      await unlockVault('WrongPasswordHere!', metadata);
    },
    /Wallet password is incorrect/
  );

  // 5. Decrypt with wrong clientId context (AAD mismatch) must throw
  const wrongClientId = '00000000-0000-0000-0000-000000000002';
  await assert.rejects(async () => {
    await decryptWalletRecord(key, wrongClientId, envelope);
  });

  // 6. Recovery with recovery code
  const {key: recoveredKey, metadata: updatedMetadata} = await recoverVault(
    recoveryCode,
    newPassword,
    metadata
  );
  assert.equal(updatedMetadata.v, 1);
  const decryptedAfterRecovery = await decryptWalletRecord(recoveredKey, clientId, envelope);
  assert.deepEqual(decryptedAfterRecovery, secretData);

  // 7. Unlocking with old password must now fail on updatedMetadata
  await assert.rejects(async () => {
    await unlockVault(password, updatedMetadata);
  });

  // 8. Unlocking with new password succeeds on updatedMetadata
  const newUnlockedKey = await unlockVault(newPassword, updatedMetadata);
  const decryptedWithNewPw = await decryptWalletRecord(newUnlockedKey, clientId, envelope);
  assert.deepEqual(decryptedWithNewPw, secretData);
});
