import type { PlaitElement, PlaitTheme, Viewport } from '@plait/core';

export type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

export type FileType = 'domain' | 'problem' | 'plan' | 'others';

export type BoardEntryBase = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

export type BoardFileEntry = BoardEntryBase & {
  type: 'file';
  fileType: FileType;
  data: AppValue;
};

export type BoardFolderEntry = BoardEntryBase & {
  type: 'folder';
  children: BoardEntry[];
};

export type BoardEntry = BoardFileEntry | BoardFolderEntry;

export type LegacyStoredFile = {
  id?: string;
  name?: string;
  data?: AppValue;
  createdAt?: number;
  updatedAt?: number;
  fileType?: FileType;
};

export const FILE_TYPE_OPTIONS: {
  value: FileType;
  label: string;
  icon: string;
}[] = [
  { value: 'domain', label: 'Domain', icon: '🌐' },
  { value: 'problem', label: 'Problem', icon: '❓' },
  { value: 'plan', label: 'Plan', icon: '🧭' },
  { value: 'others', label: 'Others', icon: '📝' },
];

export const FILE_TYPE_ICON_MAP: Record<FileType, string> = {
  domain: '🌐',
  problem: '❓',
  plan: '🧭',
  others: '📝',
};

export const hasContent = (data: AppValue) =>
  Array.isArray(data.children) && data.children.length > 0;

export const flattenFiles = (
  entries: BoardEntry[],
  acc: BoardFileEntry[] = []
): BoardFileEntry[] => {
  entries.forEach((entry) => {
    if (entry.type === 'file') {
      acc.push(entry);
    } else {
      flattenFiles(entry.children, acc);
    }
  });
  return acc;
};

export const normalizeEntries = (entries: BoardEntry[]): BoardEntry[] => {
  let changed = false;

  const normalized = entries.map((entry) => {
    if (entry.type === 'file') {
      const fileEntry = entry as BoardFileEntry & { fileType?: FileType };
      if (!fileEntry.fileType) {
        changed = true;
        return { ...fileEntry, fileType: 'others' };
      }
      return fileEntry;
    }

    const normalizedChildren = normalizeEntries(entry.children);
    if (normalizedChildren !== entry.children) {
      changed = true;
      return { ...entry, children: normalizedChildren };
    }
    return entry;
  });

  return changed ? normalized : entries;
};

export const findEntryById = (
  entries: BoardEntry[],
  id: string
): BoardEntry | null => {
  for (const entry of entries) {
    if (entry.id === id) {
      return entry;
    }
    if (entry.type === 'folder') {
      const child = findEntryById(entry.children, id);
      if (child) {
        return child;
      }
    }
  }
  return null;
};

export const findFileById = (
  entries: BoardEntry[],
  id: string
): BoardFileEntry | null => {
  const entry = findEntryById(entries, id);
  return entry && entry.type === 'file' ? entry : null;
};

export const findFolderById = (
  entries: BoardEntry[],
  id: string
): BoardFolderEntry | null => {
  const entry = findEntryById(entries, id);
  return entry && entry.type === 'folder' ? entry : null;
};

export const updateEntryById = (
  entries: BoardEntry[],
  id: string,
  updater: (entry: BoardEntry) => BoardEntry
): BoardEntry[] => {
  let changed = false;

  const mapped = entries.map((entry) => {
    if (entry.id === id) {
      changed = true;
      return updater(entry);
    }
    if (entry.type === 'folder') {
      const updatedChildren = updateEntryById(entry.children, id, updater);
      if (updatedChildren !== entry.children) {
        changed = true;
        return {
          ...entry,
          children: updatedChildren,
          updatedAt: Date.now(),
        };
      }
    }
    return entry;
  });

  return changed ? mapped : entries;
};

export const removeEntryById = (
  entries: BoardEntry[],
  id: string
): { entries: BoardEntry[]; removed: BoardEntry[] } => {
  let removed: BoardEntry[] = [];
  let changed = false;

  const nextEntries = entries.reduce<BoardEntry[]>((acc, entry) => {
    if (entry.id === id) {
      removed.push(entry);
      changed = true;
      return acc;
    }

    if (entry.type === 'folder') {
      const childResult = removeEntryById(entry.children, id);
      if (childResult.removed.length > 0) {
        removed = removed.concat(childResult.removed);
        const updatedChildren = childResult.entries;
        if (updatedChildren !== entry.children) {
          acc.push({
            ...entry,
            children: updatedChildren,
            updatedAt: Date.now(),
          });
          changed = true;
          return acc;
        }
      }
    }

    acc.push(entry);
    return acc;
  }, []);

  return {
    entries: changed ? nextEntries : entries,
    removed,
  };
};

export const convertLegacyFilesToEntries = (
  legacyFiles: LegacyStoredFile[]
): BoardEntry[] => {
  return legacyFiles.map((file, index) => {
    const fallbackName = `画布 ${index + 1}`;
    const createdAt = file.createdAt ?? Date.now();
    const updatedAt = file.updatedAt ?? createdAt;
    return {
      id: file.id ?? createId(),
      name:
        file.name && file.name.trim().length > 0 ? file.name : fallbackName,
      type: 'file' as const,
      fileType: file.fileType ?? 'others',
      data: file.data ?? { children: [] },
      createdAt,
      updatedAt,
    };
  });
};

export const isBoardEntryArray = (value: unknown): value is BoardEntry[] => {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every((item) => {
    if (!item || typeof item !== 'object') {
      return false;
    }
    const maybeEntry = item as { type?: string; children?: unknown };
    if (maybeEntry.type === 'file') {
      return true;
    }
    if (maybeEntry.type === 'folder' && Array.isArray(maybeEntry.children)) {
      return true;
    }
    return false;
  });
};

const collectEntryNames = (
  entries: BoardEntry[],
  type: BoardEntry['type'],
  excludeId?: string,
  acc: Set<string> = new Set()
): Set<string> => {
  entries.forEach((entry) => {
    if (entry.id !== excludeId && entry.type === type) {
      acc.add(entry.name);
    }
    if (entry.type === 'folder') {
      collectEntryNames(entry.children, type, excludeId, acc);
    }
  });
  return acc;
};

export const collectFolderIds = (
  entries: BoardEntry[],
  acc: Set<string> = new Set()
): Set<string> => {
  entries.forEach((entry) => {
    if (entry.type === 'folder') {
      acc.add(entry.id);
      collectFolderIds(entry.children, acc);
    }
  });
  return acc;
};

export const isNameTaken = (
  entries: BoardEntry[],
  type: BoardEntry['type'],
  name: string,
  excludeId?: string
) => {
  const takenNames = collectEntryNames(entries, type, excludeId);
  return takenNames.has(name);
};

export const generateNewFileName = (entries: BoardEntry[]) => {
  const taken = collectEntryNames(entries, 'file');
  return generateSequentialName('未命名', taken, '');
};

export const generateNewFolderName = (entries: BoardEntry[]) => {
  const taken = collectEntryNames(entries, 'folder');
  return generateSequentialName('文件夹', taken);
};

const generateSequentialName = (
  base: string,
  taken: Set<string>,
  separator = ' '
) => {
  let index = 1;
  let candidate = `${base}${separator}${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${base}${separator}${index}`;
  }
  return candidate;
};

export const createBlankFile = (
  name: string,
  data?: AppValue,
  fileType: FileType = 'others'
): BoardFileEntry => {
  const timestamp = Date.now();
  return {
    id: createId(),
    name,
    type: 'file',
    fileType,
    data: data ?? { children: [] },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createFolder = (name: string): BoardFolderEntry => {
  const timestamp = Date.now();
  return {
    id: createId(),
    name,
    type: 'folder',
    children: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const addEntryToFolder = (
  entries: BoardEntry[],
  folderId: string,
  newEntry: BoardEntry
): { entries: BoardEntry[]; inserted: boolean } => {
  let inserted = false;
  const nextEntries = entries.map((entry) => {
    if (entry.type !== 'folder') {
      return entry;
    }
    if (entry.id === folderId) {
      inserted = true;
      return {
        ...entry,
        children: [...entry.children, newEntry],
        updatedAt: Date.now(),
      };
    }
    const childResult = addEntryToFolder(entry.children, folderId, newEntry);
    if (childResult.inserted) {
      inserted = true;
      return {
        ...entry,
        children: childResult.entries,
        updatedAt: Date.now(),
      };
    }
    return entry;
  });

  return {
    entries: inserted ? nextEntries : entries,
    inserted,
  };
};

export const ensureUniqueFileName = (
  entries: BoardEntry[],
  preferredName: string,
  fallbackBase: string
) => {
  const baseCandidate =
    preferredName.trim() || fallbackBase.trim() || 'PDDL 文件';
  if (!isNameTaken(entries, 'file', baseCandidate)) {
    return baseCandidate;
  }
  let index = 2;
  let candidate = `${baseCandidate} (${index})`;
  while (isNameTaken(entries, 'file', candidate)) {
    index += 1;
    candidate = `${baseCandidate} (${index})`;
  }
  return candidate;
};
