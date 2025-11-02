import { useState, useEffect, useCallback, useRef } from 'react';
import { Drawnix } from '@drawnix/drawnix';
import { PlaitBoard, PlaitElement, PlaitTheme, Viewport } from '@plait/core';
import localforage from 'localforage';
import styles from './app.module.scss';

type AppValue = {
  children: PlaitElement[];
  viewport?: Viewport;
  theme?: PlaitTheme;
};

type FileType = 'domain' | 'problem' | 'plan' | 'others';

type BoardEntryBase = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
};

type BoardFileEntry = BoardEntryBase & {
  type: 'file';
  fileType: FileType;
  data: AppValue;
};

type BoardFolderEntry = BoardEntryBase & {
  type: 'folder';
  children: BoardEntry[];
};

type BoardEntry = BoardFileEntry | BoardFolderEntry;

type LegacyStoredFile = {
  id?: string;
  name?: string;
  data?: AppValue;
  createdAt?: number;
  updatedAt?: number;
  fileType?: FileType;
};

type DeleteTarget = {
  id: string;
  name: string;
  type: BoardEntry['type'];
  fileCount: number;
};

const FILE_TYPE_OPTIONS: { value: FileType; label: string; icon: string }[] = [
  { value: 'domain', label: 'Domain', icon: '🌐' },
  { value: 'problem', label: 'Problem', icon: '❓' },
  { value: 'plan', label: 'Plan', icon: '🧭' },
  { value: 'others', label: 'Others', icon: '📝' },
];

const FILE_TYPE_ICON_MAP: Record<FileType, string> = {
  domain: '🌐',
  problem: '❓',
  plan: '🧭',
  others: '📝',
};

const LEGACY_MAIN_BOARD_CONTENT_KEY = 'main_board_content';
const LEGACY_BOARD_FILES_KEY = 'board_files';
const BOARD_ENTRIES_KEY = 'board_entries';
const CURRENT_FILE_ID_KEY = 'current_board_file_id';

localforage.config({
  name: 'Drawnix',
  storeName: 'drawnix_store',
  driver: [localforage.INDEXEDDB, localforage.LOCALSTORAGE],
});

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
  const [createType, setCreateType] = useState<FileType>('domain');
  const [createError, setCreateError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [tutorial, setTutorial] = useState(false);

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

  const toggleSidebar = () => {
    setSidebarOpen((open) => !open);
  };

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
        const rowClass = `${styles.entryRow} ${
          isActive ? styles.activeEntry : ''
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
                  className={`${styles.renameInput} ${
                    renameError ? styles.renameInputError : ''
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
                  className={`${styles.typeIconButton} ${
                    activeTypeMenuId === entry.id ? styles.typeIconButtonActive : ''
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
                        className={`${styles.typeMenuItem} ${
                          option.value === entry.fileType
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
        className={styles.toggleButton}
        type="button"
        onClick={toggleSidebar}
        aria-label="切换文件列表"
      >
        📁
      </button>
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
      >
        <div className={styles.sidebarHeader}>
          <span className={styles.sidebarTitle}>画布文件</span>
          <div className={styles.sidebarActions}>
            <button
              className={styles.newFileButton}
              type="button"
              onClick={openCreateDialog}
            >
              新建画布
            </button>
            <button
              className={styles.newFolderButton}
              type="button"
              onClick={handleCreateFolder}
            >
              新建文件夹
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
            console.log('board initialized');

            // console.log(
            //   `add __drawnix__web__debug_log to window, so you can call add log anywhere, like: window.__drawnix__web__console('some thing')`
            // );
            // (window as any)['__drawnix__web__console'] = (value: string) => {
            //   addDebugLog(board, value);
            // };
          }}
        ></Drawnix>
      </div>
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
                className={`${styles.renameInput} ${
                  createError ? styles.renameInputError : ''
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
                    className={`${styles.typeOptionButton} ${
                      createType === option.value
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

const hasContent = (data: AppValue) =>
  Array.isArray(data.children) && data.children.length > 0;

const flattenFiles = (
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

const normalizeEntries = (entries: BoardEntry[]): BoardEntry[] => {
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

const findEntryById = (entries: BoardEntry[], id: string): BoardEntry | null => {
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

const findFileById = (
  entries: BoardEntry[],
  id: string
): BoardFileEntry | null => {
  const entry = findEntryById(entries, id);
  return entry && entry.type === 'file' ? entry : null;
};

const findFolderById = (
  entries: BoardEntry[],
  id: string
): BoardFolderEntry | null => {
  const entry = findEntryById(entries, id);
  return entry && entry.type === 'folder' ? entry : null;
};

const updateEntryById = (
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

const removeEntryById = (
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

const convertLegacyFilesToEntries = (
  legacyFiles: LegacyStoredFile[]
): BoardEntry[] => {
  return legacyFiles.map((file, index) => {
    const fallbackName = `画布 ${index + 1}`;
    const createdAt = file.createdAt ?? Date.now();
    const updatedAt = file.updatedAt ?? createdAt;
    return {
      id: file.id ?? createId(),
      name: file.name && file.name.trim().length > 0 ? file.name : fallbackName,
      type: 'file' as const,
      fileType: file.fileType ?? 'others',
      data: file.data ?? { children: [] },
      createdAt,
      updatedAt,
    };
  });
};

const isBoardEntryArray = (value: unknown): value is BoardEntry[] => {
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

const collectFolderIds = (
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

const isNameTaken = (
  entries: BoardEntry[],
  type: BoardEntry['type'],
  name: string,
  excludeId?: string
) => {
  const takenNames = collectEntryNames(entries, type, excludeId);
  return takenNames.has(name);
};

const generateNewFileName = (entries: BoardEntry[]) => {
  const taken = collectEntryNames(entries, 'file');
  return generateSequentialName('画布', taken);
};

const generateNewFolderName = (entries: BoardEntry[]) => {
  const taken = collectEntryNames(entries, 'folder');
  return generateSequentialName('文件夹', taken);
};

const generateSequentialName = (base: string, taken: Set<string>) => {
  let index = 1;
  let candidate = `${base} ${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${base} ${index}`;
  }
  return candidate;
};

const createBlankFile = (
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

const createFolder = (name: string): BoardFolderEntry => {
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

const addEntryToFolder = (
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

export default App;
