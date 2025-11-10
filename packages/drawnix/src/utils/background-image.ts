import { PlaitElement, Point } from '@plait/core';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const PATTERN_PREFIX = 'drawnix-bg-';
const PATTERN_DEF_ID = 'drawnix-background-patterns';
const PATTERN_DATA_ATTRIBUTE = 'data-drawnix-background-pattern';

export const BackgroundImageConstants = {
  svgNamespace: SVG_NS,
  xlinkNamespace: XLINK_NS,
  patternPrefix: PATTERN_PREFIX,
  patternDefId: PATTERN_DEF_ID,
  patternDataAttribute: PATTERN_DATA_ATTRIBUTE,
} as const;

export type BackgroundCapableElement = PlaitElement & {
  points?: Point[];
  data?: Record<string, any>;
};

export const getBackgroundImageFromElement = (
  element: BackgroundCapableElement
): string | undefined => {
  return element?.data?.backgroundImage;
};

export const getBackgroundFillBackupFromElement = (
  element: BackgroundCapableElement
): string | null | undefined => {
  return element?.data?.backgroundImageFillBackup;
};

export const getBackgroundPatternId = (elementId: string) =>
  `${PATTERN_PREFIX}${elementId}`;

export const flattenPlaitElements = (elements: PlaitElement[]): PlaitElement[] =>
  elements.flatMap((element) => [
    element,
    ...(Array.isArray(element.children)
      ? flattenPlaitElements(element.children)
      : []),
  ]);

export const ensurePatternContainer = (svg: SVGSVGElement) => {
  let defs = svg.querySelector<SVGDefsElement>(
    `defs#${PATTERN_DEF_ID}`
  );
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    defs.id = PATTERN_DEF_ID;
    svg.prepend(defs);
  }
  return defs;
};

export const ensurePatternForElement = (
  defs: SVGDefsElement,
  element: BackgroundCapableElement,
  image: string
) => {
  const patternId = getBackgroundPatternId(element.id);
  let pattern = defs.querySelector<SVGPatternElement>(`#${patternId}`);

  if (!pattern) {
    pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.id = patternId;
    pattern.setAttribute('patternUnits', 'objectBoundingBox');
    pattern.setAttribute('patternContentUnits', 'objectBoundingBox');
    pattern.setAttribute('width', '1');
    pattern.setAttribute('height', '1');
    pattern.setAttribute(PATTERN_DATA_ATTRIBUTE, 'true');
    defs.appendChild(pattern);
  }

  pattern.setAttribute('patternUnits', 'objectBoundingBox');
  pattern.setAttribute('patternContentUnits', 'objectBoundingBox');
  pattern.setAttribute('width', '1');
  pattern.setAttribute('height', '1');

  let imageElement = pattern.querySelector<SVGImageElement>('image');
  if (!imageElement) {
    imageElement = document.createElementNS(SVG_NS, 'image');
    imageElement.setAttribute('x', '0');
    imageElement.setAttribute('y', '0');
    imageElement.setAttribute('width', '1');
    imageElement.setAttribute('height', '1');
    imageElement.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    pattern.appendChild(imageElement);
  }

  imageElement.setAttributeNS(XLINK_NS, 'href', image);
  imageElement.setAttribute('x', '0');
  imageElement.setAttribute('y', '0');
  imageElement.setAttribute('width', '1');
  imageElement.setAttribute('height', '1');
  imageElement.setAttribute('preserveAspectRatio', 'xMidYMid slice');

  return pattern;
};

export const cleanupUnusedPatterns = (
  defs: SVGDefsElement,
  validPatternIds: Set<string>
) => {
  const patterns = Array.from(
    defs.querySelectorAll<SVGPatternElement>(
      `pattern[${PATTERN_DATA_ATTRIBUTE}]`
    )
  );
  patterns.forEach((pattern) => {
    if (!validPatternIds.has(pattern.id)) {
      pattern.remove();
    }
  });
};
