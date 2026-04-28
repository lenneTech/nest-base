import { timingSafeEqual } from 'node:crypto';

/**
 * Helpers that prevent a user-enumeration oracle on the auth surface.
 *
 * The /signin and /password-reset responses must look identical for
 * "user exists" and "user does not exist" — both shape and content.
 */

export interface MaskInput {
  email: string;
  userExists: boolean;
}

export interface MaskedResponse {
  message: string;
  email: string;
}

export function maskUserExistenceResponse(_input: MaskInput): MaskedResponse {
  return {
    message: 'If an account matches, instructions will be sent.',
    email: _input.email,
  };
}

/** Constant-time comparison; returns false on length mismatch without
 *  revealing where bytes diverged. */
export function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
