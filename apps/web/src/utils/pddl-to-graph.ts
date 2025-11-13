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
  PddlNumericExpression,
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
const NODE_SPACING_Y = 110;
const START_X = 100;
const START_Y = 100;
const PRECONDITION_COLOR = '#f28b82';
const EFFECT_COLOR = '#81c995';
const SECTION_GAP = NODE_SPACING_Y / 2;
const ACTION_COLUMNS = 3;
const ACTION_GROUP_WIDTH = NODE_WIDTH + NODE_SPACING_X * (ACTION_COLUMNS - 1);
const PROBLEM_MAX_COLUMNS = 8;
const FUNCTION_NODE_COLOR = '#b39ddb';
const OPERATOR_NODE_COLOR = '#4a90e2';
const LITERAL_NODE_COLOR = '#ffcc80';
const NUMERIC_EFFECT_TYPES = new Set(['increase', 'decrease']);
const NUMERIC_OPERATOR_LABEL_MAP: Record<string, string> = {
  times: '×',
  '*': '×',
  multiply: '×',
  plus: '+',
  '+': '+',
  minus: '-',
  '-': '-',
  subtract: '-',
  divide: '÷',
  '/': '÷',
  'scale-up': '↑',
  'scale-down': '↓',
  assign: '=',
};
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

type FunctionGraphNodeInfo = GraphNodeInfo & {
  expr: PddlFunctionExpression;
  label: string;
};

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
  const paragraphAlign = role === 'problem-init' ? 'left' : 'center';
  (node as any).text = {
    children: [
      {
        type: 'paragraph',
        align: paragraphAlign,
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

function isTypedParameterArgument(argument?: PddlExpressionArgument): argument is PddlTypedParameter {
  return Boolean(
    argument &&
      typeof argument === 'object' &&
      'name' in argument &&
      typeof (argument as any).name === 'string' &&
      !('arguments' in argument) &&
      !('children' in argument) &&
      !('argument' in argument) &&
      !('items' in argument)
  );
}

function isPddlExpressionValue(argument?: PddlExpressionArgument): argument is PddlExpression {
  if (!argument || typeof argument !== 'object') {
    return false;
  }
  const typeHint = (argument as any).type;
  if (typeof typeHint === 'string') {
    if (
      typeHint === 'predicate' ||
      typeHint === 'function' ||
      typeHint === 'not' ||
      typeHint === 'assign' ||
      typeHint === 'scale-up' ||
      typeHint === 'scale-down' ||
      typeHint === 'number' ||
      NUMERIC_EFFECT_TYPES.has(typeHint)
    ) {
      return true;
    }
  }
  return Boolean(
    ('arguments' in (argument as any) && Array.isArray((argument as any).arguments)) ||
      ('children' in (argument as any) && Array.isArray((argument as any).children)) ||
      ('argument' in (argument as any) && (argument as any).argument) ||
      ('items' in (argument as any) && Array.isArray((argument as any).items))
  );
}

function isNumericString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return !Number.isNaN(Number(trimmed));
}

function getNumericLiteralText(argument?: PddlExpressionArgument): string | null {
  if (argument == null) {
    return null;
  }

  if (typeof argument === 'number' && Number.isFinite(argument)) {
    return `${argument}`;
  }

  if (typeof argument === 'string' && isNumericString(argument)) {
    return argument.trim();
  }

  if (isNumberLiteralArgument(argument)) {
    return `${argument.value}`;
  }

  if (typeof argument === 'object') {
    const argAny = argument as any;
    const typeHint = typeof argAny.type === 'string' ? argAny.type : '';
    if (
      typeHint === 'function' ||
      typeHint === 'predicate' ||
      typeHint === 'not' ||
      typeHint === 'increase' ||
      typeHint === 'decrease' ||
      typeHint === 'assign' ||
      typeHint === 'scale-up' ||
      typeHint === 'scale-down'
    ) {
      return null;
    }
    const hasNestedStructure =
      Array.isArray(argAny.arguments) ||
      Array.isArray(argAny.children) ||
      Array.isArray(argAny.items) ||
      Boolean(argAny.argument);
    if (hasNestedStructure) {
      return null;
    }
    const rawValue = argAny.value ?? argAny.name;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return `${rawValue}`;
    }
    if (typeof rawValue === 'string' && isNumericString(rawValue)) {
      return rawValue.trim();
    }
  }

  return null;
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

function formatFunctionLabel(
  funcExpr: PddlFunctionExpression,
  options: { includeArguments?: boolean } = {}
): string {
  const includeArguments = options.includeArguments ?? true;
  if (!includeArguments) {
    return funcExpr.name;
  }
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

function getOperatorLabel(type?: string, fallback?: string): string {
  if (!type || typeof type !== 'string') {
    return fallback ?? '?';
  }
  const normalized = type.trim();
  return NUMERIC_OPERATOR_LABEL_MAP[normalized] ?? fallback ?? normalized;
}

function isNumericEffectExpression(expr?: PddlExpression): expr is PddlNumericExpression {
  return Boolean(expr && NUMERIC_EFFECT_TYPES.has(expr.type));
}

function expressionArgumentsToExpressions(args?: PddlExpressionArgument[]): PddlExpression[] {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.filter((arg): arg is PddlExpression => isPddlExpressionValue(arg));
}

function extractNumericEffects(expressions: PddlExpression[]): PddlNumericExpression[] {
  const numericExpressions: PddlNumericExpression[] = [];
  const visit = (expr: PddlExpression) => {
    if (isNumericEffectExpression(expr)) {
      numericExpressions.push(expr);
    }
    if ('children' in expr && Array.isArray(expr.children)) {
      expr.children.forEach((child) => visit(child));
    }
    if ('items' in expr && Array.isArray((expr as any).items)) {
      (expr as any).items.forEach((item: PddlExpression) => visit(item));
    }
    if ('argument' in expr && expr.argument && isPddlExpressionValue(expr.argument)) {
      visit(expr.argument);
    }
    if ('arguments' in expr && Array.isArray(expr.arguments)) {
      expr.arguments.forEach((arg) => {
        if (isPddlExpressionValue(arg)) {
          visit(arg);
        }
      });
    }
  };
  expressions.forEach((expr) => visit(expr));
  return numericExpressions;
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

function getPredicateLabel(extracted: ExtractedPredicate): string {
  return extracted.isNegated ? `not ${extracted.expr.name}` : extracted.expr.name;
}

function getUniquePredicates(predicates: ExtractedPredicate[]): ExtractedPredicate[] {
  const seen = new Set<string>();
  const unique: ExtractedPredicate[] = [];
  predicates.forEach((predicate) => {
    const label = getPredicateLabel(predicate);
    if (!seen.has(label)) {
      seen.add(label);
      unique.push(predicate);
    }
  });
  return unique;
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
  const functionNodes: FunctionGraphNodeInfo[] = [];
  const functionNodeMap = new Map<string, FunctionGraphNodeInfo>();
  const getFunctionNodeKey = (funcExpr: PddlFunctionExpression) => {
    const args = Array.isArray(funcExpr.arguments) ? funcExpr.arguments : [];
    const argSignature = args.map((arg) => stringifyExpressionArgument(arg)).join('|');
    return `${funcExpr.name}-${argSignature}`;
  };

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
  const numericEffects = extractNumericEffects(action.effects);
  const preconditionRows = Math.ceil(preconditionPredicates.length / ACTION_COLUMNS);
  const parameterRows = Math.ceil(action.parameters.length / ACTION_COLUMNS);
  const effectRows = Math.ceil(effectPredicates.length / ACTION_COLUMNS);
  const initialSectionY = startY + NODE_SPACING_Y;
  let nextSectionY = initialSectionY;
  let lastSectionStartY = startY;
  let lastSectionRows = 0;

  const descriptionId = sanitizeId(`${groupId}-description`);
  const descriptionBaseY = nextSectionY;
  const descriptionHeight = NODE_HEIGHT * 2;
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

  if (numericEffects.length > 0) {
    if (effectPredicates.length > 0) {
      nextSectionY += SECTION_GAP;
    }
    const numericSectionStartY = nextSectionY;
    let numericNodeCount = 0;
    let numericEdgeCounter = 0;
    let operatorNodeCounter = 0;
    let literalNodeCounter = 0;
    let functionNodeCounter = 0;
    const getNumericNodePosition = () => {
      const index = numericNodeCount;
      const column = index % ACTION_COLUMNS;
      const row = Math.floor(index / ACTION_COLUMNS);
      const x = startX + column * NODE_SPACING_X;
      const y = numericSectionStartY + row * NODE_SPACING_Y;
      numericNodeCount += 1;
      return { x, y };
    };

    const createLiteralNode = (label: string, suffix: string): GraphNodeInfo => {
      const { x, y } = getNumericNodePosition();
      const nodeId = sanitizeId(`literal-${action.name}-${suffix}-${literalNodeCounter++}`);
      registerElement(createPredicateNode(label, x, y, nodeId, LITERAL_NODE_COLOR));
      const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
      return info;
    };

    const createOperatorNode = (label: string, suffix: string, fillColor: string): GraphNodeInfo => {
      const { x, y } = getNumericNodePosition();
      const nodeId = sanitizeId(`operator-${action.name}-${suffix}-${operatorNodeCounter++}`);
      registerElement(createPredicateNode(label, x, y, nodeId, fillColor));
      const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
      return info;
    };

    const ensureFunctionNode = (funcExpr: PddlFunctionExpression): FunctionGraphNodeInfo => {
      const key = getFunctionNodeKey(funcExpr);
      const existing = functionNodeMap.get(key);
      if (existing) {
        return existing;
      }
      const { x, y } = getNumericNodePosition();
      const label = formatFunctionLabel(funcExpr);
      const nodeId = sanitizeId(`function-${action.name}-${sanitizeId(key)}-${functionNodeCounter++}`);
      registerElement(createPredicateNode(label, x, y, nodeId, FUNCTION_NODE_COLOR));
      const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      const record: FunctionGraphNodeInfo = {
        ...info,
        expr: funcExpr,
        label,
      };
      functionNodeMap.set(key, record);
      functionNodes.push(record);
      maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
      return record;
    };

    const createNumericEdge = (source: GraphNodeInfo, target: GraphNodeInfo) => {
      const edgeId = sanitizeId(`edge-${action.name}-numeric-${numericEdgeCounter++}`);
      registerElement(createArrowLine(source, target, undefined, edgeId));
    };

    const handleArgument = (
      parentNode: GraphNodeInfo,
      argument: PddlExpressionArgument | undefined,
      suffix: string
    ) => {
      if (!argument) {
        return;
      }
      if (isTypedParameterArgument(argument)) {
        const paramNode = parameterNodes.get(argument.name);
        if (paramNode) {
          createNumericEdge(paramNode, parentNode);
          return;
        }
        const label = argument.type ? `${argument.name}: ${argument.type}` : argument.name;
        const literalNode = createLiteralNode(label, `param-${argument.name}-${suffix}`);
        createNumericEdge(literalNode, parentNode);
        return;
      }
      if (isFunctionExpressionArgument(argument)) {
        const functionNode = ensureFunctionNode(argument);
        createNumericEdge(functionNode, parentNode);
        return;
      }
      if (isNumberLiteralArgument(argument)) {
        const literalNode = createLiteralNode(`${argument.value}`, `number-${suffix}`);
        createNumericEdge(literalNode, parentNode);
        return;
      }
      if (typeof argument === 'number' && Number.isFinite(argument)) {
        const literalNode = createLiteralNode(`${argument}`, `number-${suffix}`);
        createNumericEdge(literalNode, parentNode);
        return;
      }
      if (typeof argument === 'string') {
        const trimmed = argument.trim();
        if (!trimmed) {
          return;
        }
        const literalNode = createLiteralNode(trimmed, `string-${suffix}`);
        createNumericEdge(literalNode, parentNode);
        return;
      }
      if (!isPddlExpressionValue(argument)) {
        return;
      }
      const expr = argument as PddlExpression;
      let operatorLabel = expr.type === 'predicate' ? expr.name : getOperatorLabel(expr.type, expr.name);
      if (expr.type === 'predicate' && !operatorLabel) {
        operatorLabel = expr.name ?? 'predicate';
      }
      const fillColor = isNumericEffectExpression(expr) ? EFFECT_COLOR : OPERATOR_NODE_COLOR;
      const operatorNode = createOperatorNode(
        operatorLabel || expr.type,
        `operator-${expr.type}-${suffix}`,
        fillColor
      );
      createNumericEdge(operatorNode, parentNode);

      if ('arguments' in expr && Array.isArray(expr.arguments)) {
        expr.arguments.forEach((childArg, childIndex) => {
          handleArgument(operatorNode, childArg, `${suffix}-arg-${childIndex}`);
        });
      }
      if ('children' in expr && Array.isArray(expr.children)) {
        expr.children.forEach((childExpr, childIndex) => {
          handleArgument(operatorNode, childExpr, `${suffix}-child-${childIndex}`);
        });
      }
      if ('argument' in expr && expr.argument) {
        handleArgument(operatorNode, expr.argument, `${suffix}-argument`);
      }
      if ('items' in expr && Array.isArray((expr as any).items)) {
        (expr as any).items.forEach((childExpr: PddlExpression, childIndex: number) => {
          handleArgument(operatorNode, childExpr, `${suffix}-item-${childIndex}`);
        });
      }
    };

    numericEffects.forEach((numericExpr, index) => {
      const targetArgument =
        Array.isArray(numericExpr.arguments) && numericExpr.arguments.length > 0
          ? numericExpr.arguments[0]
          : undefined;
      const targetFunction =
        targetArgument && isFunctionExpressionArgument(targetArgument) ? targetArgument : null;
      const label = targetFunction
        ? `${numericExpr.type} ${formatFunctionLabel(targetFunction, { includeArguments: false })}`
        : numericExpr.type;
      const numericNode = createOperatorNode(label, `numeric-${numericExpr.type}-${index}`, EFFECT_COLOR);
      const args = Array.isArray(numericExpr.arguments) ? numericExpr.arguments : [];
      args.forEach((arg, argIndex) => {
        handleArgument(numericNode, arg, `numeric-${index}-arg-${argIndex}`);
      });
    });

    const numericRows = Math.ceil(Math.max(1, numericNodeCount) / ACTION_COLUMNS);
    lastSectionStartY = numericSectionStartY;
    lastSectionRows = Math.max(numericRows, 1);
    nextSectionY = numericSectionStartY + Math.max(1, numericRows) * NODE_SPACING_Y;
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

  functionNodes.forEach((functionNode) => {
    const args = extractExpressionArguments(functionNode.expr);
    if (args.length === 0) {
      return;
    }
    const firstParam = parameterNodes.get(args[0]);
    if (firstParam) {
      const edgeId = sanitizeId(`edge-${action.name}-${functionNode.id}-in-${edgeIndex++}`);
      registerElement(createArrowLine(firstParam, functionNode, undefined, edgeId));
    }
    for (let i = 1; i < args.length; i += 1) {
      const targetParam = parameterNodes.get(args[i]);
      if (!targetParam) {
        continue;
      }
      const edgeId = sanitizeId(`edge-${action.name}-${functionNode.id}-out-${edgeIndex++}`);
      registerElement(createArrowLine(functionNode, targetParam, undefined, edgeId));
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
  const predicateNodeInfosByCategory: Record<'init' | 'goal', Map<string, GraphNodeInfo>> = {
    init: new Map(),
    goal: new Map(),
  };
  const functionNodesByCategory: Record<'init' | 'goal', Map<string, GraphNodeInfo>> = {
    init: new Map(),
    goal: new Map(),
  };
  const comparatorNodesByCategory: Record<'init' | 'goal', Map<string, GraphNodeInfo>> = {
    init: new Map(),
    goal: new Map(),
  };
  const normalizeLiteralForKey = (value?: string | null): string =>
    value ? value.replace(/\s+/g, ' ').trim() : '';
  const functionNodes: Array<
    GraphNodeInfo & {
      expr: PddlFunctionExpression;
      label: string;
      category: 'init' | 'goal';
    }
  > = [];

  const initExpressions = Array.isArray(problem.init)
    ? problem.init
    : problem.init
    ? [problem.init]
    : [];
  const initPredicates = extractAllPredicates(initExpressions);
  const uniqueInitPredicates = getUniquePredicates(initPredicates);
  const initComparators = extractComparatorExpressions(initExpressions);
  const goalExpressions = problem.goal ? [problem.goal] : [];
  const goalPredicates = extractAllPredicates(goalExpressions);
  const uniqueGoalPredicates = getUniquePredicates(goalPredicates);
  const goalComparators = extractComparatorExpressions(goalExpressions);
  const objects = Array.isArray(problem.objects) ? problem.objects : [];
  const sectionCounts = [
    uniqueInitPredicates.length + initComparators.length,
    objects.length,
    uniqueGoalPredicates.length + goalComparators.length,
  ];
  const maxCount = Math.max(1, ...sectionCounts);
  const problemColumns = Math.min(PROBLEM_MAX_COLUMNS, maxCount);
  const problemWidth = NODE_WIDTH + NODE_SPACING_X * (problemColumns - 1);
  const descriptionHeight = NODE_HEIGHT * 8;
  const descriptionWidth = Math.min(problemWidth, NODE_WIDTH * 6);
  const sidebarGap = NODE_SPACING_X / 2;
  const contentStartX = startX + descriptionWidth + sidebarGap;

  const initDescriptionId = sanitizeId(`${groupId}-init-description`);

  let maxElementBottom = startY;
  let nextSectionY = startY;
  let lastSectionStartY = startY;
  let lastSectionRows = 1;
  let functionNodeCounter = 0;
  let valueNodeCounter = 0;
  let comparatorNodeCounter = 0;
  let comparatorEdgeCounter = 0;

  const createFunctionNodeForExpression = (
    funcExpr: PddlFunctionExpression,
    category: 'init' | 'goal',
    getPosition: () => { x: number; y: number },
    suffix: string
  ): GraphNodeInfo => {
    const label = formatFunctionLabel(funcExpr, { includeArguments: false });
    const functionKey = label;
    const categoryFunctionMap = functionNodesByCategory[category];
    let info: GraphNodeInfo;
    if (categoryFunctionMap.has(functionKey)) {
      info = categoryFunctionMap.get(functionKey)!;
    } else {
      const { x, y } = getPosition();
      const nodeId = sanitizeId(
        `function-${problem.name}-${category}-${suffix}-${functionNodeCounter++}-${funcExpr.name}`
      );
      registerElement(createPredicateNode(label, x, y, nodeId, FUNCTION_NODE_COLOR));
      info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      categoryFunctionMap.set(functionKey, info);
      maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
    }
    functionNodes.push({
      ...info,
      expr: funcExpr,
      label,
      category,
    });
    return info;
  };

  const createComparatorArgumentNode = (
    argument: PddlExpressionArgument | undefined,
    category: 'init' | 'goal',
    getNextPosition: () => { x: number; y: number },
    suffix: string
  ): { node: GraphNodeInfo | null; literalText: string | null } => {
    if (!argument) {
      return { node: null, literalText: null };
    }
    if (isFunctionExpressionArgument(argument)) {
      return {
        node: createFunctionNodeForExpression(argument, category, getNextPosition, suffix),
        literalText: null,
      };
    }
    const literalText = getNumericLiteralText(argument);
    if (literalText !== null) {
      return { node: null, literalText };
    }
    const label = stringifyExpressionArgument(argument);
    const { x, y } = getNextPosition();
    const nodeId = sanitizeId(`literal-${problem.name}-${category}-${suffix}-${valueNodeCounter++}`);
    registerElement(createPredicateNode(label, x, y, nodeId, FUNCTION_NODE_COLOR));
    const info = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
    maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
    return {
      node: info,
      literalText: null,
    };
  };

  const placeComparatorSection = (
    comparators: PddlCompositeExpression[],
    category: 'init' | 'goal',
    baseY: number
  ): number => {
    if (comparators.length === 0) {
      return baseY;
    }
    const comparatorColumns = Math.max(1, Math.min(PROBLEM_MAX_COLUMNS, problemColumns));
    let argumentNodeCounter = 0;
    const getArgumentPosition = () => {
      const index = argumentNodeCounter;
      argumentNodeCounter += 1;
      const column = index % comparatorColumns;
      const row = Math.floor(index / comparatorColumns);
      return {
        x: contentStartX + column * NODE_SPACING_X,
        y: baseY + row * NODE_SPACING_Y,
      };
    };

    type ComparatorRecord = {
      index: number;
      operatorLabel: string;
      comparatorKey: string | null;
      leftNode: GraphNodeInfo | null;
      rightNode: GraphNodeInfo | null;
    };

    const comparatorRecords: ComparatorRecord[] = [];

    comparators.forEach((expr, index) => {
      const args = Array.isArray(expr.arguments) ? expr.arguments : [];
      const leftArg = createComparatorArgumentNode(
        args[0],
        category,
        getArgumentPosition,
        `comp-left-${category}-${index}`
      );
      const rightArg = createComparatorArgumentNode(
        args[1],
        category,
        getArgumentPosition,
        `comp-right-${category}-${index}`
      );
      const comparatorSymbol = getComparatorLabel(expr.type);
      const operatorLabelSegments = [
        leftArg.literalText,
        comparatorSymbol,
        rightArg.literalText,
      ].filter((segment): segment is string => Boolean(segment && segment.trim().length > 0));
      const operatorLabel =
        operatorLabelSegments.length > 0 ? operatorLabelSegments.join(' ') : comparatorSymbol;
      const leftLiteralKey = normalizeLiteralForKey(leftArg.literalText);
      const rightLiteralKey = normalizeLiteralForKey(rightArg.literalText);
      const hasLiteralKey = leftLiteralKey.length > 0 || rightLiteralKey.length > 0;
      const comparatorKey = hasLiteralKey
        ? `${comparatorSymbol}|${leftLiteralKey}|${rightLiteralKey}`
        : null;
      comparatorRecords.push({
        index,
        operatorLabel,
        comparatorKey,
        leftNode: leftArg.node,
        rightNode: rightArg.node,
      });
    });

    const argumentRows =
      argumentNodeCounter === 0 ? 0 : Math.ceil(argumentNodeCounter / comparatorColumns);
    const argumentSectionHeight = argumentRows * NODE_SPACING_Y;
    const colorRowGap = argumentSectionHeight > 0 ? SECTION_GAP : 0;
    const operatorBaseY = baseY + argumentSectionHeight + colorRowGap;
    let operatorNodeCounter = 0;
    const getOperatorPosition = () => {
      const index = operatorNodeCounter;
      operatorNodeCounter += 1;
      const column = index % comparatorColumns;
      const row = Math.floor(index / comparatorColumns);
      return {
        x: contentStartX + column * NODE_SPACING_X,
        y: operatorBaseY + row * NODE_SPACING_Y,
      };
    };

    const categoryComparatorMap = comparatorNodesByCategory[category];

    comparatorRecords.forEach((record) => {
      let operatorInfo: GraphNodeInfo;
      if (record.comparatorKey && categoryComparatorMap.has(record.comparatorKey)) {
        operatorInfo = categoryComparatorMap.get(record.comparatorKey)!;
      } else {
        const { x, y } = getOperatorPosition();
        const operatorId = sanitizeId(
          `operator-${problem.name}-${category}-${record.index}-${comparatorNodeCounter++}`
        );
        registerElement(createPredicateNode(record.operatorLabel, x, y, operatorId, OPERATOR_NODE_COLOR));
        operatorInfo = createGraphNodeInfo(operatorId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
        if (record.comparatorKey) {
          categoryComparatorMap.set(record.comparatorKey, operatorInfo);
        }
        maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
      }

      if (record.leftNode) {
        const edgeId = sanitizeId(
          `comp-edge-${problem.name}-${category}-in-${comparatorEdgeCounter++}`
        );
        registerElement(createArrowLine(record.leftNode, operatorInfo, undefined, edgeId));
      }

      if (record.rightNode) {
        const edgeId = sanitizeId(
          `comp-edge-${problem.name}-${category}-out-${comparatorEdgeCounter++}`
        );
        registerElement(createArrowLine(operatorInfo, record.rightNode, undefined, edgeId));
      }
    });

    const operatorRows =
      operatorNodeCounter === 0 ? 0 : Math.ceil(operatorNodeCounter / comparatorColumns);
    const operatorSectionHeight = operatorRows * NODE_SPACING_Y;
    const sectionHeight = argumentSectionHeight + colorRowGap + operatorSectionHeight;
    maxElementBottom = Math.max(maxElementBottom, operatorBaseY + operatorSectionHeight);
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
    const x = contentStartX + (index % problemColumns) * NODE_SPACING_X;
    const y = baseY + Math.floor(index / problemColumns) * NODE_SPACING_Y;
    const nodeId = sanitizeId(`problem-${problem.name}-${category}-${index}-${predicate.name}`);
    const fillColor = category === 'init' ? PRECONDITION_COLOR : EFFECT_COLOR;
    const label = getPredicateLabel(extracted);
    const categoryPredicateMap = predicateNodeInfosByCategory[category];
    let nodeInfo = categoryPredicateMap.get(label);
    if (!nodeInfo) {
      nodeInfo = createGraphNodeInfo(nodeId, x, y, NODE_WIDTH, NODE_HEIGHT, 'ellipse');
      registerElement(createPredicateNode(label, x, y, nodeId, fillColor));
      categoryPredicateMap.set(label, nodeInfo);
      maxElementBottom = Math.max(maxElementBottom, y + NODE_HEIGHT);
    }
  };

  if (initComparators.length > 0) {
    nextSectionY = placeComparatorSection(initComparators, 'init', nextSectionY);
  }

  const preconditionSectionTopY = nextSectionY;
  if (uniqueInitPredicates.length > 0) {
    uniqueInitPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'init', nextSectionY);
    });
    lastSectionStartY = nextSectionY;
    const initRows = Math.ceil(uniqueInitPredicates.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, initRows);
    nextSectionY += initRows * NODE_SPACING_Y + SECTION_GAP;
  }

  const objectStartY = nextSectionY;
  const objectSectionTopY = nextSectionY;
  let objectRows = 0;
  if (objects.length > 0) {
    objects.forEach((object, index) => {
      const width = PARAMETER_NODE_WIDTH;
      const height = PARAMETER_NODE_HEIGHT;
      const x = contentStartX + (index % problemColumns) * NODE_SPACING_X;
      const y = objectStartY + Math.floor(index / problemColumns) * NODE_SPACING_Y;
      const nodeId = sanitizeId(`object-${problem.name}-${object.name}`);
      const label = object.type ? `${object.name}: ${object.type}` : object.name;

      registerElement(createGeometryNode(label, x, y, nodeId, width, height));
      objectNodes.set(object.name, createGraphNodeInfo(nodeId, x, y, width, height));
      maxElementBottom = Math.max(maxElementBottom, y + height);
    });
    lastSectionStartY = objectStartY;
    objectRows = Math.ceil(objects.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, objectRows);
    nextSectionY += objectRows * NODE_SPACING_Y + SECTION_GAP;
  }
  const objectSectionBottomY =
    objectRows > 0 ? objectSectionTopY + objectRows * NODE_SPACING_Y : objectSectionTopY;
  const goalDescriptionId = sanitizeId(`${groupId}-goal-description`);

  const goalStartY = nextSectionY;
  if (uniqueGoalPredicates.length > 0) {
    uniqueGoalPredicates.forEach((predicate, index) => {
      placePredicateNode(predicate, index, 'goal', goalStartY);
    });
    lastSectionStartY = goalStartY;
    const goalRows = Math.ceil(uniqueGoalPredicates.length / problemColumns);
    lastSectionRows = Math.max(lastSectionRows, goalRows);
    nextSectionY += goalRows * NODE_SPACING_Y + SECTION_GAP;
  }

  nextSectionY = placeComparatorSection(goalComparators, 'goal', nextSectionY);

  const sidebarX = startX;
  const initDescriptionY = 150 ;
  const minGoalDescriptionY = objectSectionBottomY + SECTION_GAP;
  let goalDescriptionY = objectSectionBottomY - descriptionHeight;
  if (goalDescriptionY < minGoalDescriptionY) {
    goalDescriptionY = minGoalDescriptionY;
  }
  registerElement(
    createDescriptionNode(
      initDescriptionText,
      sidebarX,
      initDescriptionY,
      initDescriptionId,
      descriptionWidth,
      descriptionHeight ,
      'problem-init'
    )
  );
  maxElementBottom = Math.max(maxElementBottom, initDescriptionY + descriptionHeight);
  registerElement(
    createDescriptionNode(
      goalDescriptionText,
      sidebarX,
      goalDescriptionY,
      goalDescriptionId,
      descriptionWidth,
      descriptionHeight / 2,
      'problem-goal'
    )
  );
  maxElementBottom = Math.max(maxElementBottom, goalDescriptionY + descriptionHeight);

  const assignPredicateNodesForEdges = (
    predicates: ExtractedPredicate[],
    category: 'init' | 'goal'
  ) => {
    const categoryPredicateMap = predicateNodeInfosByCategory[category];
    predicates.forEach((predicate) => {
      const label = getPredicateLabel(predicate);
      const nodeInfo = categoryPredicateMap.get(label);
      if (!nodeInfo) {
        return;
      }
      predicateNodes.push({
        ...nodeInfo,
        expr: predicate.expr,
        label,
        category,
      });
    });
  };

  assignPredicateNodesForEdges(initPredicates, 'init');
  assignPredicateNodesForEdges(goalPredicates, 'goal');

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

  const width = descriptionWidth + sidebarGap + problemWidth;
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
