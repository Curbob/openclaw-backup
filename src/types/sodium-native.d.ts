declare module 'sodium-native' {
  export const crypto_pwhash_SALTBYTES: number;
  export const crypto_secretbox_KEYBYTES: number;
  export const crypto_secretbox_NONCEBYTES: number;
  export const crypto_secretbox_MACBYTES: number;
  export const crypto_pwhash_OPSLIMIT_MODERATE: number;
  export const crypto_pwhash_MEMLIMIT_MODERATE: number;
  export const crypto_pwhash_ALG_ARGON2ID13: number;

  export function randombytes_buf(buffer: Buffer): void;
  
  export function crypto_pwhash(
    output: Buffer,
    password: Buffer,
    salt: Buffer,
    opslimit: number,
    memlimit: number,
    algorithm: number
  ): void;

  export function crypto_secretbox_easy(
    ciphertext: Buffer,
    plaintext: Buffer,
    nonce: Buffer,
    key: Buffer
  ): void;

  export function crypto_secretbox_open_easy(
    plaintext: Buffer,
    ciphertext: Buffer,
    nonce: Buffer,
    key: Buffer
  ): boolean;
}
