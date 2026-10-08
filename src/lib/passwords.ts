import bcrypt from 'bcryptjs';
import { AppError } from './errors';

const BCRYPT_ROUNDS = 12;

export function validatePassword(password: string): string {
  // There is no minimum length, but a password cannot be empty.
  if (!password) throw new AppError('Password is required.');
  // bcrypt only reads the first 72 bytes, so longer passwords would be silently cut.
  if (Buffer.byteLength(password, 'utf8') > 72) throw new AppError('Password is too long (72 characters at most).');
  return password;
}

/** Passwords are stored only as salted bcrypt hashes. */
export const hashPassword = (password: string): Promise<string> => bcrypt.hash(validatePassword(password), BCRYPT_ROUNDS);

// Compared against when the username does not exist, so a wrong username
// takes as long to reject as a wrong password.
let dummyHash: string | null = null;

export async function checkPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    dummyHash ??= await bcrypt.hash('not-a-real-password', BCRYPT_ROUNDS);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}
