import { PlaitBoard, PlaitElement } from '@plait/core';
import {
  cleanupUnusedPatterns,
  ensurePatternContainer,
  ensurePatternForElement,
  flattenPlaitElements,
  getBackgroundImageFromElement,
  getBackgroundPatternId,
} from '../utils/background-image';

const scheduleSync = (callback: () => void) => {
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(callback);
  } else {
    setTimeout(callback, 0);
  }
};

const syncBackgroundPatterns = (board: PlaitBoard) => {
  const container = PlaitBoard.getBoardContainer(board);
  if (!container) {
    return;
  }
  const svg = container.querySelector<SVGSVGElement>('svg');
  if (!svg) {
    return;
  }
  const defs = ensurePatternContainer(svg);

  const elements: PlaitElement[] = flattenPlaitElements(board.children);
  const validPatternIds = new Set<string>();

  elements.forEach((element) => {
    const backgroundImage = getBackgroundImageFromElement(element);
    if (!backgroundImage) {
      return;
    }
    const patternId = getBackgroundPatternId(element.id);
    validPatternIds.add(patternId);
    ensurePatternForElement(defs, element, backgroundImage);
  });

  cleanupUnusedPatterns(defs, validPatternIds);
};

export const withBackgroundImage = (board: PlaitBoard) => {
  const newBoard = board;
  const { afterChange } = board;

  newBoard.afterChange = () => {
    syncBackgroundPatterns(newBoard);
    if (typeof afterChange === 'function') {
      afterChange();
    }
  };

  scheduleSync(() => syncBackgroundPatterns(newBoard));

  return newBoard;
};
