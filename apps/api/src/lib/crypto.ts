import { createPrivateKey, privateDecrypt, constants } from 'node:crypto';
import { env } from '@/config/env';

/**
 * Decrypt an RSA-OAEP envelope produced by the browser using
 * CREDENTIAL_ENCRYPTION_PUBLIC_KEY. The private key never leaves the API.
 *
 * Browser side (apps/web) should encrypt with WebCrypto:
 *   crypto.subtle.encrypt(
 *     { name: 'RSA-OAEP' },
 *     publicKey,
 *     new TextEncoder().encode(JSON.stringify({ username, password }))
 *   )
 * then base64 the result and POST it.
 */
export function decryptCredentialsEnvelope<T = unknown>(envelopeB64: string): T {
  if (!env.CREDENTIAL_ENCRYPTION_PRIVATE_KEY) {
    throw new Error('CREDENTIAL_ENCRYPTION_PRIVATE_KEY is not configured');
  }
  const key = createPrivateKey({
    key: Buffer.from(env.CREDENTIAL_ENCRYPTION_PRIVATE_KEY, 'base64'),
    format: 'pem',
  });
  const decrypted = privateDecrypt(
    { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(envelopeB64, 'base64'),
  );
  return JSON.parse(decrypted.toString('utf8')) as T;
}

/** Best-effort credential string scrub for logs. */
export function scrubCredentials(text: string): string {
  return text
    .replace(/(password["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]')
    .replace(/(otp["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi, '$1[REDACTED]');
}
