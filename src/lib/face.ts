import { z } from "zod";

// Face matching for camera check-in (Section 5 extra bonus). The browser turns a face into a 128-number
// descriptor (face-api.js face recognition model); the server compares it with the enrolled one and decides.

export const DESCRIPTOR_LENGTH = 128;

/**
 * Euclidean distance at or below which two descriptors are the same person. face-api.js commonly uses 0.6;
 * 0.55 is a little stricter, so a look-alike colleague is less likely to pass.
 */
export const FACE_MATCH_THRESHOLD = 0.55;

export const descriptorSchema = z
  .array(z.number().finite().min(-2).max(2))
  .length(DESCRIPTOR_LENGTH, `A face descriptor has ${DESCRIPTOR_LENGTH} numbers`);

export function faceDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

export const isSameFace = (enrolled: readonly number[], probe: readonly number[]) => faceDistance(enrolled, probe) <= FACE_MATCH_THRESHOLD;
