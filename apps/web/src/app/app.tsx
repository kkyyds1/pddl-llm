import {
  ChangeEvent,
  SVGProps,
  useState,
  useEffect,
  useCallback,
  useRef,
} from 'react';
import { Drawnix } from '@drawnix/drawnix';
import {
  PlaitBoard,
  PlaitElement,
  PlaitPointerType,
  Selection,
  getSelectedElements,
  getHitElementByPoint,
  toHostPoint,
  toViewBoxPoint,
} from '@plait/core';
import { BasicShapes } from '@plait/draw';
import localforage from 'localforage';
import styles from './app.module.scss';
import {
  PddlDomain,
  PddlParseResponse,
  PddlProblem,
} from './pddl-types';
import { convertPddlDomainToGraph, convertPddlProblemToGraph } from '../utils/pddl-to-graph';
import {
  AppValue,
  BoardEntry,
  BoardFileEntry,
  FileType,
  LegacyStoredFile,
  FILE_TYPE_ICON_MAP,
  FILE_TYPE_OPTIONS,
  addEntryToFolder,
  collectFolderIds,
  convertLegacyFilesToEntries,
  createBlankFile,
  createFolder,
  ensureUniqueFileName,
  findEntryById,
  findFileById,
  findFolderById,
  flattenFiles,
  generateNewFileName,
  generateNewFolderName,
  hasContent,
  isBoardEntryArray,
  isNameTaken,
  normalizeEntries,
  removeEntryById,
  updateEntryById,
} from './file-manager';
import {
  detectPddlFileType,
  isDomainPayload,
  isProblemPayload,
  stripFileExtension,
} from './pddl-utils';

type DeleteTarget = {
  id: string;
  name: string;
  type: BoardEntry['type'];
  fileCount: number;
};

type IconProps = SVGProps<SVGSVGElement>;

type SolverPlanStep = {
  action: string;
  parameters?: string[];
  time?: number;
  duration?: number;
  annotation?: string;
  Annotation?: string;
};

type SolvePlanResponse = {
  success?: boolean;
  solver?: string;
  plan?: SolverPlanStep[];
  cost?: number | string;
  metric?: number | string;
  message?: string;
  error?: string;
};

const PLAN_NODE_HEIGHT = 70;
const PLAN_NODE_GAP = 18;
const PLAN_COLUMN_GAP = 24;
const PLAN_LIST_START_X = 140;
const PLAN_LIST_START_Y = 80;
const PLAN_TIME_COL_WIDTH = 140;
const PLAN_ACTION_COL_WIDTH = 220;
const PLAN_PARAM_COL_WIDTH = 150;
const PLAN_COMMENT_COL_WIDTH = 360;

const createPlanElementId = (prefix: string) =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const formatPlanNumber = (value?: number) =>
  typeof value === 'number' ? value.toFixed(3) : '—';

const formatPlanCost = (value?: number | string) => {
  if (typeof value === 'number') {
    return value.toFixed(3);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return '未知';
};

const formatPlanParameters = (parameters?: string[]) => {
  if (!Array.isArray(parameters) || parameters.length === 0) {
    return '无参数';
  }
  return parameters.join(', ');
};

const createPlanNodeElement = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  lines: string[],
  isHeader = false
): PlaitElement => {
  return {
    id,
    type: 'geometry',
    shape: BasicShapes.rectangle,
    points: [
      [x, y],
      [x + width, y + height],
    ],
    angle: 0,
    opacity: 1,
    fill: isHeader ? '#e0f2fe' : '#fff7ed',
    strokeColor: isHeader ? '#0284c7' : '#fb923c',
    strokeWidth: 2,
    text: {
      children: lines.map((line) => ({
        type: 'paragraph',
        align: 'left',
        children: [
          {
            text: line,
          },
        ],
      })),
    },
  } as PlaitElement;
};

const buildPlanElements = (
  planSteps: SolverPlanStep[],
  totalCost?: number | string,
  solverName?: string
): PlaitElement[] => {
  const elements: PlaitElement[] = [];
  let currentY = PLAN_LIST_START_Y;
  const maxParamCount = planSteps.reduce((max, step) => {
    const count = Array.isArray(step.parameters) ? step.parameters.length : 0;
    return Math.max(max, count);
  }, 0);
  const timeColumnX = PLAN_LIST_START_X;
  const actionColumnX = timeColumnX + PLAN_TIME_COL_WIDTH + PLAN_COLUMN_GAP;
  const paramStartX = actionColumnX + PLAN_ACTION_COL_WIDTH + PLAN_COLUMN_GAP;
  const commentColumnX =
    maxParamCount > 0
      ? paramStartX + maxParamCount * (PLAN_PARAM_COL_WIDTH + PLAN_COLUMN_GAP)
      : paramStartX;
  const summaryWidth =
    commentColumnX + PLAN_COMMENT_COL_WIDTH - PLAN_LIST_START_X;

  const headerLines = [
    `求解器：${solverName || '未提供'}`,
    `总代价：${formatPlanCost(totalCost)}`,
    `动作总数：${planSteps.length}`,
  ];
  elements.push(
    createPlanNodeElement(
      createPlanElementId('plan-header'),
      PLAN_LIST_START_X,
      currentY,
      summaryWidth,
      PLAN_NODE_HEIGHT,
      headerLines,
      true
    )
  );
  currentY += PLAN_NODE_HEIGHT + PLAN_NODE_GAP;

  elements.push(
    createPlanNodeElement(
      createPlanElementId('plan-time-header'),
      timeColumnX,
      currentY,
      PLAN_TIME_COL_WIDTH,
      PLAN_NODE_HEIGHT,
      ['时间 (t)'],
      true
    )
  );
  elements.push(
    createPlanNodeElement(
      createPlanElementId('plan-action-header'),
      actionColumnX,
      currentY,
      PLAN_ACTION_COL_WIDTH,
      PLAN_NODE_HEIGHT,
      ['动作'],
      true
    )
  );
  for (let i = 0; i < maxParamCount; i += 1) {
    const paramX = paramStartX + i * (PLAN_PARAM_COL_WIDTH + PLAN_COLUMN_GAP);
    elements.push(
      createPlanNodeElement(
        createPlanElementId(`plan-param-header-${i}`),
        paramX,
        currentY,
        PLAN_PARAM_COL_WIDTH,
        PLAN_NODE_HEIGHT,
        [`参数 ${i + 1}`],
        true
      )
    );
  }
  elements.push(
    createPlanNodeElement(
      createPlanElementId('plan-comment-header'),
      commentColumnX,
      currentY,
      PLAN_COMMENT_COL_WIDTH,
      PLAN_NODE_HEIGHT,
      ['中文说明'],
      true
    )
  );
  currentY += PLAN_NODE_HEIGHT + PLAN_NODE_GAP;

  planSteps.forEach((step, index) => {
    const parameters = Array.isArray(step.parameters) ? step.parameters : [];
    const paramTextJoined = formatPlanParameters(parameters);
    const durationLabel =
      typeof step.duration === 'number' ? `[${formatPlanNumber(step.duration)}]` : '';
    const customAnnotation =
      typeof step.annotation === 'string' && step.annotation.trim().length > 0
        ? step.annotation.trim()
        : typeof step.Annotation === 'string' && step.Annotation.trim().length > 0
        ? step.Annotation.trim()
        : null;
    const zhLine =
      customAnnotation ||
      `执行 ${step.action}${
        paramTextJoined !== '无参数' ? `，涉及 ${paramTextJoined}` : ''
      }`;

    elements.push(
      createPlanNodeElement(
        createPlanElementId(`plan-time-${index}`),
        timeColumnX,
        currentY,
        PLAN_TIME_COL_WIDTH,
        PLAN_NODE_HEIGHT,
        [`t=${formatPlanNumber(step.time)}`],
        false
      )
    );
    elements.push(
      createPlanNodeElement(
        createPlanElementId(`plan-action-${index}`),
        actionColumnX,
        currentY,
        PLAN_ACTION_COL_WIDTH,
        PLAN_NODE_HEIGHT,
        [step.action],
        false
      )
    );
    for (let i = 0; i < maxParamCount; i += 1) {
      const paramValue =
        i < parameters.length && typeof parameters[i] === 'string'
          ? parameters[i]
          : '—';
      const paramX = paramStartX + i * (PLAN_PARAM_COL_WIDTH + PLAN_COLUMN_GAP);
      elements.push(
        createPlanNodeElement(
          createPlanElementId(`plan-param-${index}-${i}`),
          paramX,
          currentY,
          PLAN_PARAM_COL_WIDTH,
          PLAN_NODE_HEIGHT,
          [paramValue],
          false
        )
      );
    }
    elements.push(
      createPlanNodeElement(
        createPlanElementId(`plan-comment-${index}`),
        commentColumnX,
        currentY,
        PLAN_COMMENT_COL_WIDTH,
        PLAN_NODE_HEIGHT,
        [zhLine],
        false
      )
    );
    currentY += PLAN_NODE_HEIGHT + PLAN_NODE_GAP;
  });

  return elements;
};

const FileAddIcon = (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l6 6v10a2 2 0 0 1-2 2z" />
    <path d="M12 11v6" />
    <path d="M9 14h6" />
  </svg>
);

const FolderAddIcon = (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M16.5 14.5h5" />
    <path d="M19 12v5" />
  </svg>
);

const UploadArrowIcon = (props: IconProps) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M12 3v10" />
    <path d="M8.5 6.5 12 3l3.5 3.5" />
    <path d="M5 15v2.5A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5V15" />
  </svg>
);

const LEGACY_MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const LEGACY_BOARD_FILES_KEY = 'board_files';
const BOARD_ENTRIES_KEY = 'board_entries';
const CURRENT_FILE_ID_KEY = 'current_board_file_id';

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});
const rawApiBaseUrl =
  (import.meta as any)?.env?.VITE_PDDL_API_BASE_URL as string | undefined;
const API_BASE_URL = (typeof rawApiBaseUrl === 'string' ? rawApiBaseUrl : '').trim();
const DEFAULT_API_BASE_URL = (() => {
  if (API_BASE_URL || typeof window === 'undefined') {
    return '';
  }
  const { protocol, hostname } = window.location;
  if (!hostname) {
    return '';
  }
  const normalizedHost = hostname.includes(':') ? `[${hostname}]` : hostname;
  return `${protocol}//${normalizedHost}:5000`;
})();
const buildApiUrl = (path: string) => {
  const base = API_BASE_URL || DEFAULT_API_BASE_URL;
  if (!base) {
    return path;
  }
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
};

const NODE_HIGHLIGHT_CLASS = 'drawnix-highlight-node';
const EDGE_HIGHLIGHT_CLASS = 'drawnix-highlight-edge';

const flattenPlaitElements = (elements: PlaitElement[]): PlaitElement[] => {
  const result: PlaitElement[] = [];
  elements.forEach((element) => {
    result.push(element);
    if (Array.isArray(element.children) && element.children.length > 0) {
      result.push(
        ...flattenPlaitElements(element.children as PlaitElement[])
      );
    }
  });
  return result;
};

const clamp = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

// 获取节点的文本内容
const getElementTextContent = (element: PlaitElement): string => {
  if (!element.text) return '';
  
  try {
    // 处理 Slate.js 格式的文本结构
    if (Array.isArray(element.text.children)) {
      return element.text.children
        .map((child: any) => {
          if (Array.isArray(child.children)) {
            return child.children
              .map((textNode: any) => textNode.text || '')
              .join('');
          }
          return child.text || '';
        })
        .join('');
    }
  } catch (error) {
    console.warn('解析节点文本内容失败:', error);
  }
  
  return '';
};

// 从节点label中提取type
const getElementType = (element: PlaitElement): string => {
  const textContent = getElementTextContent(element);
  if (!textContent.trim()) return '';
  
  // 如果包含冒号，取冒号后面的内容作为type
  const colonIndex = textContent.indexOf(':');
  if (colonIndex !== -1 && colonIndex < textContent.length - 1) {
    return textContent.substring(colonIndex + 1).trim();
  }
  
  // 如果没有冒号，整个label就是type
  return textContent.trim();
};

// 检查两个节点的type是否相同
const isSameType = (type1: string, type2: string): boolean => {
  return type1.toLowerCase() === type2.toLowerCase();
};

// 同步相同type节点的背景图片
const syncBackgroundImageForSameType = (
  board: PlaitBoard,
  changedElement: PlaitElement,
  backgroundImage: string | null
) => {
  if (!board || changedElement.type !== 'geometry') return;
  
  const changedElementType = getElementType(changedElement);
  if (!changedElementType) return;
  
  const allElements = flattenPlaitElements(board.children as PlaitElement[]);
  
  // 找到所有具有相同type的几何节点
  const matchingElements = allElements.filter((element) => {
    return (
      element.type === 'geometry' &&
      element.id !== changedElement.id &&
      isSameType(getElementType(element), changedElementType)
    );
  });
  
  // 更新匹配节点的背景图片
  let hasChanges = false;
  matchingElements.forEach((element) => {
    if (backgroundImage) {
      if ((element as any).backgroundImage !== backgroundImage) {
        (element as any).backgroundImage = backgroundImage;
        hasChanges = true;
      }
    } else {
      if ((element as any).backgroundImage) {
        delete (element as any).backgroundImage;
        hasChanges = true;
      }
    }
  });
  
  // 如果有变化，强制重新渲染板子
  if (hasChanges) {
    console.log(`同步背景图片到 ${matchingElements.length} 个相同type(${changedElementType})的节点`);
    
    // 触发板子重新渲染
    setTimeout(() => {
      board.redraw();
    }, 0);
  }
};

export function App() {
  const [value, setValue] = useState<AppValue>({ children: [] });
  const [entries, setEntries] = useState<BoardEntry[]>([]);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [renamingEntryId, setRenamingEntryId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [activeTypeMenuId, setActiveTypeMenuId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [createType, setCreateType] = useState<FileType>('domain');
  const [createError, setCreateError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [tutorial, setTutorial] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
  }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [solvingPlan, setSolvingPlan] = useState(false);
  const boardRef = useRef<PlaitBoard | null>(null);
  const highlightedElementsRef = useRef<Set<string>>(new Set());
  const previousElementsRef = useRef<Map<string, any>>(new Map());
  const nodeClickCleanupRef = useRef<(() => void) | null>(null);
  const toggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const togglePointerOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const toggleDraggingRef = useRef(false);
  const toggleHasMovedRef = useRef(false);
  const ignoreToggleClickRef = useRef(false);
  const [toggleButtonPosition, setToggleButtonPosition] = useState({ top: 16, left: 16 });
  const [isDraggingToggle, setIsDraggingToggle] = useState(false);
  
  // 检测背景图片变化并同步
  const detectAndSyncBackgroundChanges = useCallback((elements: PlaitElement[]) => {
    const board = boardRef.current;
    if (!board) return;
    
    const allElements = flattenPlaitElements(elements);
    const currentElementsMap = new Map<string, any>();
    
    allElements.forEach((element) => {
      if (element.type === 'geometry' && element.id) {
        currentElementsMap.set(element.id, {
          backgroundImage: (element as any).backgroundImage,
          elementType: getElementType(element)
        });
      }
    });
    
    // 检查背景图片变化
    currentElementsMap.forEach((current, elementId) => {
      const previous = previousElementsRef.current.get(elementId);
      
      if (previous && current.backgroundImage !== previous.backgroundImage) {
        const changedElement = allElements.find(e => e.id === elementId);
        if (changedElement) {
          syncBackgroundImageForSameType(board, changedElement, current.backgroundImage);
        }
      }
    });
    
    previousElementsRef.current = currentElementsMap;
  }, []);
  
  const persistEntries = useCallback(
    (nextEntries: BoardEntry[]) => localforage.setItem(BOARD_ENTRIES_KEY, nextEntries),
    []
  );

  const updateEntriesState = useCallback(
    (updater: (prev: BoardEntry[]) => BoardEntry[]) => {
      setEntries((prev) => {
        const next = updater(prev);
        void persistEntries(next);
        return next;
      });
    },
    [persistEntries]
  );

  const clearDomHighlights = useCallback(() => {
    const board = boardRef.current;
    if (!board || highlightedElementsRef.current.size === 0) {
      highlightedElementsRef.current = new Set();
      return;
    }
    const allElements = flattenPlaitElements(board.children as PlaitElement[]);
    const elementMap = new Map<string, PlaitElement>();
    allElements.forEach((element) => {
      if (element?.id) {
        elementMap.set(element.id, element);
      }
    });
    highlightedElementsRef.current.forEach((id) => {
      const element = elementMap.get(id);
      if (!element) {
        return;
      }
      const g = PlaitElement.getElementG(element);
      g?.classList.remove(NODE_HIGHLIGHT_CLASS, EDGE_HIGHLIGHT_CLASS);
    });
    highlightedElementsRef.current = new Set();
  }, [currentFileId, entries, setTutorial, updateEntriesState]);

  const updateConnectionHighlight = useCallback((baseElements?: PlaitElement[]) => {
    const board = boardRef.current;
    if (!board) {
      return;
    }

    const allElements = flattenPlaitElements(board.children as PlaitElement[]);
    const elementMap = new Map<string, PlaitElement>();
    allElements.forEach((element) => {
      if (element?.id) {
        elementMap.set(element.id, element);
      }
    });
    const arrowLines = allElements.filter(
      (element) => element.type === 'arrow-line'
    );
    const selectedElements = baseElements ?? getSelectedElements(board);
    const nextHighlightIds = new Set<string>();

    selectedElements.forEach((element) => {
      if (!element?.id || element.type === 'group') {
        return;
      }

      nextHighlightIds.add(element.id);

      if (element.type === 'arrow-line') {
        const sourceId = (element as any)?.source?.boundId;
        const targetId = (element as any)?.target?.boundId;
        if (sourceId && elementMap.has(sourceId)) {
          nextHighlightIds.add(sourceId);
        }
        if (targetId && elementMap.has(targetId)) {
          nextHighlightIds.add(targetId);
        }
        return;
      }

      arrowLines.forEach((line) => {
        const lineSourceId = (line as any)?.source?.boundId;
        const lineTargetId = (line as any)?.target?.boundId;
        if (lineSourceId === element.id || lineTargetId === element.id) {
          nextHighlightIds.add(line.id);
          if (lineSourceId && elementMap.has(lineSourceId)) {
            nextHighlightIds.add(lineSourceId);
          }
          if (lineTargetId && elementMap.has(lineTargetId)) {
            nextHighlightIds.add(lineTargetId);
          }
        }
      });
    });

    const previousIds = highlightedElementsRef.current;
    previousIds.forEach((id) => {
      if (!nextHighlightIds.has(id)) {
        const element = elementMap.get(id);
        if (!element) {
          return;
        }
        const g = PlaitElement.getElementG(element);
        g?.classList.remove(NODE_HIGHLIGHT_CLASS, EDGE_HIGHLIGHT_CLASS);
      }
    });

    nextHighlightIds.forEach((id) => {
      const element = elementMap.get(id);
      if (!element) {
        return;
      }
      const g = PlaitElement.getElementG(element);
      if (!g) {
        return;
      }
      const targetClass =
        element.type === 'arrow-line'
          ? EDGE_HIGHLIGHT_CLASS
          : NODE_HIGHLIGHT_CLASS;
      if (!g.classList.contains(targetClass)) {
        g.classList.add(targetClass);
      }
      if (targetClass === NODE_HIGHLIGHT_CLASS) {
        g.classList.remove(EDGE_HIGHLIGHT_CLASS);
      } else {
        g.classList.remove(NODE_HIGHLIGHT_CLASS);
      }
    });

    highlightedElementsRef.current = new Set(nextHighlightIds);
  }, []);

  const handleSelectionChange = useCallback(
    (_selection: Selection | null) => {
      updateConnectionHighlight();
    },
    [updateConnectionHighlight]
  );

  const attachNodeClickHighlight = useCallback(
    (board: PlaitBoard) => {
      const host = PlaitBoard.getElementHost(board);
      if (!host) {
        return;
      }

      const handleClick = (event: MouseEvent) => {
        const currentBoard = boardRef.current;
        if (!currentBoard) {
          return;
        }
        if (!PlaitBoard.isFocus(currentBoard) || PlaitBoard.hasBeenTextEditing(currentBoard)) {
          return;
        }
        const pointer = PlaitBoard.getPointer<PlaitPointerType>(currentBoard);
        if (pointer !== PlaitPointerType.hand) {
          return;
        }
        const hostPoint = toHostPoint(currentBoard, event.clientX, event.clientY);
        const viewBoxPoint = toViewBoxPoint(currentBoard, hostPoint);
        const hitElement = getHitElementByPoint(
          currentBoard,
          viewBoxPoint,
          (element) => Boolean(element?.id) && element.type !== 'group'
        );
        if (hitElement) {
          updateConnectionHighlight([hitElement]);
        } else {
          updateConnectionHighlight([]);
        }
      };

      nodeClickCleanupRef.current?.();
      host.addEventListener('click', handleClick);
      nodeClickCleanupRef.current = () => {
        host.removeEventListener('click', handleClick);
      };
    },
    [updateConnectionHighlight]
  );

  useEffect(() => {
    return () => {
      clearDomHighlights();
      nodeClickCleanupRef.current?.();
      boardRef.current = null;
    };
  }, [clearDomHighlights]);

  useEffect(() => {
    updateConnectionHighlight();
  }, [value.children, updateConnectionHighlight]);
  
  useEffect(() => {
    const loadData = async () => {
      const [storedEntries, storedCurrentId, legacyFilesRaw, legacySingle] =
        await Promise.all([
          localforage.getItem<BoardEntry[]>(BOARD_ENTRIES_KEY),
          localforage.getItem<string>(CURRENT_FILE_ID_KEY),
          localforage.getItem<LegacyStoredFile[] | BoardEntry[]>(LEGACY_BOARD_FILES_KEY),
          localforage.getItem<AppValue>(LEGACY_MAIN_BOARD_CONTENT_KEY),
        ]);

      let nextEntries = storedEntries ?? null;
      let nextCurrentId = storedCurrentId ?? null;
      let shouldPersistEntries = false;

      if (!nextEntries || nextEntries.length === 0) {
        if (Array.isArray(legacyFilesRaw) && legacyFilesRaw.length > 0) {
          if (isBoardEntryArray(legacyFilesRaw)) {
            nextEntries = legacyFilesRaw;
          } else {
            nextEntries = convertLegacyFilesToEntries(legacyFilesRaw as LegacyStoredFile[]);
          }
          shouldPersistEntries = true;
          await localforage.removeItem(LEGACY_BOARD_FILES_KEY);
        } else if (legacySingle) {
          const migratedFile = createBlankFile('画布 1', legacySingle, 'others');
          nextEntries = [migratedFile];
          shouldPersistEntries = true;
          await localforage.removeItem(LEGACY_MAIN_BOARD_CONTENT_KEY);
        }
      }

      if (!nextEntries || nextEntries.length === 0) {
        nextEntries = [createBlankFile('画布 1', undefined, 'others')];
        shouldPersistEntries = true;
      }

      nextEntries = normalizeEntries(nextEntries);

      let files = flattenFiles(nextEntries);

      if (!files.length) {
        const fallbackFile = createBlankFile('画布 1', undefined, 'others');
        nextEntries = [...nextEntries, fallbackFile];
        files = [fallbackFile];
        shouldPersistEntries = true;
      }

      let initialFile = files.find((file) => file.id === nextCurrentId);

      if (!initialFile) {
        initialFile = files[0];
        if (initialFile) {
          nextCurrentId = initialFile.id;
        }
      }

      setEntries(nextEntries);

      if (initialFile) {
        setCurrentFileId(initialFile.id);
        setValue(initialFile.data);
        setTutorial(!hasContent(initialFile.data));
      }

      if (shouldPersistEntries) {
        await persistEntries(nextEntries);
      }

      if (nextCurrentId) {
        await localforage.setItem(CURRENT_FILE_ID_KEY, nextCurrentId);
      }

      setInitialized(true);
    };

    void loadData();
  }, [persistEntries]);

  useEffect(() => {
    if (renamingEntryId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingEntryId]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => !open);
  }, []);

  const updateToggleButtonPosition = useCallback((clientX: number, clientY: number) => {
    if (typeof window === 'undefined') {
      return;
    }
    const button = toggleButtonRef.current;
    const offset = togglePointerOffsetRef.current;
    const width = button?.offsetWidth ?? 44;
    const height = button?.offsetHeight ?? 44;
    const maxLeft = Math.max(window.innerWidth - width - 8, 0);
    const maxTop = Math.max(window.innerHeight - height - 8, 0);
    const nextLeft = clamp(clientX - offset.x, 8, maxLeft);
    const nextTop = clamp(clientY - offset.y, 8, maxTop);
    setToggleButtonPosition((prev) => {
      const deltaX = Math.abs(prev.left - nextLeft);
      const deltaY = Math.abs(prev.top - nextTop);
      if (deltaX < 0.5 && deltaY < 0.5) {
        return prev;
      }
      if (deltaX > 1 || deltaY > 1) {
        toggleHasMovedRef.current = true;
      }
      return { left: nextLeft, top: nextTop };
    });
  }, []);

  const handleToggleButtonPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    const button = toggleButtonRef.current;
    if (!button) {
      return;
    }
    const rect = button.getBoundingClientRect();
    togglePointerOffsetRef.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    toggleDraggingRef.current = true;
    toggleHasMovedRef.current = false;
    setIsDraggingToggle(true);
    button.setPointerCapture?.(event.pointerId);
  }, []);

  const handleToggleButtonPointerMove = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!toggleDraggingRef.current) {
        return;
      }
      event.preventDefault();
      updateToggleButtonPosition(event.clientX, event.clientY);
    },
    [updateToggleButtonPosition]
  );

  const endToggleDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!toggleDraggingRef.current) {
      return;
    }
    toggleDraggingRef.current = false;
    setIsDraggingToggle(false);
    toggleButtonRef.current?.releasePointerCapture?.(event.pointerId);
    if (toggleHasMovedRef.current) {
      ignoreToggleClickRef.current = true;
    }
  }, []);

  const handleToggleButtonPointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      endToggleDrag(event);
    },
    [endToggleDrag]
  );

  const handleToggleButtonPointerCancel = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      endToggleDrag(event);
    },
    [endToggleDrag]
  );

  const handleToggleButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (ignoreToggleClickRef.current) {
        ignoreToggleClickRef.current = false;
        return;
      }
      toggleSidebar();
    },
    [toggleSidebar]
  );
  const triggerUploadDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);
  const handlePddlUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) {
        return;
      }
      const fileText = await file.text();
      const content = fileText.trim();
      if (!content) {
        window.alert('上传的 PDDL 文件内容为空。');
        return;
      }
      const detectedType = detectPddlFileType(content);
      if (!detectedType) {
        window.alert('无法识别上传的 PDDL 文件类型（domain 或 problem）。');
        return;
      }
      setUploading(true);
      try {
        const response = await fetch(
          buildApiUrl(
            detectedType === 'domain'
              ? '/pddl/parse_domain'
              : '/pddl/parse_problem'
          ),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              [detectedType]: content,
            }),
          }
        );
        let payload: PddlParseResponse<PddlDomain | PddlProblem>;
        try {
          payload = (await response.json()) as PddlParseResponse<
            PddlDomain | PddlProblem
          >;
        } catch {
          throw new Error('解析接口返回了无效的 JSON 数据。');
        }
        if (!response.ok) {
          const errorMessage =
            !payload.success && payload.error
              ? payload.error
              : `${response.status} ${response.statusText}`;
          throw new Error(errorMessage);
        }
        if (!payload.success) {
          throw new Error(payload.error || '解析失败，请稍后重试。');
        }
        const parsedName =
          detectedType === 'domain'
            ? (payload.content as PddlDomain).name
            : (payload.content as PddlProblem).name;
        const fallbackName =
          stripFileExtension(file.name) ||
          (detectedType === 'domain' ? 'Domain 文件' : 'Problem 文件');
        const uniqueName = ensureUniqueFileName(entries, parsedName, fallbackName);
        
        // 为domain文件创建图形元素
        let initialData: AppValue = { children: [] };
        if (detectedType === 'domain' || detectedType === 'problem') {
          try {
            const graphElements = detectedType === 'domain'
              ? convertPddlDomainToGraph(payload.content as PddlDomain)
              : convertPddlProblemToGraph(payload.content as PddlProblem);
            initialData = { children: graphElements };
          } catch (graphError) {
            console.warn('图形转换失败，创建空白画布:', graphError);
            // 继续创建空白画布，不中断上传流程
          }
        }
        
        const newFile = createBlankFile(uniqueName, initialData, detectedType);
        updateEntriesState((prev) => {
          if (!selectedFolderId) {
            return [...prev, newFile];
          }
          const result = addEntryToFolder(prev, selectedFolderId, newFile);
          if (result.inserted) {
            return result.entries;
          }
          return [...prev, newFile];
        });
        setCurrentFileId(newFile.id);
        setValue(newFile.data);
        setTutorial(!hasContent(newFile.data));
        setSidebarOpen(false);
        await localforage.setItem(CURRENT_FILE_ID_KEY, newFile.id);
      } catch (error) {
        console.error(error);
        window.alert(
          error instanceof Error
            ? `PDDL 解析失败：${error.message}`
            : 'PDDL 解析失败，请稍后重试。'
        );
      } finally {
        setUploading(false);
      }
    },
    [
      entries,
      selectedFolderId,
      updateEntriesState,
      setCurrentFileId,
      setValue,
      setTutorial,
      setSidebarOpen,
    ]
  );
  
  const handleSolvePlanRequest = useCallback(async () => {
    if (solvingPlan) {
      window.alert('正在求解计划，请稍后…');
      return;
    }
    setSolvingPlan(true);
    try {
      const currentFile =
        currentFileId && entries.length > 0
          ? findFileById(entries, currentFileId)
          : null;

      const response = await fetch(buildApiUrl('/pddl/solve'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileId: currentFileId,
          fileType: currentFile?.fileType ?? 'others',
        }),
      });

      let payload: SolvePlanResponse;
      try {
        payload = (await response.json()) as SolvePlanResponse;
      } catch {
        throw new Error('后端返回了无效的 JSON 响应。');
      }

      if (!response.ok || !payload?.success) {
        const reason =
          (payload && (payload.message || payload.error)) ||
          `${response.status} ${response.statusText}`;
        throw new Error(reason);
      }

      const planSteps = Array.isArray(payload.plan) ? payload.plan : [];
      if (planSteps.length === 0) {
        throw new Error('求解成功但未返回可用的 plan 序列。');
      }

      const planElements = buildPlanElements(
        planSteps,
        payload.cost ?? payload.metric,
        payload.solver
      );
      const planData: AppValue = {
        children: planElements,
      };
      const preferredName = payload.solver
        ? `${payload.solver} Plan`
        : '求解 Plan';
      const planName = ensureUniqueFileName(entries, preferredName, 'Plan');
      const planFile = createBlankFile(planName, planData, 'plan');

      updateEntriesState((prev) => {
        if (!selectedFolderId) {
          return [...prev, planFile];
        }
        const result = addEntryToFolder(prev, selectedFolderId, planFile);
        if (result.inserted) {
          return result.entries;
        }
        return [...prev, planFile];
      });

      setCurrentFileId(planFile.id);
      setValue(planData);
      setTutorial(!hasContent(planData));
      setSidebarOpen(false);
      await localforage.setItem(CURRENT_FILE_ID_KEY, planFile.id);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? `求解失败：${error.message}`
          : '求解失败，请稍后重试。'
      );
    } finally {
      setSolvingPlan(false);
    }
  }, [
    solvingPlan,
    currentFileId,
    entries,
    selectedFolderId,
    updateEntriesState,
    setCurrentFileId,
    setValue,
    setTutorial,
    setSidebarOpen,
  ]);
  
  useEffect(() => {
    const listener = () => {
      void handleSolvePlanRequest();
    };
    window.addEventListener('drawnix:pddl-solve-request', listener);
    return () => {
      window.removeEventListener('drawnix:pddl-solve-request', listener);
    };
  }, [handleSolvePlanRequest]);
  
  // LLM 聊天相关函数
  const toggleChat = useCallback(() => {
    setChatOpen(prev => !prev);
  }, []);

  const handleSendMessage = useCallback(async (content: string) => {
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content,
      timestamp: Date.now(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    
    try {
      type ChatGenerateResponse = {
        initial_pddl?: unknown;
        content?: unknown;
      };

      const currentFile =
        currentFileId && entries.length > 0
          ? findFileById(entries, currentFileId)
          : null;
      const requestedPddlType: FileType =
        currentFile && currentFile.type === 'file'
          ? currentFile.fileType
          : 'others';

      const response = await fetch(buildApiUrl('/chat/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pddl_type: requestedPddlType }),
      });

      let payload: ChatGenerateResponse;
      try {
        payload = (await response.json()) as ChatGenerateResponse;
      } catch {
        throw new Error('后端返回了无效的 JSON 响应。');
      }

      if (!response.ok) {
        const reason =
          typeof payload.content === 'string' && payload.content
            ? payload.content
            : `${response.status} ${response.statusText}`;
        throw new Error(reason);
      }

      if (payload.initial_pddl) {
        let parsedPayload: unknown = payload.initial_pddl;
        if (typeof parsedPayload === 'string') {
          try {
            parsedPayload = JSON.parse(parsedPayload) as unknown;
          } catch (parseError) {
            console.warn('初始 PDDL 解析失败:', parseError);
            parsedPayload = null;
          }
        }

        let inferredType: FileType = requestedPddlType;
        let nextValue: AppValue | null = null;

        if (isDomainPayload(parsedPayload)) {
          try {
            const graphElements = convertPddlDomainToGraph(parsedPayload);
            nextValue = { children: graphElements };
            inferredType = 'domain';
          } catch (graphError) {
            console.warn('初始 Domain PDDL 转换为画布失败:', graphError);
          }
        } else if (isProblemPayload(parsedPayload)) {
          try {
            const graphElements = convertPddlProblemToGraph(parsedPayload);
            nextValue = { children: graphElements };
            inferredType = 'problem';
          } catch (graphError) {
            console.warn('初始 Problem PDDL 转换为画布失败:', graphError);
          }
        } else if (parsedPayload !== null) {
          console.warn('初始 PDDL 数据无法识别为 domain 或 problem:', parsedPayload);
        }

        if (nextValue) {
          setValue(nextValue);
          setTutorial(!hasContent(nextValue));
          if (currentFileId) {
            updateEntriesState((prev) =>
              updateEntryById(prev, currentFileId, (entry) => {
                if (entry.type !== 'file') {
                  return entry;
                }
                return {
                  ...entry,
                  data: nextValue as AppValue,
                  fileType: inferredType,
                  updatedAt: Date.now(),
                };
              })
            );
          }
        }
      }

      const assistantTimestamp = Date.now();
      const assistantMessage = {
        id: `assistant-${assistantTimestamp}`,
        role: 'assistant' as const,
        content:
          typeof payload.content === 'string' && payload.content
            ? payload.content
            : 'LLM 接口没有返回可显示的内容。',
        timestamp: assistantTimestamp,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('聊天错误:', error);
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant' as const,
        content: '抱歉，处理您的消息时出现了错误。请稍后重试。',
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [currentFileId, entries, setTutorial, updateEntriesState]);

  const handleCreateFile = useCallback(
    async (fileName: string, fileType: FileType) => {
      const trimmed = fileName.trim();
      let finalName = trimmed || generateNewFileName(entries);

      if (isNameTaken(entries, 'file', finalName)) {
        finalName = generateNewFileName(entries);
      }

      const newFile = createBlankFile(finalName, undefined, fileType);
      updateEntriesState((prev) => {
        if (!selectedFolderId) {
          return [...prev, newFile];
        }
        const result = addEntryToFolder(prev, selectedFolderId, newFile);
        if (result.inserted) {
          return result.entries;
        }
        return [...prev, newFile];
      });
      setCurrentFileId(newFile.id);
      setValue(newFile.data);
      setTutorial(true);
      setSidebarOpen(false);
      setActiveTypeMenuId(null);
      await localforage.setItem(CURRENT_FILE_ID_KEY, newFile.id);
    },
    [entries, selectedFolderId, updateEntriesState]
  );

  const cancelRename = useCallback(() => {
    setRenamingEntryId(null);
    setRenameValue('');
    setRenameError(null);
    renameInputRef.current = null;
    setActiveTypeMenuId(null);
  }, []);

  const handleCreateFolder = useCallback(() => {
    const name = generateNewFolderName(entries);
    const newFolder = createFolder(name);
    updateEntriesState((prev) => {
      if (!selectedFolderId) {
        return [...prev, newFolder];
      }
      const result = addEntryToFolder(prev, selectedFolderId, newFolder);
      if (result.inserted) {
        return result.entries;
      }
      return [...prev, newFolder];
    });
    setSelectedFolderId(newFolder.id);
    setSidebarOpen(true);
    setActiveTypeMenuId(null);
  }, [entries, selectedFolderId, updateEntriesState]);

  const openCreateDialog = useCallback(() => {
    cancelRename();
    const defaultName = generateNewFileName(entries);
    setCreateName(defaultName);
    setCreateType('domain');
    setCreateError(null);
    setCreateDialogOpen(true);
    setActiveTypeMenuId(null);
  }, [cancelRename, entries]);

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setCreateError(null);
  }, []);

  const confirmCreateFile = useCallback(async () => {
    const trimmed = createName.trim();
    if (!trimmed) {
      setCreateError('名称不能为空');
      return;
    }
    if (isNameTaken(entries, 'file', trimmed)) {
      setCreateError('名称已存在');
      return;
    }
    await handleCreateFile(trimmed, createType);
    setCreateDialogOpen(false);
    setCreateError(null);
  }, [createName, createType, entries, handleCreateFile]);

  const handleSelectFile = useCallback(
    async (fileId: string) => {
      if (fileId === currentFileId) {
        setSidebarOpen(false);
        return;
      }
      const target = findFileById(entries, fileId);
      if (!target) {
        return;
      }
      cancelRename();
      setCurrentFileId(target.id);
      setValue(target.data);
      setTutorial(!hasContent(target.data));
      setSidebarOpen(false);
      await localforage.setItem(CURRENT_FILE_ID_KEY, target.id);
    },
    [cancelRename, currentFileId, entries]
  );

  const startRenameEntry = useCallback(
    (entryId: string) => {
      const target = findEntryById(entries, entryId);
      if (!target) {
        return;
      }
      setRenamingEntryId(entryId);
      setRenameValue(target.name);
      setRenameError(null);
      setActiveTypeMenuId(null);
    },
    [entries]
  );

  const applyRename = useCallback(() => {
    if (!renamingEntryId) {
      return true;
    }
    const target = findEntryById(entries, renamingEntryId);
    if (!target) {
      cancelRename();
      return true;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('名称不能为空');
      return false;
    }
    if (trimmed === target.name) {
      cancelRename();
      return true;
    }
    if (isNameTaken(entries, target.type, trimmed, target.id)) {
      setRenameError('名称已存在');
      return false;
    }
    const timestamp = Date.now();
    updateEntriesState((prev) =>
      updateEntryById(prev, renamingEntryId, (entry) => ({
        ...entry,
        name: trimmed,
        updatedAt: timestamp,
      }))
    );
    cancelRename();
    return true;
  }, [
    cancelRename,
    entries,
    renamingEntryId,
    renameValue,
    setRenameError,
    updateEntriesState,
  ]);

  const deleteEntry = useCallback(
    (entryId: string) => {
      let removedFileIds: string[] = [];
      let removedFolderIds: string[] = [];
      let nextCurrentId: string | null = null;
      let nextValue: AppValue | null = null;
      let nextEntriesSnapshot: BoardEntry[] | null = null;
      let clearedSelection = false;
      let removalHappened = false;

      setEntries((prev) => {
        const result = removeEntryById(prev, entryId);
        if (!result.removed.length) {
          return prev;
        }
        removalHappened = true;
        removedFileIds = flattenFiles(result.removed).map((file) => file.id);
        removedFolderIds = Array.from(collectFolderIds(result.removed));
        let updatedEntries = result.entries;
        let fallbackFile: BoardFileEntry | null = null;

        let remainingFiles = flattenFiles(updatedEntries);
        if (remainingFiles.length === 0) {
          const fallbackName = generateNewFileName(updatedEntries);
          fallbackFile = createBlankFile(fallbackName, undefined, 'others');
          updatedEntries = [...updatedEntries, fallbackFile];
          remainingFiles = [fallbackFile];
        }

        const currentStillExists =
          currentFileId &&
          remainingFiles.some((file) => file.id === currentFileId);

        if (!currentStillExists) {
          const replacement = fallbackFile ?? remainingFiles[0] ?? null;
          if (replacement) {
            nextCurrentId = replacement.id;
            nextValue = replacement.data;
          } else {
            nextCurrentId = null;
            nextValue = null;
          }
        }

        if (selectedFolderId && removedFolderIds.includes(selectedFolderId)) {
          clearedSelection = true;
        }

        nextEntriesSnapshot = updatedEntries;
        void persistEntries(updatedEntries);
        return updatedEntries;
      });

      if (!removalHappened) {
        return;
      }

      if (
        renamingEntryId &&
        (renamingEntryId === entryId ||
          removedFileIds.includes(renamingEntryId) ||
          removedFolderIds.includes(renamingEntryId))
      ) {
        cancelRename();
      }

      if (clearedSelection) {
        setSelectedFolderId(null);
      }
      setActiveTypeMenuId(null);

      const currentIdRemoved =
        currentFileId && removedFileIds.includes(currentFileId);
      const effectiveCurrentId =
        nextCurrentId ??
        (currentIdRemoved ? null : currentFileId ?? null) ??
        null;

      if (!effectiveCurrentId) {
        const fallbackFiles = flattenFiles(nextEntriesSnapshot ?? []);
        const fallback = fallbackFiles.length > 0 ? fallbackFiles[0] : null;
        if (fallback) {
          setCurrentFileId(fallback.id);
          setValue(fallback.data);
          setTutorial(!hasContent(fallback.data));
          void localforage.setItem(CURRENT_FILE_ID_KEY, fallback.id);
        } else {
          setCurrentFileId(null);
          setValue({ children: [] });
          setTutorial(true);
          void localforage.removeItem(CURRENT_FILE_ID_KEY);
        }
        return;
      }

      const shouldUpdateCurrent =
        !currentFileId || effectiveCurrentId !== currentFileId;
      if (shouldUpdateCurrent) {
        setCurrentFileId(effectiveCurrentId);
      }

      let nextData = nextValue;
      if (!nextData && nextEntriesSnapshot) {
        const found = findFileById(nextEntriesSnapshot, effectiveCurrentId);
        if (found) {
          nextData = found.data;
        }
      }

      if (nextData) {
        setValue(nextData);
        setTutorial(!hasContent(nextData));
      }

      void localforage.setItem(CURRENT_FILE_ID_KEY, effectiveCurrentId);
    },
    [
      cancelRename,
      currentFileId,
      persistEntries,
      renamingEntryId,
      selectedFolderId,
      setSelectedFolderId,
      setCurrentFileId,
      setTutorial,
      setValue,
    ]
  );

  const requestDeleteEntry = useCallback(
    (entryId: string) => {
      const target = findEntryById(entries, entryId);
      if (!target) {
        return;
      }
      const fileCount =
        target.type === 'file' ? 1 : flattenFiles(target.children).length;
      setActiveTypeMenuId(null);
      setDeleteTarget({
        id: target.id,
        name: target.name,
        type: target.type,
        fileCount,
      });
    },
    [entries]
  );

  const cancelDeleteEntry = useCallback(() => {
    setDeleteTarget(null);
  }, []);

  const confirmDeleteEntry = useCallback(() => {
    if (!deleteTarget) {
      return;
    }
    deleteEntry(deleteTarget.id);
    setDeleteTarget(null);
  }, [deleteEntry, deleteTarget]);

  const updateFileType = useCallback(
    (entryId: string, fileType: FileType) => {
      setActiveTypeMenuId(null);
      updateEntriesState((prev) =>
        updateEntryById(prev, entryId, (entry) => {
          if (entry.type !== 'file' || entry.fileType === fileType) {
            return entry;
          }
          return { ...entry, fileType, updatedAt: Date.now() };
        })
      );
    },
    [setActiveTypeMenuId, updateEntriesState]
  );

  const handleToggleFolderSelection = useCallback(
    (folderId: string) => {
      setSelectedFolderId((prev) => (prev === folderId ? null : folderId));
      setSidebarOpen(true);
      cancelRename();
    },
    [cancelRename]
  );

  const handleClearFolderSelection = useCallback(() => {
    setSelectedFolderId(null);
    cancelRename();
  }, [cancelRename]);

  const selectedFolder = selectedFolderId
    ? findFolderById(entries, selectedFolderId)
    : null;

  const renderEntries = useCallback(
    (list: BoardEntry[], depth = 0): JSX.Element[] =>
      list.map((entry) => {
        const isActive = entry.type === 'file' && currentFileId === entry.id;
        const isFolderSelected =
          entry.type === 'folder' && selectedFolderId === entry.id;
        const isRenaming = renamingEntryId === entry.id;
        const rowClass = `${styles.entryRow} ${isActive ? styles.activeEntry : ''
          } ${isFolderSelected ? styles.selectedFolder : ''}`;
        const icon =
          entry.type === 'file'
            ? FILE_TYPE_ICON_MAP[entry.fileType]
            : '📂';

        const handleCloseTypeMenu = () => {
          if (activeTypeMenuId === entry.id) {
            setActiveTypeMenuId(null);
          }
        };

        let mainContent: JSX.Element;

        if (isRenaming) {
          mainContent = (
            <div className={`${styles.entryMain} ${styles.renameMode}`}>
              <span className={styles.entryIcon}>{icon}</span>
              <div className={styles.renameField}>
                <input
                  ref={
                    isRenaming
                      ? (node) => {
                        renameInputRef.current = node;
                      }
                      : undefined
                  }
                  className={`${styles.renameInput} ${renameError ? styles.renameInputError : ''
                    }`}
                  value={renameValue}
                  onChange={(event) => {
                    setRenameValue(event.target.value);
                    if (renameError) {
                      setRenameError(null);
                    }
                  }}
                  onBlur={() => {
                    const success = applyRename();
                    if (!success) {
                      setTimeout(() => {
                        renameInputRef.current?.focus();
                      }, 0);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      const success = applyRename();
                      if (!success) {
                        setTimeout(() => {
                          renameInputRef.current?.focus();
                        }, 0);
                      }
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                />
                {renameError ? (
                  <span className={styles.renameError}>{renameError}</span>
                ) : null}
              </div>
            </div>
          );
        } else if (entry.type === 'file') {
          mainContent = (
            <div className={styles.entryMain}>
              <div
                className={styles.typeSelector}
                onMouseLeave={handleCloseTypeMenu}
              >
                <button
                  type="button"
                  className={`${styles.typeIconButton} ${activeTypeMenuId === entry.id ? styles.typeIconButtonActive : ''
                    }`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveTypeMenuId((prev) =>
                      prev === entry.id ? null : entry.id
                    );
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Escape') {
                      setActiveTypeMenuId(null);
                    }
                  }}
                >
                  {icon}
                </button>
                {activeTypeMenuId === entry.id ? (
                  <div className={styles.typeMenu}>
                    {FILE_TYPE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`${styles.typeMenuItem} ${option.value === entry.fileType
                            ? styles.typeMenuItemActive
                            : ''
                          }`}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateFileType(entry.id, option.value);
                        }}
                      >
                        <span>{option.icon}</span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className={styles.entryNameButton}
                onClick={() => {
                  void handleSelectFile(entry.id);
                }}
                onFocus={handleCloseTypeMenu}
              >
                <span className={styles.entryName}>{entry.name}</span>
              </button>
            </div>
          );
        } else {
          mainContent = (
            <div className={styles.entryMain}>
              <span className={styles.entryIcon}>{icon}</span>
              <button
                type="button"
                className={styles.entryNameButton}
                onClick={() => {
                  handleToggleFolderSelection(entry.id);
                }}
              >
                <span className={styles.entryName}>{entry.name}</span>
              </button>
            </div>
          );
        }

        return (
          <li key={entry.id} className={styles.entryItem}>
            <div
              className={rowClass}
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              {mainContent}
              {!isRenaming ? (
                <div className={styles.entryActions}>
                  <button
                    className={styles.entryActionToggle}
                    type="button"
                    aria-label="更多操作"
                    onClick={(event) => event.stopPropagation()}
                  >
                    ⋯
                  </button>
                  <div className={styles.entryActionMenu}>
                    <button
                      type="button"
                      className={styles.entryActionItem}
                      onClick={() => {
                        startRenameEntry(entry.id);
                      }}
                    >
                      重命名
                    </button>
                    <button
                      type="button"
                      className={`${styles.entryActionItem} ${styles.dangerAction}`}
                      onClick={() => {
                        requestDeleteEntry(entry.id);
                      }}
                    >
                      删除
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {entry.type === 'folder' && entry.children.length > 0 ? (
              <ul className={styles.childList}>{renderEntries(entry.children, depth + 1)}</ul>
            ) : null}
          </li>
        );
      }),
    [
      activeTypeMenuId,
      applyRename,
      cancelRename,
      currentFileId,
      handleSelectFile,
      handleToggleFolderSelection,
      renamingEntryId,
      renameError,
      renameValue,
      requestDeleteEntry,
      selectedFolderId,
      startRenameEntry,
      updateFileType,
      setActiveTypeMenuId,
      setRenameError,
      setRenameValue,
    ]
  );

  const currentFile = currentFileId ? findFileById(entries, currentFileId) : null;

  useEffect(() => {
    if (!initialized || currentFile) {
      return;
    }
    const defaultName = generateNewFileName(entries);
    void handleCreateFile(defaultName, 'others');
  }, [currentFile, entries, handleCreateFile, initialized]);

  if (!initialized || !currentFile) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      <button
        ref={toggleButtonRef}
        className={`${styles.toggleButton} ${isDraggingToggle ? styles.toggleButtonDragging : ''}`}
        type="button"
        onClick={handleToggleButtonClick}
        aria-label="切换文件列表"
        style={{
          top: `${toggleButtonPosition.top}px`,
          left: `${toggleButtonPosition.left}px`,
        }}
        onPointerDown={handleToggleButtonPointerDown}
        onPointerMove={handleToggleButtonPointerMove}
        onPointerUp={handleToggleButtonPointerUp}
        onPointerCancel={handleToggleButtonPointerCancel}
      >
        📁
      </button>
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
      >
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}></span>
          <div className={styles.sidebarActions}>
            <button
              className={styles.newFileButton}
              type="button"
              onClick={openCreateDialog}
              title="新建文件"
              aria-label="新建文件"
            >
              <FileAddIcon aria-hidden="true" className={styles.actionIcon} />
            </button>
            <button
              className={styles.newFolderButton}
              type="button"
              onClick={handleCreateFolder}
              title="新建文件夹"
              aria-label="新建文件夹"
            >
              <FolderAddIcon aria-hidden="true" className={styles.actionIcon} />
            </button>
            <button
              className={styles.newFileButton}
              type="button"
              onClick={triggerUploadDialog}
              disabled={uploading}
              title={uploading ? '正在上传PDDL文件' : '上传PDDL文件'}
              aria-label={uploading ? '正在上传PDDL文件' : '上传PDDL文件'}
              aria-busy={uploading}
            >
              {uploading ? (
                <span
                  aria-hidden="true"
                  className={styles.loadingSpinner}
                />
              ) : (
                <UploadArrowIcon
                  aria-hidden="true"
                  className={styles.actionIcon}
                />
              )}
            </button>
          </div>
          <div className={styles.currentDirectory}>
            <span>
              当前目录：{selectedFolder ? selectedFolder.name : '根目录'}
            </span>
            {selectedFolder ? (
              <button
                type="button"
                className={styles.clearSelectionButton}
                onClick={handleClearFolderSelection}
              >
                返回根目录
              </button>
            ) : null}
          </div>
        </div>
        <ul className={styles.fileList}>
          {entries.length === 0 ? (
            <li className={styles.emptyHint}>暂无画布</li>
          ) : (
            renderEntries(entries)
          )}
        </ul>
      </aside>
      <div className={styles.canvasContainer}>
        <Drawnix
          key={currentFileId}
          value={value.children}
          viewport={value.viewport}
          theme={value.theme}
          onChange={(changedValue) => {
            const newValue = changedValue as AppValue;
            
            // 检测并同步背景图片变化
            detectAndSyncBackgroundChanges(newValue.children);
            
            setValue(newValue);
            if (currentFileId) {
              updateEntriesState((prev) =>
                updateEntryById(prev, currentFileId, (entry) => {
                  if (entry.type !== 'file') {
                    return entry;
                  }
                  return { ...entry, data: newValue, updatedAt: Date.now() };
                })
              );
              void localforage.setItem(CURRENT_FILE_ID_KEY, currentFileId);
            }
            setTutorial(!hasContent(newValue));
          }}
          tutorial={tutorial}
          afterInit={(board) => {
            clearDomHighlights();
            boardRef.current = board;
            highlightedElementsRef.current = new Set();
            attachNodeClickHighlight(board);
            
            // 初始化背景图片状态跟踪
            const allElements = flattenPlaitElements(value.children);
            const initialElementsMap = new Map<string, any>();
            allElements.forEach((element) => {
              if (element.type === 'geometry' && element.id) {
                initialElementsMap.set(element.id, {
                  backgroundImage: (element as any).backgroundImage,
                  elementType: getElementType(element)
                });
              }
            });
            previousElementsRef.current = initialElementsMap;
            
            // 设置定期检查背景图片变化的定时器
            const checkInterval = setInterval(() => {
              if (!boardRef.current) {
                clearInterval(checkInterval);
                return;
              }
              
              const currentElements = flattenPlaitElements(boardRef.current.children as PlaitElement[]);
              currentElements.forEach((element) => {
                if (element.type === 'geometry' && element.id) {
                  const currentBg = (element as any).backgroundImage;
                  const prevData = previousElementsRef.current.get(element.id);
                  
                  if (prevData && currentBg !== prevData.backgroundImage) {
                    console.log('定时器检测到背景图片变化:', element.id, currentBg);
                    syncBackgroundImageForSameType(boardRef.current!, element, currentBg);
                    
                    // 更新记录
                    previousElementsRef.current.set(element.id, {
                      ...prevData,
                      backgroundImage: currentBg
                    });
                  }
                }
              });
            }, 500); // 每500ms检查一次
            
            updateConnectionHighlight();
            console.log('board initialized');

            // console.log(
            //   `add __drawnix__web__debug_log to window, so you can call add log anywhere, like: window.__drawnix__web__console('some thing')`
            // );
            // (window as any)['__drawnix__web__console'] = (value: string) => {
            //   addDebugLog(board, value);
            // };
          }}
          onSelectionChange={handleSelectionChange}
        ></Drawnix>
      </div>
      
      {/* 聊天切换按钮 */}
      <button
        className={styles.chatToggle}
        type="button"
        onClick={toggleChat}
        aria-label="切换LLM聊天"
      >
        💬
      </button>
      
      {/* 右侧LLM聊天面板 */}
      {chatOpen && (
        <aside className={styles.chatPanel}>
          <div className={styles.chatHeader}>
            <h3>PDDL 助手</h3>
            <button
              className={styles.chatCloseButton}
              onClick={toggleChat}
              aria-label="关闭聊天"
            >
              ✕
            </button>
          </div>
          <div className={styles.chatMessages}>
            {messages.length === 0 ? (
              <div className={styles.chatWelcome}>
                👋 你好！我是AI助手，可以帮你分析PDDL文件、解答相关问题。有什么我可以帮助你的吗？
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`${styles.chatMessage} ${
                    message.role === 'user' ? styles.userMessage : styles.assistantMessage
                  }`}
                >
                  <div className={styles.messageContent}>{message.content}</div>
                  <div className={styles.messageTime}>
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
            {isLoading && (
              <div className={`${styles.chatMessage} ${styles.assistantMessage}`}>
                <div className={styles.messageContent}>
                  <div className={styles.typingIndicator}>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className={styles.chatInput}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const content = formData.get('message') as string;
                if (content.trim() && !isLoading) {
                  handleSendMessage(content.trim());
                  e.currentTarget.reset();
                }
              }}
            >
              <input
                name="message"
                type="text"
                placeholder="输入你的问题..."
                className={styles.chatInputField}
                disabled={isLoading}
              />
              <button
                type="submit"
                className={styles.chatSendButton}
                disabled={isLoading}
              >
                发送
              </button>
            </form>
          </div>
        </aside>
      )}
      
      {createDialogOpen ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onClick={closeCreateDialog}
        >
          <div
            className={styles.modal}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 className={styles.modalTitle}>新建画布</h2>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="create-board-name">
                名称
              </label>
              <input
                id="create-board-name"
                className={`${styles.renameInput} ${createError ? styles.renameInputError : ''
                  }`}
                value={createName}
                autoFocus
                onChange={(event) => {
                  setCreateName(event.target.value);
                  if (createError) {
                    setCreateError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void confirmCreateFile();
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeCreateDialog();
                  }
                }}
              />
              {createError ? (
                <span className={styles.renameError}>{createError}</span>
              ) : null}
            </div>
            <div className={styles.modalField}>
              <span className={styles.modalLabel}>类型</span>
              <div className={styles.typeOptionGroup}>
                {FILE_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`${styles.typeOptionButton} ${createType === option.value
                        ? styles.typeOptionButtonActive
                        : ''
                      }`}
                    onClick={() => setCreateType(option.value)}
                  >
                    <span>{option.icon}</span>
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.ghostButton}`}
                onClick={closeCreateDialog}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.primaryButton}`}
                onClick={() => {
                  void confirmCreateFile();
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteTarget ? (
        <div
          className={styles.modalOverlay}
          role="dialog"
          aria-modal="true"
          onClick={cancelDeleteEntry}
        >
          <div
            className={styles.modal}
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <h2 className={styles.modalTitle}>确认删除</h2>
            <p className={styles.modalBody}>
              确定要删除
              <span className={styles.modalHighlight}>
                {deleteTarget.type === 'file' ? '画布' : '文件夹'}「
                {deleteTarget.name}」
              </span>
              {deleteTarget.type === 'folder'
                ? `（包含 ${deleteTarget.fileCount} 个画布）`
                : ''}
              吗？删除后无法恢复。
            </p>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.ghostButton}`}
                onClick={cancelDeleteEntry}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.modalButton} ${styles.dangerButton}`}
                onClick={confirmDeleteEntry}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pddl"
        style={{ display: 'none' }}
        onChange={handlePddlUpload}
      />
    </div>
  );
}

const addDebugLog = (board: PlaitBoard, value: string) => {
  const container = PlaitBoard.getBoardContainer(board).closest(
    '.drawnix'
  ) as HTMLElement;
  let consoleContainer = container.querySelector('.drawnix-console');
  if (!consoleContainer) {
    consoleContainer = document.createElement('div');
    consoleContainer.classList.add('drawnix-console');
    container.append(consoleContainer);
  }
  const div = document.createElement('div');
  div.innerHTML = value;
  consoleContainer.append(div);
};

export default App;
