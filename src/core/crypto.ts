/**
 * Encryption module using libsodium (XChaCha20-Poly1305)
 * 
 * - Password-based key derivation with Argon2id
 * - Authenticated encryption (AEAD)
 * - Unique nonce per chunk
 */

import sodium from 'sodium-native';

const SALT_BYTES = sodium.crypto_pwhash_SALTBYTES;
const KEY_BYTES = sodium.crypto_secretbox_KEYBYTES;
const NONCE_BYTES = sodium.crypto_secretbox_NONCEBYTES;
const MAC_BYTES = sodium.crypto_secretbox_MACBYTES;

export interface EncryptedData {
  nonce: Buffer;
  ciphertext: Buffer;
}

export interface KeyMaterial {
  key: Buffer;
  salt: Buffer;
}

/**
 * Derive encryption key from password using Argon2id
 */
export function deriveKey(password: string, salt?: Buffer): KeyMaterial {
  const actualSalt = salt ?? Buffer.alloc(SALT_BYTES);
  if (!salt) {
    sodium.randombytes_buf(actualSalt);
  }

  const key = Buffer.alloc(KEY_BYTES);
  sodium.crypto_pwhash(
    key,
    Buffer.from(password),
    actualSalt,
    sodium.crypto_pwhash_OPSLIMIT_MODERATE,
    sodium.crypto_pwhash_MEMLIMIT_MODERATE,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );

  return { key, salt: actualSalt };
}

/**
 * Encrypt data with XChaCha20-Poly1305
 */
export function encrypt(plaintext: Buffer, key: Buffer): EncryptedData {
  const nonce = Buffer.alloc(NONCE_BYTES);
  sodium.randombytes_buf(nonce);

  const ciphertext = Buffer.alloc(plaintext.length + MAC_BYTES);
  sodium.crypto_secretbox_easy(ciphertext, plaintext, nonce, key);

  return { nonce, ciphertext };
}

/**
 * Decrypt data with XChaCha20-Poly1305
 */
export function decrypt(encrypted: EncryptedData, key: Buffer): Buffer {
  const plaintext = Buffer.alloc(encrypted.ciphertext.length - MAC_BYTES);
  
  const success = sodium.crypto_secretbox_open_easy(
    plaintext,
    encrypted.ciphertext,
    encrypted.nonce,
    key
  );

  if (!success) {
    throw new Error('Decryption failed - wrong password or corrupted data');
  }

  return plaintext;
}

/**
 * Generate a verification token to check password without decrypting everything
 */
export function createVerifier(key: Buffer): Buffer {
  const testData = Buffer.from('openclaw-backup-verification');
  const { nonce, ciphertext } = encrypt(testData, key);
  return Buffer.concat([nonce, ciphertext]);
}

/**
 * Verify password against stored verifier
 */
export function verifyPassword(password: string, salt: Buffer, verifier: Buffer): boolean {
  try {
    const { key } = deriveKey(password, salt);
    const nonce = verifier.subarray(0, NONCE_BYTES);
    const ciphertext = verifier.subarray(NONCE_BYTES);
    const plaintext = decrypt({ nonce, ciphertext }, key);
    return plaintext.toString() === 'openclaw-backup-verification';
  } catch {
    return false;
  }
}
