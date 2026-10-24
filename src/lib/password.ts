import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { z } from "zod";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .regex(/[A-Za-z]/, "Password needs a letter")
  .regex(/\d/, "Password needs a number");

/** Readable one-time password shown once to HR/Admin; the user must change it on first sign-in. */
export function temporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyz";
  const pick = (n: number, chars: string) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");
  return `${pick(4, letters)}-${pick(4, "23456789")}-${pick(2, letters.toUpperCase())}`;
}
