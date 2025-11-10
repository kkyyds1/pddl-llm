import type { FileType } from './file-manager';
import type { PddlDomain, PddlProblem } from './pddl-types';

export const detectPddlFileType = (
  content: string
): Extract<FileType, 'domain' | 'problem'> | null => {
  const normalized = content
    .replace(/;[^\n\r]*/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  if (/\(\s*define\s*\(\s*domain\b/.test(normalized)) {
    return 'domain';
  }
  if (/\(\s*define\s*\(\s*problem\b/.test(normalized)) {
    return 'problem';
  }
  return null;
};

export const stripFileExtension = (filename: string) => {
  const trimmed = filename.trim();
  if (!trimmed) {
    return '';
  }
  const lastDot = trimmed.lastIndexOf('.');
  if (lastDot <= 0) {
    return trimmed;
  }
  return trimmed.slice(0, lastDot);
};

export const isDomainPayload = (value: unknown): value is PddlDomain => {
  const domainCandidate = value as Partial<PddlDomain> | undefined;
  return (
    !!domainCandidate &&
    Array.isArray(domainCandidate.actions) &&
    typeof (domainCandidate as { name?: unknown }).name === 'string'
  );
};

export const isProblemPayload = (value: unknown): value is PddlProblem => {
  const problemCandidate = value as Partial<PddlProblem> | undefined;
  return (
    !!problemCandidate &&
    Array.isArray(problemCandidate.objects) &&
    typeof (problemCandidate as { name?: unknown }).name === 'string'
  );
};
