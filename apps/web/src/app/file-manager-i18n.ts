import type { Language } from '@drawnix/drawnix';

export type FileManagerCopy = {
  sidebarTitle: string;
  toggleAria: string;
  newFile: string;
  newFolder: string;
  upload: string;
  uploading: string;
  currentDirectory: string;
  root: string;
  backToRoot: string;
  emptyState: string;
  moreActions: string;
  rename: string;
  delete: string;
  createDialog: {
    title: string;
    nameLabel: string;
    typeLabel: string;
    cancel: string;
    confirm: string;
  };
  deleteDialog: {
    title: string;
    messagePrefix: string;
    messageSuffix: string;
    warning: string;
    confirm: string;
    folderInfo: (count: number, itemLabel: ItemLabel) => string;
  };
  validation: {
    nameRequired: string;
    nameExists: string;
  };
  defaultNames: {
    untitled: string;
    folder: string;
    canvas: string;
    canvasWithIndex: (index: number) => string;
  };
  fileTypes: Record<'domain' | 'problem' | 'plan' | 'others', string>;
  itemLabels: {
    file: ItemLabel;
    folder: ItemLabel;
  };
  quotes: {
    left: string;
    right: string;
  };
};

type ItemLabel = {
  singular: string;
  plural: string;
};

export const FILE_MANAGER_DEFAULT_LANGUAGE: Language = 'zh';

const zhCopy: FileManagerCopy = {
  sidebarTitle: '文件管理',
  toggleAria: '切换文件列表',
  newFile: '新建文件',
  newFolder: '新建文件夹',
  upload: '上传 PDDL 文件',
  uploading: '正在上传 PDDL 文件',
  currentDirectory: '当前目录：',
  root: '根目录',
  backToRoot: '返回根目录',
  emptyState: '暂无画布',
  moreActions: '更多操作',
  rename: '重命名',
  delete: '删除',
  createDialog: {
    title: '新建规划',
    nameLabel: '名称',
    typeLabel: '类型',
    cancel: '取消',
    confirm: '创建',
  },
  deleteDialog: {
    title: '确认删除',
    messagePrefix: '确定要删除',
    messageSuffix: '吗？',
    warning: '删除后无法恢复。',
    confirm: '删除',
    folderInfo: (count, itemLabel) =>
      count > 0 ? `（包含 ${count} 个${itemLabel.singular}）` : '',
  },
  validation: {
    nameRequired: '名称不能为空',
    nameExists: '名称已存在',
  },
  defaultNames: {
    untitled: '未命名',
    folder: '文件夹',
    canvas: '画布',
    canvasWithIndex: (index: number) => `画布 ${index}`,
  },
  fileTypes: {
    domain: '领域模型',
    problem: '规划问题',
    plan: '规划任务',
    others: '其他',
  },
  itemLabels: {
    file: {
      singular: '画布',
      plural: '画布',
    },
    folder: {
      singular: '文件夹',
      plural: '文件夹',
    },
  },
  quotes: {
    left: '「',
    right: '」',
  },
};

const enCopy: FileManagerCopy = {
  sidebarTitle: 'Files',
  toggleAria: 'Toggle file list',
  newFile: 'New file',
  newFolder: 'New folder',
  upload: 'Upload PDDL file',
  uploading: 'Uploading PDDL file…',
  currentDirectory: 'Current directory: ',
  root: 'Root',
  backToRoot: 'Back to root',
  emptyState: 'No canvases yet',
  moreActions: 'More actions',
  rename: 'Rename',
  delete: 'Delete',
  createDialog: {
    title: 'Create canvas',
    nameLabel: 'Name',
    typeLabel: 'Type',
    cancel: 'Cancel',
    confirm: 'Create',
  },
  deleteDialog: {
    title: 'Delete item',
    messagePrefix: 'Are you sure you want to delete the',
    messageSuffix: '?',
    warning: 'This action cannot be undone.',
    confirm: 'Delete',
    folderInfo: (count, itemLabel) => {
      if (count <= 0) {
        return '';
      }
      const label = count === 1 ? itemLabel.singular : itemLabel.plural;
      return ` (contains ${count} ${label})`;
    },
  },
  validation: {
    nameRequired: 'Name is required',
    nameExists: 'Name already exists',
  },
  defaultNames: {
    untitled: 'Untitled',
    folder: 'Folder',
    canvas: 'Canvas',
    canvasWithIndex: (index: number) => `Canvas ${index}`,
  },
  fileTypes: {
    domain: 'Domain',
    problem: 'Problem',
    plan: 'Plan',
    others: 'Others',
  },
  itemLabels: {
    file: {
      singular: 'canvas',
      plural: 'canvases',
    },
    folder: {
      singular: 'folder',
      plural: 'folders',
    },
  },
  quotes: {
    left: '“',
    right: '”',
  },
};

const translations: Record<Language, FileManagerCopy> = {
  zh: zhCopy,
  en: enCopy,
  ru: enCopy,
  ar: enCopy,
};

const isSupportedLanguage = (value: unknown): value is Language =>
  value === 'zh' || value === 'en' || value === 'ru' || value === 'ar';

export const getStoredLanguage = (): Language => {
  if (typeof window === 'undefined') {
    return FILE_MANAGER_DEFAULT_LANGUAGE;
  }
  const stored = window.localStorage.getItem('language');
  return isSupportedLanguage(stored) ? stored : FILE_MANAGER_DEFAULT_LANGUAGE;
};

export const getFileManagerTexts = (
  language: Language | string | null | undefined
): FileManagerCopy => {
  if (language && isSupportedLanguage(language)) {
    return translations[language];
  }
  return translations[FILE_MANAGER_DEFAULT_LANGUAGE];
};

export const isChineseLanguage = (language: Language | string): boolean =>
  language === 'zh';
