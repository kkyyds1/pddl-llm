export type PddlParseResponse<T> = PddlParseSuccess<T> | PddlParseFailure;
export interface PddlParseSuccess<T> {
  success: true;
  content: T;
}
export interface PddlParseFailure {
  success: false;
  error: string;
  details?: Record<string, unknown>;
}
export interface PddlDomain {
  name: string;
  requirements: string[];
  types: PddlTypeDeclaration[];
  predicates: PddlPredicate[];
  functions: PddlFunction[];
  actions: PddlAction[];
}
export interface PddlTypeDeclaration {
  name: string;
  parent: string | null;
}
export interface PddlPredicate {
  name: string;
  arguments: PddlTypedParameter[];
}
export interface PddlFunction {
  type: 'function';
  name: string;
  arguments: PddlTypedParameter[];
  return_type: string | null;
}
export interface PddlAction {
  name: string;
  description?: string | null;
  actionDescription?: string | null;
  parameters: PddlTypedParameter[];
  preconditions: PddlExpression[];
  effects: PddlExpression[];
}
export interface PddlTypedParameter {
  name: string;
  type: string | null;
}
export type PddlExpression =
  | PddlPredicateExpression
  | PddlFunctionExpression
  | PddlNotExpression
  | PddlNumericExpression
  | PddlNumberLiteral
  | PddlCompositeExpression;
export interface PddlPredicateExpression {
  type: 'predicate';
  name: string;
  arguments: PddlExpressionArgument[];
}
export interface PddlFunctionExpression {
  type: 'function';
  name: string;
  arguments: PddlExpressionArgument[];
}
export interface PddlNotExpression {
  type: 'not';
  argument: PddlExpression;
}
export interface PddlNumericExpression {
  type: 'increase' | 'decrease' | 'assign' | 'scale-up' | 'scale-down';
  arguments: PddlExpressionArgument[];
}
export interface PddlNumberLiteral {
  type: 'number';
  value: number;
}
export interface PddlCompositeExpression {
  type: string;
  name?: string;
  arguments?: PddlExpressionArgument[];
  argument?: PddlExpression;
  children?: PddlExpression[];
  value?: string | number | boolean | null;
}
export type PddlExpressionArgument =
  | PddlExpression
  | PddlTypedParameter
  | PddlNumberLiteral;
export interface PddlProblem {
  name: string;
  domain?: string;
  domain_name?: string | null;
  requirements?: string[];
  objects: PddlObject[];
  init: PddlExpression[];
  goal: PddlExpression | null;
  initDescription?: string | null;
  goalDescription?: string | null;
  metrics?: PddlMetric | null;
}
export interface PddlObject {
  name: string;
  type: string | null;
}
export interface PddlMetricExpression {
  type: string;
  arguments?: PddlExpressionArgument[];
}
