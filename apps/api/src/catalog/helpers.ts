import { BadRequestException, ConflictException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { slugify } from '@mtjari/shared';

export const bad = (code: string): never => {
  throw new BadRequestException(code);
};

/**
 * Picks a slug for new content. An explicit slug must be free (409 otherwise);
 * a generated one gets a numeric suffix until it is free.
 */
export async function resolveSlug(
  isTaken: (slug: string) => Promise<boolean>,
  explicit: string | undefined,
  ...nameCandidates: (string | null | undefined)[]
): Promise<string> {
  if (explicit) {
    if (await isTaken(explicit)) throw new ConflictException('slug_taken');
    return explicit;
  }
  const base = nameCandidates.map((n) => (n ? slugify(n) : '')).find(Boolean) || `item-${randomBytes(3).toString('hex')}`;
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export const isUniqueViolation = (e: unknown): boolean => (e as { code?: string }).code === 'P2002';
