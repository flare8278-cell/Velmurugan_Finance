export type CipherEnvelope = {v: 1; iv: string; ciphertext: string};
export type VaultMetadata = {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  wrappedKey: CipherEnvelope;
  recoveryWrappedKey: CipherEnvelope;
};

const encoder = new TextEncoder();
const buf = (b: Uint8Array): BufferSource => b as unknown as BufferSource;
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const fresh = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const aad = (context: string) => encoder.encode('velmurugan-finance:v1:' + context);

async function passwordKey(password: string, salt: Uint8Array, iterations: number) {
  if (password.length < 12 || password.length > 256) {
    throw Error('Use a wallet password with 12–256 characters.');
  }
  if (iterations < 600000 || iterations > 2000000) {
    throw Error('Invalid wallet key parameters.');
  }
  const input = await crypto.subtle.importKey(
    'raw',
    buf(encoder.encode(password)),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations},
    input,
    {name: 'AES-GCM', length: 256},
    false,
    ['encrypt', 'decrypt']
  );
}

async function seal(key: CryptoKey, bytes: Uint8Array, context: string): Promise<CipherEnvelope> {
  const iv = fresh(12);
  const ciphertext = await crypto.subtle.encrypt(
    {name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad(context))},
    key,
    buf(bytes)
  );
  return {v: 1, iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext))};
}

async function open(key: CryptoKey, envelope: CipherEnvelope, context: string) {
  if (envelope.v !== 1 || unb64(envelope.iv).length !== 12) {
    throw Error('Invalid encrypted wallet item.');
  }
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {name: 'AES-GCM', iv: buf(unb64(envelope.iv)), additionalData: buf(aad(context))},
      key,
      buf(unb64(envelope.ciphertext))
    )
  );
}

async function dataKey(bytes: Uint8Array) {
  return crypto.subtle.importKey('raw', buf(bytes), 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export async function createVault(password: string) {
  const raw = fresh(32);
  const salt = fresh(16);
  const iterations = 600000;
  const pw = await passwordKey(password, salt, iterations);
  const recoveryRaw = fresh(32);
  const recoveryKey = await crypto.subtle.importKey(
    'raw',
    buf(recoveryRaw),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
  const metadata: VaultMetadata = {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: b64(salt),
    wrappedKey: await seal(pw, raw, 'wrapped-key'),
    recoveryWrappedKey: await seal(recoveryKey, raw, 'recovery-key')
  };
  const key = await dataKey(raw);
  raw.fill(0);
  return {key, metadata, recoveryCode: b64(recoveryRaw)};
}

export async function unlockVault(password: string, metadata: VaultMetadata) {
  try {
    if (metadata.v !== 1 || metadata.kdf !== 'PBKDF2-SHA256') {
      throw Error('Unsupported wallet');
    }
    const key = await passwordKey(password, unb64(metadata.salt), metadata.iterations);
    const raw = await open(key, metadata.wrappedKey, 'wrapped-key');
    const result = await dataKey(raw);
    raw.fill(0);
    return result;
  } catch {
    throw Error('Wallet password is incorrect, or the recovery data is damaged.');
  }
}

export async function recoverVault(code: string, newPassword: string, metadata: VaultMetadata) {
  const recovery = await crypto.subtle.importKey(
    'raw',
    buf(unb64(code)),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );
  let raw: Uint8Array;
  try {
    raw = await open(recovery, metadata.recoveryWrappedKey, 'recovery-key');
  } catch {
    throw Error('Recovery code is incorrect.');
  }
  const salt = fresh(16);
  const pw = await passwordKey(newPassword, salt, 600000);
  const updated: VaultMetadata = {
    ...metadata,
    salt: b64(salt),
    iterations: 600000,
    wrappedKey: await seal(pw, raw, 'wrapped-key')
  };
  const key = await dataKey(raw);
  raw.fill(0);
  return {key, metadata: updated};
}

export async function encryptWalletRecord(key: CryptoKey, clientId: string, record: unknown) {
  return seal(key, encoder.encode(JSON.stringify(record)), 'client:' + clientId);
}

export async function decryptWalletRecord(
  key: CryptoKey,
  clientId: string,
  envelope: CipherEnvelope
) {
  return JSON.parse(new TextDecoder().decode(await open(key, envelope, 'client:' + clientId)));
}
