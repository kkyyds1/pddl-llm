import { MindLayoutType } from '@plait/layouts';
import { createMindElement, MindElement } from '@plait/mind';

type SExprAtom = string;
type SExpr = Array<SExprAtom | SExpr>;

interface Definition {
  kind: 'domain' | 'problem' | 'unknown';
  name?: string;
  segments: SExpr[];
  headerIndex: number | null;
}

const DEFAULT_ROOT_LABEL = 'PDDL Diagram';

const isAtom = (value: SExprAtom | SExpr): value is SExprAtom =>
  typeof value === 'string';

const isList = (value: SExprAtom | SExpr): value is SExpr => Array.isArray(value);

const toTitleCase = (text: string) =>
  text
    .replace(/^:/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(' ');

const formatSExpr = (expr: SExprAtom | SExpr): string => {
  if (isAtom(expr)) {
    return expr;
  }
  return `(${expr.map((item) => formatSExpr(item)).join(' ')})`;
};

const formatInline = (items: (SExprAtom | SExpr)[]): string =>
  items.map((item) => formatSExpr(item)).join(' ');

const addChild = (parent: MindElement, text: string): MindElement => {
  const child = createMindElement(text, {});
  parent.children.push(child);
  return child;
};

const stripComments = (definition: string) =>
  definition.replace(/;[^\n\r]*/g, '');

const tokenize = (definition: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) {
      tokens.push(current.trim());
    }
    current = '';
  };

  for (let i = 0; i < definition.length; i++) {
    const char = definition[i];
    if (char === '(' || char === ')') {
      pushCurrent();
      tokens.push(char);
    } else if (/\s/.test(char)) {
      pushCurrent();
    } else {
      current += char;
    }
  }

  pushCurrent();
  return tokens;
};

const parseTokensToSExpr = (tokens: string[]): SExpr => {
  const stack: SExpr[] = [[]];

  tokens.forEach((token) => {
    if (token === '(') {
      const newList: SExpr = [];
      stack[stack.length - 1].push(newList);
      stack.push(newList);
    } else if (token === ')') {
      if (stack.length === 1) {
        throw new Error('Unexpected closing parenthesis while parsing PDDL.');
      }
      stack.pop();
    } else {
      stack[stack.length - 1].push(token);
    }
  });

  if (stack.length !== 1) {
    throw new Error('Unbalanced parentheses found while parsing PDDL.');
  }

  return stack[0];
};

const classifyDefinition = (expr: SExpr): Definition | null => {
  if (!expr.length) {
    return null;
  }

  const head = expr[0];
  if (!isAtom(head) || head.toLowerCase() !== 'define') {
    return null;
  }

  const segments = expr.slice(1);
  let headerIndex: number | null = null;
  let kind: Definition['kind'] = 'unknown';
  let name: string | undefined;

  segments.forEach((segment, index) => {
    if (headerIndex !== null || !isList(segment) || !segment.length) {
      return;
    }
    const [segmentHead, maybeName] = segment;
    if (!isAtom(segmentHead) || segmentHead.startsWith(':')) {
      return;
    }
    const normalizedHead = segmentHead.toLowerCase();
    if (normalizedHead === 'domain') {
      kind = 'domain';
      headerIndex = index;
    } else if (normalizedHead === 'problem') {
      kind = 'problem';
      headerIndex = index;
    } else {
      return;
    }
    if (isAtom(maybeName)) {
      name = maybeName;
    }
  });

  return {
    kind,
    name,
    segments,
    headerIndex,
  };
};

const appendRequirementLikeSection = (
  parent: MindElement,
  title: string,
  entries: (SExprAtom | SExpr)[]
) => {
  const sectionNode = addChild(parent, title);
  if (!entries.length) {
    addChild(sectionNode, '(empty)');
    return;
  }
  entries.forEach((entry) => {
    const rendered = formatSExpr(entry);
    if (rendered) {
      addChild(sectionNode, rendered);
    }
  });
};

const appendTypedBlockSection = (
  parent: MindElement,
  title: string,
  entries: (SExprAtom | SExpr)[]
) => {
  const sectionNode = addChild(parent, title);
  if (!entries.length) {
    addChild(sectionNode, '(empty)');
    return;
  }

  let buffer: string[] = [];
  const flushBuffer = () => {
    if (buffer.length) {
      addChild(sectionNode, buffer.join(' '));
      buffer = [];
    }
  };

  entries.forEach((entry) => {
    const rendered = formatSExpr(entry);
    if (rendered === '-') {
      buffer.push(rendered);
    } else if (rendered.startsWith('-') && buffer.length && buffer[buffer.length - 1] === '-') {
      buffer[buffer.length - 1] = '-';
      buffer.push(rendered.slice(1));
      flushBuffer();
    } else if (rendered.startsWith('-')) {
      flushBuffer();
      buffer.push(rendered.slice(1));
      flushBuffer();
    } else {
      buffer.push(rendered);
    }
  });

  flushBuffer();
};

const appendPredicateSection = (
  parent: MindElement,
  title: string,
  entries: (SExprAtom | SExpr)[]
) => {
  const sectionNode = addChild(parent, title);
  if (!entries.length) {
    addChild(sectionNode, '(empty)');
    return;
  }
  entries.forEach((entry) => {
    const rendered = formatSExpr(entry);
    if (rendered) {
      addChild(sectionNode, rendered);
    }
  });
};

const appendActionSection = (parent: MindElement, actionExpr: SExpr) => {
  if (!actionExpr.length) {
    return;
  }

  const actionHead = actionExpr[0];
  if (!isAtom(actionHead)) {
    return;
  }

  const actionName = isAtom(actionExpr[1]) ? actionExpr[1] : 'Unnamed Action';
  const actionNode = addChild(
    parent,
    `${toTitleCase(actionHead === ':durative-action' ? ':durative action' : actionHead)}: ${actionName}`
  );

  for (let index = 2; index < actionExpr.length; index++) {
    const key = actionExpr[index];
    if (!isAtom(key)) {
      addChild(actionNode, formatSExpr(key));
      continue;
    }
    if (!key.startsWith(':')) {
      addChild(actionNode, `${key}`);
      continue;
    }
    const label = toTitleCase(key);
    const value = actionExpr[index + 1];
    if (typeof value === 'undefined') {
      addChild(actionNode, `${label}: (empty)`);
      continue;
    }
    addChild(actionNode, `${label}: ${formatSExpr(value)}`);
    index += 1;
  }
};

const appendGenericSection = (parent: MindElement, expr: SExpr) => {
  if (!expr.length) {
    return;
  }
  const [head, ...rest] = expr;
  const title = isAtom(head) ? toTitleCase(head) : 'Section';
  const sectionNode = addChild(parent, title);
  if (!rest.length) {
    addChild(sectionNode, '(empty)');
    return;
  }
  rest.forEach((entry) => {
    addChild(sectionNode, formatSExpr(entry));
  });
};

const appendDomainDefinition = (node: MindElement, definition: Definition) => {
  definition.segments.forEach((segment, index) => {
    if (index === definition.headerIndex || !isList(segment) || !segment.length) {
      return;
    }
    const head = segment[0];
    if (!isAtom(head)) {
      appendGenericSection(node, segment);
      return;
    }
    const key = head.toLowerCase();
    if (key === ':requirements') {
      appendRequirementLikeSection(node, 'Requirements', segment.slice(1));
    } else if (key === ':types' || key === ':constants') {
      appendTypedBlockSection(node, toTitleCase(head), segment.slice(1));
    } else if (key === ':predicates' || key === ':functions') {
      appendPredicateSection(node, toTitleCase(head), segment.slice(1));
    } else if (key === ':action' || key === ':durative-action') {
      appendActionSection(node, segment);
    } else {
      appendGenericSection(node, segment);
    }
  });
};

const appendProblemDefinition = (node: MindElement, definition: Definition) => {
  definition.segments.forEach((segment, index) => {
    if (index === definition.headerIndex || !isList(segment) || !segment.length) {
      return;
    }
    const head = segment[0];
    if (!isAtom(head)) {
      appendGenericSection(node, segment);
      return;
    }
    const key = head.toLowerCase();
    if (key === ':domain') {
      appendRequirementLikeSection(node, 'Domain', segment.slice(1));
    } else if (key === ':objects' || key === ':init' || key === ':goal') {
      appendPredicateSection(node, toTitleCase(head), segment.slice(1));
    } else if (key === ':metric' || key === ':constraints') {
      appendGenericSection(node, segment);
    } else {
      appendGenericSection(node, segment);
    }
  });
};

const createRootMind = (label: string): MindElement => {
  const mind = createMindElement(label, { layout: MindLayoutType.right });
  mind.isRoot = true;
  mind.type = 'mindmap';
  mind.points = [[0, 0]];
  return mind;
};

export const parsePddlToMind = (definition: string): MindElement => {
  const cleanedDefinition = stripComments(definition).trim();
  if (!cleanedDefinition) {
    throw new Error('PDDL content is empty.');
  }

  const tokens = tokenize(cleanedDefinition);
  if (!tokens.length) {
    throw new Error('Unable to tokenize the provided PDDL content.');
  }

  const expressions = parseTokensToSExpr(tokens).filter(isList);
  const definitions = expressions
    .map((expr) => classifyDefinition(expr))
    .filter((definition): definition is Definition => Boolean(definition));

  if (!definitions.length) {
    throw new Error('No PDDL definitions were detected.');
  }

  const domainDefinition = definitions.find((definition) => definition.kind === 'domain');
  const problemDefinition = definitions.find((definition) => definition.kind === 'problem');

  const rootLabel =
    (domainDefinition && domainDefinition.name && `Domain: ${domainDefinition.name}`) ||
    (problemDefinition && problemDefinition.name && `Problem: ${problemDefinition.name}`) ||
    DEFAULT_ROOT_LABEL;

  const root = createRootMind(rootLabel);

  definitions.forEach((definition, index) => {
    if (definition.kind === 'domain') {
      const isPrimary = definition === domainDefinition;
      const targetNode = isPrimary ? root : addChild(root, `Domain: ${definition.name ?? 'Unnamed Domain'}`);
      appendDomainDefinition(targetNode, definition);
    } else if (definition.kind === 'problem') {
      const isPrimary = definition === problemDefinition && !domainDefinition;
      const targetNode = isPrimary
        ? root
        : addChild(root, `Problem: ${definition.name ?? 'Unnamed Problem'}`);
      appendProblemDefinition(targetNode, definition);
    } else {
      appendGenericSection(root, [definition.name ?? 'Definition', ...definition.segments]);
    }
  });

  return root;
};

