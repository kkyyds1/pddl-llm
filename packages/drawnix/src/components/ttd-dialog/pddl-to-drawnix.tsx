import { useState, useEffect, useDeferredValue } from 'react';
import './mermaid-to-drawnix.scss';
import './ttd-dialog.scss';
import { TTDDialogPanels } from './ttd-dialog-panels';
import { TTDDialogPanel } from './ttd-dialog-panel';
import { TTDDialogInput } from './ttd-dialog-input';
import { TTDDialogOutput } from './ttd-dialog-output';
import { TTDDialogSubmitShortcut } from './ttd-dialog-submit-shortcut';
import { useDrawnix } from '../../hooks/use-drawnix';
import { useI18n } from '../../i18n';
import { useBoard } from '@plait-board/react-board';
import {
  getViewportOrigination,
  PlaitBoard,
  PlaitElement,
  WritableClipboardOperationType,
} from '@plait/core';
import { parsePddlToMind } from '../../utils/pddl-to-drawnix';

const PddlToDrawnix = () => {
  const { appState, setAppState } = useDrawnix();
  const { t, language } = useI18n();
  const [text, setText] = useState(() => t('pddl.example'));
  const [value, setValue] = useState<PlaitElement[]>([]);
  const deferredText = useDeferredValue(text.trim());
  const [error, setError] = useState<Error | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const board = useBoard();

  useEffect(() => {
    setText(t('pddl.example'));
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    if (!deferredText) {
      setValue([]);
      setError(null);
      setIsParsing(false);
      return () => {
        cancelled = true;
      };
    }

    const convertPddl = async () => {
      setIsParsing(true);
      setError(null);
      setValue([]);
      try {
        const mind = await parsePddlToMind(deferredText);
        if (cancelled) {
          return;
        }
        setValue([mind]);
        setError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }
        setError(err as Error);
        setValue([]);
      } finally {
        if (!cancelled) {
          setIsParsing(false);
        }
      }
    };

    convertPddl();

    return () => {
      cancelled = true;
    };
  }, [deferredText]);

  const insertToBoard = () => {
    if (!value.length) {
      return;
    }
    const boardContainerRect =
      PlaitBoard.getBoardContainer(board).getBoundingClientRect();
    const focusPoint = [
      boardContainerRect.width / 4,
      boardContainerRect.height / 2 - 20,
    ];
    const zoom = board.viewport.zoom;
    const origination = getViewportOrigination(board);
    const focusX = origination![0] + focusPoint[0] / zoom;
    const focusY = origination![1] + focusPoint[1] / zoom;
    const elements = value;
    board.insertFragment(
      {
        elements: JSON.parse(JSON.stringify(elements)),
      },
      [focusX, focusY],
      WritableClipboardOperationType.paste
    );
    setAppState({ ...appState, openDialogType: null });
  };

  return (
    <>
      <div className="ttd-dialog-desc">{t('dialog.pddl.description')}</div>
      <TTDDialogPanels>
        <TTDDialogPanel label={t('dialog.pddl.syntax')}>
          <TTDDialogInput
            input={text}
            placeholder={t('dialog.pddl.placeholder')}
            onChange={(event) => setText(event.target.value)}
            onKeyboardSubmit={() => {
              insertToBoard();
            }}
          />
        </TTDDialogPanel>
        <TTDDialogPanel
          label={t('dialog.pddl.preview')}
          panelAction={{
            action: () => {
              insertToBoard();
            },
            label: t('dialog.pddl.insert'),
          }}
          renderSubmitShortcut={() => <TTDDialogSubmitShortcut />}
        >
          <TTDDialogOutput value={value} loaded={!isParsing} error={error} />
        </TTDDialogPanel>
      </TTDDialogPanels>
    </>
  );
};

export default PddlToDrawnix;
