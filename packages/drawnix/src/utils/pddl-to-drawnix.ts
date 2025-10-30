import { MindLayoutType } from '@plait/layouts';
import { createMindElement, MindElement } from '@plait/mind';
import type {
  Action,
  DomainInfo,
  ProblemInfo,
  TypeObjectMap,
  TypeObjects,
} from 'pddl-workspace';
import { parser, DurativeAction, InstantAction } from 'pddl-workspace';

type SExprAtom = string;
type SExpr = Array<SExprAtom | SExpr>;

interface Definition {
  kind: 'domain' | 'problem' | 'unknown';
  name?: string;
  segments: SExpr[];
  headerIndex: number | null;
  expr: SExpr;
}

const DEFAULT_ROOT_LABEL = 'PDDL Diagram';

const isAtom = (value: SExprAtom | SExpr): value is SExprAtom =>
  typeof value === 'string';

const isList = (value: SExprAtom | SExpr): value is SExpr => Array.isArray(value);

const formatSExpr = (expr: SExprAtom | SExpr): string => {
  if (isAtom(expr)) {
    return expr;
  }
  return `(${expr.map((item) => formatSExpr(item)).join(' ')})`;
};

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
    expr,
  };
};

const createRootMind = (label: string): MindElement => {
  const mind = createMindElement(label, { layout: MindLayoutType.right });
  mind.isRoot = true;
  mind.type = 'mindmap';
  mind.points = [[0, 0]];
  return mind;
};

const getTypeObjectEntries = (map: TypeObjectMap | undefined) => {
  if (!map) {
    return [];
  }
  const entries: { type: string; objects: string[] }[] = [];
  const anyMap = map as unknown as {
    typeNameToTypeObjectMap?: Map<string, TypeObjects>;
  };
  if (anyMap?.typeNameToTypeObjectMap instanceof Map) {
    anyMap.typeNameToTypeObjectMap.forEach((typeObjects) => {
      entries.push({
        type: typeObjects.type,
        objects: typeObjects.getObjects(),
      });
    });
  }
  return entries;
};

const formatActionParameters = (action: Action) =>
  action.parameters.map((param) => param.toPddlString()).join(', ');

const appendActionDetails = (actionNode: MindElement, action: Action) => {
  if (action.parameters.length) {
    addChild(
      actionNode,
      `Parameters: ${formatActionParameters(action)}`
    );
  } else {
    addChild(actionNode, 'Parameters: (none)');
  }

  if (action instanceof DurativeAction) {
    if (action.duration) {
      addChild(actionNode, `Duration: ${action.duration.getNonCommentText().trim()}`);
    }
    if (action.condition) {
      addChild(actionNode, `Condition: ${action.condition.getNonCommentText().trim()}`);
    }
    if (action.effect) {
      addChild(actionNode, `Effect: ${action.effect.getNonCommentText().trim()}`);
    }
    return;
  }

  if (action instanceof InstantAction) {
    if (action.preCondition) {
      addChild(
        actionNode,
        `Precondition: ${action.preCondition.getNonCommentText().trim()}`
      );
    }
    if (action.effect) {
      addChild(
        actionNode,
        `Effect: ${action.effect.getNonCommentText().trim()}`
      );
    }
  }
};

const appendDomainInfo = (root: MindElement, domain: DomainInfo, isPrimary: boolean) => {
  const label = `Domain: ${domain.name || 'Unnamed Domain'}`;
  const domainNode = isPrimary ? root : addChild(root, label);

  const predicates = domain.getPredicates();
  const predicateSection = addChild(domainNode, 'Predicates');
  if (!predicates.length) {
    addChild(predicateSection, '(none)');
  } else {
    predicates.forEach((predicate) => {
      addChild(predicateSection, predicate.getFullName());
    });
  }

  const actions = domain.getActions();
  const actionSection = addChild(domainNode, 'Actions');
  if (!actions.length) {
    addChild(actionSection, '(none)');
  } else {
    actions.forEach((action) => {
      const actionNode = addChild(
        actionSection,
        action.name ? action.name : 'Unnamed Action'
      );
      appendActionDetails(actionNode, action);
    });
  }
};

const appendProblemInfo = (
  root: MindElement,
  problem: ProblemInfo,
  isPrimary: boolean
) => {
  const label = `Problem: ${problem.name || 'Unnamed Problem'}`;
  const problemNode = isPrimary ? root : addChild(root, label);

  addChild(problemNode, `Domain Reference: ${problem.domainName || '(unknown)'}`);

  const objectsSection = addChild(problemNode, 'Objects');
  const entries = getTypeObjectEntries(problem.getObjectsTypeMap());

  if (!entries.length) {
    addChild(objectsSection, '(none)');
    return;
  }

  entries.forEach(({ type, objects }) => {
    const typeNode = addChild(objectsSection, `${type}`);
    if (!objects.length) {
      addChild(typeNode, '(none)');
      return;
    }
    objects.forEach((objectName) => {
      addChild(typeNode, objectName);
    });
  });
};

export const parsePddlToMind = async (definition: string): Promise<MindElement> => {
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

  const domainInfos: DomainInfo[] = [];
  const problemInfos: ProblemInfo[] = [];

  for (const definitionEntry of definitions) {
    const definitionText = formatSExpr(definitionEntry.expr);
    try {
      if (definitionEntry.kind === 'domain') {
        const domainInfo = parser.PddlDomainParser.parseText(definitionText);
        if (domainInfo) {
          domainInfos.push(domainInfo);
        }
      } else if (definitionEntry.kind === 'problem') {
        const problemInfo = await parser.PddlProblemParser.parseText(definitionText);
        if (problemInfo) {
          problemInfos.push(problemInfo);
        }
      }
    } catch (err) {
      throw new Error(
        `Failed to parse the ${definitionEntry.kind} definition: ${(err as Error).message}`
      );
    }
  }

  const primaryDomain = domainInfos[0];
  const primaryProblem = problemInfos[0];

  const rootLabel =
    (primaryDomain && primaryDomain.name && `Domain: ${primaryDomain.name}`) ||
    (primaryProblem && primaryProblem.name && `Problem: ${primaryProblem.name}`) ||
    DEFAULT_ROOT_LABEL;

  const root = createRootMind(rootLabel);

  if (primaryDomain) {
    appendDomainInfo(root, primaryDomain, true);
  }

  domainInfos.slice(1).forEach((domainInfo) => {
    appendDomainInfo(root, domainInfo, false);
  });

  if (primaryProblem) {
    const useRootForProblem = !primaryDomain;
    appendProblemInfo(root, primaryProblem, useRootForProblem);
  }

  problemInfos
    .slice(primaryProblem ? 1 : 0)
    .forEach((problemInfo) => {
      appendProblemInfo(root, problemInfo, false);
    });

  return root;
};
