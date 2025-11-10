import { PlaitElement, Point } from '@plait/core';
import { ArrowLineShape, ArrowLineMarkerType, BasicShapes } from '@plait/draw';
import {
  PddlDomain,
  PddlAction,
  PddlExpression,
  PddlPredicateExpression,
  PddlTypedParameter,
  PddlProblem,
  PddlFunctionExpression,
  PddlNumberLiteral,
  PddlCompositeExpression,
  PddlExpressionArgument,
} from '../app/pddl_types';

// 清理ID中的特殊字符，使其符合CSS选择器规范
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// 节点和边的配置
const NODE_WIDTH = 120;
const NODE_HEIGHT = 60;
const PARAMETER_NODE_WIDTH = NODE_WIDTH * 0.7;
const PARAMETER_NODE_HEIGHT = NODE_HEIGHT * 0.7;
const NODE_SPACING_X = 200;
const NODE_SPACING_Y = 150;
const START_X = 100;
const START_Y = 100;
const PRECONDITION_COLOR = '#f28b82';
const EFFECT_COLOR = '#81c995';
const SECTION_GAP = NODE_SPACING_Y / 2;
const ACTION_COLUMNS = 3;
const ACTION_GROUP_WIDTH = NODE_WIDTH + NODE_SPACING_X * (ACTION_COLUMNS - 1);
const PROBLEM_MAX_COLUMNS = 12;
const FUNCTION_NODE_COLOR = '#b39ddb';
const OPERATOR_NODE_COLOR = '#4a90e2';
const COMPARATOR_STACK_LEVELS = 3;
const COMPARATOR_BLOCK_HEIGHT = NODE_SPACING_Y * COMPARATOR_STACK_LEVELS;
const COMPARATOR_TYPES = new Set([
  '=',
  '<=',
  '>=',
  '<',
  '>',
  'equal',
  'lesser-equal',
  'greater-equal',
  'lesser',
  'greater',
]);
const COMPARATOR_LABEL_MAP: Record<string, string> = {
  '=': '=',
  equal: '=',
  '<=': '<=',
  'lesser-equal': '<=',
  '≤': '<=',
  '>=': '>=',
  'greater-equal': '>=',
  '≥': '>=',
  '<': '<',
  lesser: '<',
  '>': '>',
  greater: '>',
};
let actionGroupCounter = 0;
let problemGroupCounter = 0;

type GraphNodeShape = 'rectangle' | 'ellipse';

interface GraphNodeInfo {
  id: string;
  origin: Point;
  center: Point;
  width: number;
  height: number;
  shape: GraphNodeShape;
}

function createGraphNodeInfo(
  id: string,
  x: number,
  y: number,
  width = NODE_WIDTH,
  height = NODE_HEIGHT,
  shape: GraphNodeShape = 'rectangle'
): GraphNodeInfo {
  const origin = [x, y] as Point;
  const center = getNodeCenter(x, y, width, height);
  return {
    id,
    origin,
    center,
    width,
    height,
    shape,
  };
}

function getConnectionPointOfNode(node: GraphNodeInfo, point: Point = node.center): [number, number] {
  const [px, py] = point;
  const [ox, oy] = node.origin;
  const connectionX = node.width ? (px - ox) / node.width : 0.5;
  const connectionY = node.height ? (py - oy) / node.height : 0.5;
  return [connectionX, connectionY];
}

function getNodeBorderPointTowards(node: GraphNodeInfo, target: Point): Point {
  const [centerX, centerY] = node.center;
  const [targetX, targetY] = target;
  const dx = targetX - centerX;
  const dy = targetY - centerY;

  if (dx === 0 && dy === 0) {
    return [centerX, centerY];
  }

  if (node.shape === 'ellipse') {
    const rx = node.width / 2;
    const ry = node.height / 2;
    if (rx === 0 || ry === 0) {
      return [centerX, centerY];
    }
    const denominator = Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
    if (denominator === 0) {
      return [centerX, centerY];
    }
    const scale = 1 / denominator;
    return [centerX + dx * scale, centerY + dy * scale];
  }

  const halfWidth = node.width / 2;
  const halfHeight = node.height / 2;
  if (halfWidth === 0 || halfHeight === 0) {
    return [centerX, centerY];
  }

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const scaleX = absDx === 0 ? Number.POSITIVE_INFINITY : halfWidth / absDx;
  const scaleY = absDy === 0 ? Number.POSITIVE_INFINITY : halfHeight / absDy;
  const scale = Math.min(scaleX, scaleY);

  return [centerX + dx * scale, centerY + dy * scale];
}

// 创建矩形几何图形节点
function createGeometryNode(
  text: string,
  x: number,
  y: number,
  id: string,
  width: number = NODE_WIDTH,
  height: number = NODE_HEIGHT
): PlaitElement {
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
    fill: '#e8f4fd',
    strokeColor: '#1e88e5',
    strokeWidth: 2,
    text: {
      children: [
        {
          type: 'paragraph',
          align: 'center',
          children: [
            {
              text: text,
            },
          ],
        },
      ],
    },
  } as any;
}

// 创建箭头连线并与节点绑定，确保移动时自动跟随
function createArrowLine(
  sourceNode: GraphNodeInfo,
  targetNode: GraphNodeInfo,
  label: string | undefined,
  id: string,
  options: {
    sourceMarker?: ArrowLineMarkerType;
    targetMarker?: ArrowLineMarkerType;
  } = {}
): PlaitElement {
  const sourcePoint = getNodeBorderPointTowards(sourceNode, targetNode.center);
  const targetPoint = getNodeBorderPointTowards(targetNode, sourceNode.center);
  const line: any = {
    id,
    type: 'arrow-line',
    shape: ArrowLineShape.straight,
    points: [sourcePoint, targetPoint],
    source: {
      boundId: sourceNode.id,
      connection: getConnectionPointOfNode(sourceNode, sourcePoint),
      marker: options.sourceMarker ?? ArrowLineMarkerType.none,
    },
    target: {
      boundId: targetNode.id,
      connection: getConnectionPointOfNode(targetNode, targetPoint),
      marker: options.targetMarker ?? ArrowLineMarkerType.arrow,
    },
    strokeColor: '#666666',
    strokeWidth: 2,
    opacity: 1,
  };

  line.texts = label
    ? [
        {
          text: {
            children: [
              {
                type: 'paragraph',
                align: 'center',
                children: [
                  {
                    text: label,
                  },
                ],
              },
            ],
          },
          position: 0.5, // 在线的中间位置
        },
      ]
    : [];

  return line;
}

// 获取节点的中心点
function getNodeCenter(x: number, y: number, width = NODE_WIDTH, height = NODE_HEIGHT): Point {
  return [x + width / 2, y + height / 2];
}

// 创建谓词节点（圆形表示）
function createPredicateNode(
  text: string,
  x: number,
  y: number,
  id: string,
  fillColor: string
): PlaitElement {
  return {
    id,
    type: 'geometry',
    shape: BasicShapes.ellipse,
    points: [
      [x, y],
      [x + NODE_WIDTH, y + NODE_HEIGHT],
    ],
    angle: 0,
    opacity: 1,
    fill: fillColor,
    strokeColor: '#444444',
    strokeWidth: 2,
    text: {
      children: [
        {
          type: 'paragraph',
          align: 'center',
          children: [
            {
              text: text,
            },
          ],
        },
      ],
    },
  } as any;
}

function createDescriptionNode(
  text: string,
  x: number,
  y: number,
  id: string,
  width: number,
  height: number,
  role: 'action' | 'problem-init' | 'problem-goal'
): PlaitElement {
  const node = createGeometryNode(text, x, y, id, width, height);
  (node as any).fill = role === 'action' ? '#fff7e6' : role === 'problem-init' ? '#fdecea' : '#ecf8f1';
  (node as any).strokeColor = role === 'action' ? '#d48806' : role === 'problem-init' ? '#d93025' : '#0f9d58';
  (node as any).data = {
    role: `${role}-description`,
    showOnHover: true,
    editable: true,
  };
  (node as any).text = {
    children: [
      {
        type: 'paragraph',
        align: 'center',
        children: [
          {
            text: text,
          },
        ],
      },
    ],
  };
  return node;
}

function isNumberLiteralArgument(argument?: PddlExpressionArgument): argument is PddlNumberLiteral {
  return Boolean(
    argument &&
      typeof argument === 'object' &&
      'type' in argument &&
      (argument as PddlNumberLiteral).type === 'number'
  );
}

function isFunctionExpressionArgument(
  argument?: PddlExpressionArgument
): argument is PddlFunctionExpression {
  return Boolean(
    argument &&
      typeof argument === 'object' &&
      'type' in argument &&
      (argument as PddlFunctionExpression).type === 'function'
  );
}

function stringifyExpressionArgument(argument?: PddlExpressionArgument): string {
  if (!argument) {
    return '?';
  }
  if (typeof argument === 'string') {
    return argument;
  }
  if (isNumberLiteralArgument(argument)) {
    return `${argument.value}`;
  }
  if (isFunctionExpressionArgument(argument)) {
    return formatFunctionLabel(argument);
  }
  if (typeof argument === 'object' && 'name' in argument && typeof (argument as any).name === 'string') {
    return (argument as any).name;
  }
  if (typeof argument === 'object' && 'type' in argument && typeof (argument as any).type === 'string') {
    return (argument as any).type as string;
  }
  return '?';
}

function formatFunctionLabel(funcExpr: PddlFunctionExpression): string {
  const rawArgs = Array.isArray(funcExpr.arguments) ? funcExpr.arguments : [];
  const argTexts = rawArgs
    .map((arg) => stringifyExpressionArgument(arg))
    .filter((text) => text && text !== '?');
  return argTexts.length > 0 ? `${funcExpr.name}(${argTexts.join(', ')})` : funcExpr.name;
}

function getComparatorLabel(type?: string): string {
  if (!type) {
    return '=';
  }
  const normalized = type.trim();
  return COMPARATOR_LABEL_MAP[normalized] ?? normalized;
}

// 提取谓词或函数表达式中的参数
function extractExpressionArguments(expr: PddlExpression): string[] {
  if (expr.type === 'predicate' || expr.type === 'function') {
    const targetExpr = expr as PddlPredicateExpression | PddlFunctionExpression;
    return (targetExpr.arguments || [])
      .filter((arg) => typeof arg === 'object' && 'name' in arg)
      .map((arg) => (arg as PddlTypedParameter).name);
  }
  return [];
}

// 递归提取所有谓词表达式
interface ExtractedPredicate {
  expr: PddlPredicateExpression;
  isNegated: boolean;
}

function extractAllPredicates(expressions: PddlExpression[]): ExtractedPredicate[] {
  const predicates: ExtractedPredicate[] = [];

  function extract(expr: PddlExpression, isNegated: boolean) {
    if (expr.type === 'predicate') {
      predicates.push({
        expr: expr as PddlPredicateExpression,
        isNegated,
      });
    } else if (expr.type === 'not' && 'argument' in expr && expr.argument) {
      extract(expr.argument, !isNegated);
    } else if ('children' in expr && Array.isArray(expr.children)) {
      expr.children.forEach((child) => extract(child, isNegated));
    } else if ('items' in expr && Array.isArray((expr as any).items)) {
      (expr as any).items.forEach((item: PddlExpression) => extract(item, isNegated));
    } else if ('argument' in expr && expr.argument) {
      extract(expr.argument, isNegated);
    }
  }

  expressions.forEach((expression) => extract(expression, false));
  return predicates;
}

function isComparatorExpression(expr: PddlExpression): expr is PddlCompositeExpression {
  return COMPARATOR_TYPES.has(expr.type);
}

function extractComparatorExpressions(expressions: PddlExpression[]): PddlCompositeExpression[] {
  const comparators: PddlCompositeExpression[] = [];
  const visit = (expr: PddlExpression) => {
    if (isComparatorExpression(expr)) {
      comparators.push(expr as PddlCompositeExpression);
    }
    if ('children' in expr && Array.isArray(expr.children)) {
      expr.children.forEach((child) => visit(child));
    }
    if ('items' in expr && Array.isArray((expr as any).items)) {
      (expr as any).items.forEach((item: PddlExpression) => visit(item));
    }
    if ('argument' in expr && expr.argument) {
      visit(expr.argument);
    }
  };
  expressions.forEach((expression) => visit(expression));
  return comparators;
}

// 为单个action创建图形（包含参数节点、谓词节点与连线）
export function createActionGraph(action: PddlAction, startX: number, startY: number): {
  elements: PlaitElement[];
  width: number;
  height: number;
} {
  const elements: PlaitElement[] = [];
  const groupId = sanitizeId(`group-${action.name}-${actionGroupCounter++}`);
  const actionDescription =
    (action.description && action.description.trim().length > 0
      ? action.description.trim()
      : action.actionDescription && action.actionDescription.trim().length > 0
      ? action.actionDescription.trim()
      : 'Action description');
  const groupedElementIds: string[] = [];
  const registerElement = <T extends PlaitElement>(element: T): T => {
    (element as any).groupId = groupId;
    groupedElementIds.push(element.id);
    elements.push(element);
    return element;
  };
  const parameterNodes = new Map<string, GraphNodeInfo>();
  const predicateNodes: Array<
    GraphNodeInfo & {
      expr: PddlPredicateExpression;
      label: string;
      type: 'precondition' | 'effect';
    }
  > = [];

  // 1. 创建action名称标题节点
  const actionTitleId = sanitizeId(`action-${action.name}`);
  registerElement(
    createGeometryNode(
      `Action: ${action.name}`,
      startX,
      startY,
      actionTitleId,
      ACTION_GROUP_WIDTH,
      NODE_HEIGHT
    )
  );
  let maxElementBottom = startY + NODE_HEIGHT;

  const preconditionPredicates = extractAllPredicates(action.preconditions);
  const effectPredicates = extractAllPredicates(action.effects);
  const preconditionRows = Math.ceil(preconditionPredicates.length / ACTION_COLUMNS);
  const parameterRows = Math.ceil(action.parameters.length / ACTION_COLUMNS);
  const effectRows = Math.ceil(effectPredicates.length / ACTION_COLUMNS);
  const initialSectionY = startY + NODE_SPACING_Y;
  let nextSectionY = initialSectionY;
  let lastSectionStartY = startY;
  let lastSectionRows = 0;

  const descriptionId = sanitizeId(`${groupId}-description`);
  const descriptionBaseY = nextSectionY;
  const descriptionHeight = NODE_HEIGHT * 4;
  registerElement(
    createDescriptionNode(
      actionDescription,
      startX,
      descriptionBaseY,
      descriptionId,
      ACTION_GROUP_WIDTH,
      descriptionHeight,
      'action'
    )
  );
  lastSectionStartY = descriptionBaseY;
  lastSectionRows = Math.max(1, Math.ceil(descriptionHeight / NODE_SPACING_Y));
  maxElementBottom = Math.max(maxElementBottom, descriptionBaseY + descriptionHeight);
  nextSectionY = descriptionBaseY + descriptionHeight + SECTION_GAP;

  const placePredicateNode = (
    extracted: ExtractedPredicate,
    index: number,
    type: 'precondition' | 'effect',
    baseY: number
  ) => {
    const predicate = extracted.expr;
    const x = startX + (index % ACTION_COLUMNS) * NODE_SPACING_X;
    const y = baseY + Math.floor(index / ACTION_COLUMNS) * NODE_SPACING_Y;
    const nodeId = sanitizeId(`predicate-${action.name}-${type}-${index}-${predicate.name}`);
    const fillColor = type === 'precondition' ? PRECONDITION_COLOR : EFFECT_COLOR;
    const label = extracted.isNegated ? `not ${predicate.name}` : predicate.name;

    const nodeInfo = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
    registerElement(createPredicateNode(label, x, y, nodeId, fillColor));
      predicateNodes.push({
        ...nodeInfo,
        expr: predicate,
        label,
        type,
      });
    maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
  };

  if (preconditionPredicates.length > 0) {
    preconditionPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'precondition', nextSectionY);
    });
    lastSectionStartY = nextSectionY;
    lastSectionRows = Math.max(preconditionRows, 1);
    nextSectionY += preconditionRows * NODE_SPACING_Y + SECTION_GAP;
  }

  const parameterStartY = nextSectionY;
  if (action.parameters.length > 0) {
    action.parameters.forEach((param, index) => {
      const width = PARAMETER_NODE_WIDTH;
      const height = PARAMETER_NODE_HEIGHT;
      const x = startX + (index % ACTION_COLUMNS) * NODE_SPACING_X;
      const y = parameterStartY + Math.floor(index / ACTION_COLUMNS) * NODE_SPACING_Y;

      const paramText = param.type ? `${param.name}: ${param.type}` : param.name;
      const nodeId = sanitizeId(`param-${action.name}-${param.name}`);

      registerElement(createGeometryNode(paramText, x, y, nodeId, width, height));
      parameterNodes.set(param.name, createGraphNodeInfo(nodeId, x, y, width, height));
      maxElementBottom = Math.max(maxElementBottom, y + height);
    });
    lastSectionStartY = parameterStartY;
    lastSectionRows = Math.max(parameterRows, 1);
    nextSectionY += parameterRows * NODE_SPACING_Y + SECTION_GAP;
  } else if (preconditionPredicates.length > 0) {
    // 即使没有参数，也在谓词层与效果层之间保留一个额外间隔
    nextSectionY += SECTION_GAP;
  }

  const effectStartY = nextSectionY;
  if (effectPredicates.length > 0) {
    effectPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'effect', effectStartY);
    });
    lastSectionStartY = effectStartY;
    lastSectionRows = Math.max(effectRows, 1);
    nextSectionY += effectRows * NODE_SPACING_Y;
    maxElementBottom = Math.max(maxElementBottom, effectStartY + effectRows * NODE_SPACING_Y);
  }

  let edgeIndex = 0;
  predicateNodes.forEach((predicateNode) => {
    const args = extractExpressionArguments(predicateNode.expr);
    if (args.length === 0) {
      return;
    }

    const firstParam = parameterNodes.get(args[0]);
    if (firstParam) {
      const edgeId = sanitizeId(`edge-${action.name}-${predicateNode.id}-in-${edgeIndex++}`);
      registerElement(
        createArrowLine(
          firstParam,
          predicateNode,
          undefined,
          edgeId
        )
      );
    }

    for (let i = 1; i < args.length; i += 1) {
      const targetParam = parameterNodes.get(args[i]);
      if (!targetParam) {
        continue;
      }
      const edgeId = sanitizeId(`edge-${action.name}-${predicateNode.id}-out-${edgeIndex++}`);
      registerElement(
        createArrowLine(
          predicateNode,
          targetParam,
          undefined,
          edgeId
        )
      );
    }
  });

  const groupElement: PlaitElement = {
    id: groupId,
    type: 'group',
    description: actionDescription,
    data: {
      type: 'action',
      description: actionDescription,
      editableDescription: true,
      descriptionElementId: descriptionId,
      elementIds: groupedElementIds,
    },
  } as any;
  elements.unshift(groupElement);

  // 计算总宽度和高度
  const width = ACTION_GROUP_WIDTH;
  const lastSectionBottomY = Math.max(
    maxElementBottom,
    lastSectionRows > 0 ? lastSectionStartY + lastSectionRows * NODE_SPACING_Y : startY + NODE_SPACING_Y
  );
  const height = lastSectionBottomY - startY + NODE_HEIGHT;

  return { elements, width, height };
}

export function createProblemGraph(problem: PddlProblem, startX: number, startY: number): {
  elements: PlaitElement[];
  width: number;
  height: number;
} {
  const elements: PlaitElement[] = [];
  const groupId = sanitizeId(`problem-${problem.name ?? 'noname'}-${problemGroupCounter++}`);
  const initDescriptionText =
    problem.initDescription && problem.initDescription.trim().length > 0
      ? problem.initDescription.trim()
      : 'Init description';
  const goalDescriptionText =
    problem.goalDescription && problem.goalDescription.trim().length > 0
      ? problem.goalDescription.trim()
      : 'Goal description';
  const groupedElementIds: string[] = [];
  const registerElement = <T extends PlaitElement>(element: T): T => {
    (element as any).groupId = groupId;
    groupedElementIds.push(element.id);
    elements.push(element);
    return element;
  };

  const objectNodes = new Map<string, GraphNodeInfo>();
  const predicateNodes: Array<
    GraphNodeInfo & {
      expr: PddlPredicateExpression;
      label: string;
      category: 'init' | 'goal';
    }
  > = [];
  const functionNodes: Array<
    GraphNodeInfo & {
      expr: PddlFunctionExpression;
      label: string;
      category: 'init' | 'goal';
    }
  > = [];

  const descriptionHeight = NODE_HEIGHT * 4;
  const initExpressions = Array.isArray(problem.init)
    ? problem.init
    : problem.init
    ? [problem.init]
    : [];
  const initPredicates = extractAllPredicates(initExpressions);
  const initComparators = extractComparatorExpressions(initExpressions);
  const goalExpressions = problem.goal ? [problem.goal] : [];
  const goalPredicates = extractAllPredicates(goalExpressions);
  const goalComparators = extractComparatorExpressions(goalExpressions);
  const objects = Array.isArray(problem.objects) ? problem.objects : [];
  const sectionCounts = [
    initPredicates.length + initComparators.length,
    objects.length,
    goalPredicates.length + goalComparators.length,
  ];
  const maxCount = Math.max(1, ...sectionCounts);
  const problemColumns = Math.min(PROBLEM_MAX_COLUMNS, maxCount);
  const problemWidth = NODE_WIDTH + NODE_SPACING_X * (problemColumns - 1);

  const initDescriptionId = sanitizeId(`${groupId}-init-description`);
  registerElement(
    createDescriptionNode(
      initDescriptionText,
      startX,
      startY,
      initDescriptionId,
      problemWidth,
      descriptionHeight,
      'problem-init'
    )
  );

  let maxElementBottom = startY + descriptionHeight;
  let nextSectionY = startY + descriptionHeight + SECTION_GAP;
  let lastSectionStartY = startY;
  let lastSectionRows = Math.max(1, Math.ceil(descriptionHeight / NODE_SPACING_Y));
  let functionNodeCounter = 0;
  let valueNodeCounter = 0;
  let comparatorNodeCounter = 0;
  let comparatorEdgeCounter = 0;

  const createFunctionNodeForExpression = (
    funcExpr: PddlFunctionExpression,
    category: 'init' | 'goal',
    x: number,
    y: number,
    suffix: string
  ): GraphNodeInfo => {
    const label = formatFunctionLabel(funcExpr);
    const nodeId = sanitizeId(
      `function-${problem.name}-${category}-${suffix}-${functionNodeCounter++}-${funcExpr.name}`
    );
    registerElement(createPredicateNode(label, x, y, nodeId, FUNCTION_NODE_COLOR));
    const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
    functionNodes.push({
      ...info,
      expr: funcExpr,
      label,
      category,
    });
    maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
    return info;
  };

  const createComparatorArgumentNode = (
    argument: PddlExpressionArgument | undefined,
    category: 'init' | 'goal',
    x: number,
    y: number,
    suffix: string
  ): GraphNodeInfo | null => {
    if (!argument) {
      return null;
    }
    if (isFunctionExpressionArgument(argument)) {
      return createFunctionNodeForExpression(argument, category, x, y, suffix);
    }
    const label = stringifyExpressionArgument(argument);
    const nodeId = sanitizeId(`literal-${problem.name}-${category}-${suffix}-${valueNodeCounter++}`);
    registerElement(createPredicateNode(label, x, y, nodeId, FUNCTION_NODE_COLOR));
    const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
    maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
    return info;
  };

  const placeComparatorSection = (
    comparators: PddlCompositeExpression[],
    category: 'init' | 'goal',
    baseY: number
  ): number => {
    if (comparators.length === 0) {
      return baseY;
    }
    const sectionRows = Math.ceil(comparators.length / problemColumns);
    const sectionHeight = sectionRows * COMPARATOR_BLOCK_HEIGHT;

    comparators.forEach((expr, index) => {
      const column = index % problemColumns;
      const row = Math.floor(index / problemColumns);
      const x = startX + column * NODE_SPACING_X;
      const stackTopY = baseY + row * COMPARATOR_BLOCK_HEIGHT;
      const args = Array.isArray(expr.arguments) ? expr.arguments : [];
      const leftArg = createComparatorArgumentNode(
        args[0],
        category,
        x,
        stackTopY,
        `comp-left-${category}-${index}`
      );
      const operatorY = stackTopY + NODE_SPACING_Y;
      const rightArgument = args[1];
      const rightArgumentIsNumber = isNumberLiteralArgument(rightArgument);
      const rightArgumentLabel = rightArgumentIsNumber ? stringifyExpressionArgument(rightArgument) : null;
      const operatorLabel = rightArgumentLabel
        ? `${getComparatorLabel(expr.type)} ${rightArgumentLabel}`
        : getComparatorLabel(expr.type);
      const operatorId = sanitizeId(
        `operator-${problem.name}-${category}-${index}-${comparatorNodeCounter++}`
      );
      registerElement(createPredicateNode(operatorLabel, x, operatorY, operatorId, OPERATOR_NODE_COLOR));
      const operatorInfo = createGraphNodeInfo(operatorId, x, operatorY, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      maxElementBottom = Math.max(maxElementBottom, operatorY + NODE_HEIGHT);

      const rightArg =
        !rightArgumentIsNumber && rightArgument
          ? createComparatorArgumentNode(
              rightArgument,
              category,
              x,
              operatorY + NODE_SPACING_Y,
              `comp-right-${category}-${index}`
            )
          : null;

      if (leftArg) {
        const edgeId = sanitizeId(
          `comp-edge-${problem.name}-${category}-in-${comparatorEdgeCounter++}`
        );
        registerElement(createArrowLine(leftArg, operatorInfo, undefined, edgeId));
      }

      if (rightArg) {
        const edgeId = sanitizeId(
          `comp-edge-${problem.name}-${category}-out-${comparatorEdgeCounter++}`
        );
        registerElement(createArrowLine(operatorInfo, rightArg, undefined, edgeId));
      }

      const blockBottom = rightArg
        ? rightArg.origin[1] + NODE_HEIGHT
        : operatorInfo.origin[1] + NODE_HEIGHT;
      maxElementBottom = Math.max(maxElementBottom, blockBottom);
    });

    maxElementBottom = Math.max(maxElementBottom, baseY + sectionHeight);
    lastSectionStartY = baseY;
    lastSectionRows = Math.max(lastSectionRows, Math.ceil(sectionHeight / NODE_SPACING_Y));
    return baseY + sectionHeight + SECTION_GAP;
  };

  const placePredicateNode = (
    extracted: ExtractedPredicate,
    index: number,
    category: 'init' | 'goal',
    baseY: number
  ) => {
    const predicate = extracted.expr;
    const x = startX + (index % problemColumns) * NODE_SPACING_X;
    const y = baseY + Math.floor(index / problemColumns) * NODE_SPACING_Y;
    const nodeId = sanitizeId(`problem-${problem.name}-${category}-${index}-${predicate.name}`);
    const fillColor = category === 'init' ? PRECONDITION_COLOR : EFFECT_COLOR;
    const label = extracted.isNegated ? `not ${predicate.name}` : predicate.name;

    const nodeInfo = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
    registerElement(createPredicateNode(label, x, y, nodeId, fillColor));
    predicateNodes.push({
      ...nodeInfo,
      expr: predicate,
      label,
      category,
    });
    maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
  };

  if (initPredicates.length > 0) {
    initPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'init', nextSectionY);
    });
    lastSectionStartY = nextSectionY;
    const initRows = Math.ceil(initPredicates.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, initRows);
    nextSectionY += initRows * NODE_SPACING_Y + SECTION_GAP;
  }

  nextSectionY = placeComparatorSection(initComparators, 'init', nextSectionY);

  const objectStartY = nextSectionY;
  if (objects.length > 0) {
    objects.forEach((object, index) => {
      const width = PARAMETER_NODE_WIDTH;
      const height = PARAMETER_NODE_HEIGHT;
      const x = startX + (index % problemColumns) * NODE_SPACING_X;
      const y = objectStartY + Math.floor(index / problemColumns) * NODE_SPACING_Y;
      const nodeId = sanitizeId(`object-${problem.name}-${object.name}`);
      const label = object.type ? `${object.name}: ${object.type}` : object.name;

      registerElement(createGeometryNode(label, x, y, nodeId, width, height));
      objectNodes.set(object.name, createGraphNodeInfo(nodeId, x, y, width, height));
      maxElementBottom = Math.max(maxElementBottom, y + height);
    });
    lastSectionStartY = objectStartY;
    const objectRows = Math.ceil(objects.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, objectRows);
    nextSectionY += objectRows * NODE_SPACING_Y + SECTION_GAP;
  }

  const goalStartY = nextSectionY;
  if (goalPredicates.length > 0) {
    goalPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'goal', goalStartY);
    });
    lastSectionStartY = goalStartY;
    const goalRows = Math.ceil(goalPredicates.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, goalRows);
    nextSectionY += goalRows * NODE_SPACING_Y + SECTION_GAP;
  }

  nextSectionY = placeComparatorSection(goalComparators, 'goal', nextSectionY);

  const goalDescriptionId = sanitizeId(`${groupId}-goal-description`);
  const goalDescriptionBaseY = nextSectionY;
  registerElement(
    createDescriptionNode(
      goalDescriptionText,
      startX,
      goalDescriptionBaseY,
      goalDescriptionId,
      problemWidth,
      descriptionHeight,
      'problem-goal'
    )
  );
  maxElementBottom = Math.max(maxElementBottom, goalDescriptionBaseY + descriptionHeight);
  lastSectionStartY = goalDescriptionBaseY;
  lastSectionRows = Math.max(lastSectionRows, Math.ceil(descriptionHeight / NODE_SPACING_Y));

  let edgeIndex = 0;
  predicateNodes.forEach((predicateNode) => {
    const args = extractExpressionArguments(predicateNode.expr);
    if (args.length === 0) {
      return;
    }

    const firstObject = objectNodes.get(args[0]);
    if (firstObject) {
      const edgeId = sanitizeId(`problem-edge-${predicateNode.id}-in-${edgeIndex++}`);
      registerElement(
        createArrowLine(firstObject, predicateNode, undefined, edgeId)
      );
    }

    for (let i = 1; i < args.length; i += 1) {
      const targetObject = objectNodes.get(args[i]);
      if (!targetObject) {
        continue;
      }
      const edgeId = sanitizeId(`problem-edge-${predicateNode.id}-out-${edgeIndex++}`);
      registerElement(
        createArrowLine(predicateNode, targetObject, undefined, edgeId)
      );
    }
  });

  functionNodes.forEach((functionNode) => {
    const args = extractExpressionArguments(functionNode.expr);
    if (args.length === 0) {
      return;
    }

    const firstObject = objectNodes.get(args[0]);
    if (firstObject) {
      const edgeId = sanitizeId(`problem-function-edge-${functionNode.id}-in-${edgeIndex++}`);
      registerElement(createArrowLine(firstObject, functionNode, undefined, edgeId));
    }

    for (let i = 1; i < args.length; i += 1) {
      const targetObject = objectNodes.get(args[i]);
      if (!targetObject) {
        continue;
      }
      const edgeId = sanitizeId(`problem-function-edge-${functionNode.id}-out-${edgeIndex++}`);
      registerElement(createArrowLine(functionNode, targetObject, undefined, edgeId));
    }
  });

  const groupElement: PlaitElement = {
    id: groupId,
    type: 'group',
    description: `Problem: ${problem.name}`,
    data: {
      type: 'problem',
      name: problem.name,
      initDescriptionId,
      goalDescriptionId,
      elementIds: groupedElementIds,
    },
  } as any;
  elements.unshift(groupElement);

  const width = problemWidth;
  const lastSectionBottomY = Math.max(
    maxElementBottom,
    lastSectionStartY + lastSectionRows * NODE_SPACING_Y
  );
  const height = lastSectionBottomY - startY + NODE_HEIGHT;

  return { elements, width, height };
}

// 为整个domain创建图形
export function createDomainGraph(domain: PddlDomain): PlaitElement[] {
  const allElements: PlaitElement[] = [];
  let currentX = START_X;
  const actions = Array.isArray(domain.actions) ? domain.actions : [];

  // 为每个action创建图形（从左到右单行排列）
  actions.forEach((action) => {
    const { elements, width } = createActionGraph(action, currentX, START_Y);
    allElements.push(...elements);
    currentX += width + NODE_SPACING_X;
  });

  return allElements;
}

// 主要的转换函数
export function convertPddlDomainToGraph(domain: PddlDomain): PlaitElement[] {
  return createDomainGraph(domain);
}

export function convertPddlProblemToGraph(problem: PddlProblem): PlaitElement[] {
  const { elements } = createProblemGraph(problem, START_X, START_Y);
  return elements;
}
