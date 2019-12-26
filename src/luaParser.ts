import {LuaLexer, LuaSyntaxError, LuaToken, LuaTokenType, errorStrings} from "./luaLexer";

export class ParseNodeLocation {
  constructor(startToken?: LuaToken) {
    if (startToken) {
      this.start(startToken);
    }
  }
  start(startToken: LuaToken) {
    this.startLine = startToken.startLine;
    this.startCol = startToken.startCol;
    this.rangeStart = startToken.rangeStart;

    this.endLine = -1;
    this.endCol = -1;
    this.rangeEnd = -1;
  }
  finish(endToken: LuaToken|undefined) {
    if (endToken) {
      this.endLine = endToken.endLine;
      this.endCol = endToken.endCol;
      this.rangeEnd = endToken.rangeEnd;
    } else {
      this.endLine = this.startLine;
      this.endCol = this.startCol;
    }
  }
  isValid() {
    return this.rangeStart > -1 && this.rangeEnd > -1;
  }
  containsPos(pos: number) {
    return pos >= this.rangeStart && pos <= this.rangeEnd;
  }
  clone(): ParseNodeLocation {
    let loc = new ParseNodeLocation();
    loc.startLine = this.startLine;
    loc.startCol = this.startCol;
    loc.endLine = this.endLine;
    loc.endCol = this.endCol;
    loc.rangeStart = this.rangeStart;
    loc.rangeEnd = this.rangeEnd;
    return loc;
  }
  startLine: number = -1;
  startCol: number = -1;
  endLine: number = -1;
  endCol: number = -1;
  rangeStart: number = -1;
  rangeEnd: number = -1;
}

const invalidParseNodeLoc = new ParseNodeLocation();


// Describes parse node visitor result
export enum ParseNodeVisitResult {
  SkipNode,
  Continue,
  Stop,
}

type ParseNodeVisitorFunc =  (parseNode: ParseNode) => ParseNodeVisitResult;

export interface ParseNode {
  readonly type: string;
  loc: ParseNodeLocation;
  
  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult;
}

// Visits parse node and its children. Visitor function and this function return whether visiting should continue, stop or skip node.
export function visitParseNodeAndChildren(node: ParseNode, parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
  let result = parseNodeVisitor(node);
  if (result === ParseNodeVisitResult.SkipNode) {
    return ParseNodeVisitResult.Continue;
  } else if (result === ParseNodeVisitResult.Stop) {
    return ParseNodeVisitResult.Stop;
  }
  return node.visitChildren(parseNodeVisitor);
}

// Visits all nodes. Visitor function and this function return whether visiting should continue, stop or skip node.
export function visitParseNodes(nodes: Array<ParseNode>, parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
  for (let node of nodes) {
    visitParseNodeAndChildren(node, parseNodeVisitor);
  }
  return ParseNodeVisitResult.Continue;
}

export interface Statement extends ParseNode {
}

export class BreakStatement implements Statement {
  constructor() {
    this.type = 'BreakStatement';
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class ReturnStatement implements Statement {
  constructor(args: Array<ParseNode>) {
    this.type = 'ReturnStatement';
    this.args = args;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  args: Array<ParseNode>;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodes(this.args, parseNodeVisitor);
  }
}

export interface IfStatementClause extends ParseNode {
}

export class IfStatement implements Statement {
  constructor(clauses: Array<IfStatementClause>) {
    this.type = 'IfStatement';
    this.clauses = clauses;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  clauses: Array<IfStatementClause>;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodes(this.clauses, parseNodeVisitor);
  }
}

export class Block implements ParseNode {
  constructor(statements: Array<Statement>, scopeIdentifierInfos: Array<ScopedIdentifierInfo>) {
    this.statements = statements;
    this.scopeIdentifierInfos = scopeIdentifierInfos;
  }
  type = "Block";
  loc: ParseNodeLocation = invalidParseNodeLoc;
  statements: Array<Statement>;
  visibleLocals: Array<String>|undefined;
  scopeIdentifierInfos: Array<ScopedIdentifierInfo>;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodes(this.statements, parseNodeVisitor);
  }
}

export class IfClause implements IfStatementClause {
  constructor(condition: ParseNode, body: Block) {
    this.type = 'IfClause';
    this.condition = condition;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  condition: ParseNode;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.condition, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class ElseifClause implements IfStatementClause {
  constructor(condition: ParseNode, body: Block) {
    this.type = 'ElseifClause';
    this.condition = condition;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  condition: ParseNode;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.condition, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class ElseClause implements IfStatementClause {
  constructor(body: Block) {
    this.type = 'ElseClause';
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class WhileStatement implements Statement {
  constructor(condition: ParseNode, body: Block) {
    this.type = 'WhileStatement';
    this.condition = condition;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  condition: ParseNode;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.condition, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class DoStatement implements Statement {
  constructor(body: Block) {
    this.type = 'DoStatement';
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class RepeatStatement implements Statement {
  constructor(condition: ParseNode, body: Block) {
    this.type = 'RepeatStatement';
    this.condition = condition;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  condition: ParseNode;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.condition, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class LocalStatement implements Statement {
  constructor(variables: Array<ParseNode>, init?: Array<Expression>) {
    this.type = 'LocalStatement';
    this.variables = variables;
    this.init = init;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  variables: Array<ParseNode>;
  init: Array<Expression>|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodes(this.variables, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (this.init) {
      return visitParseNodes(this.init, parseNodeVisitor);
    } else {
      return ParseNodeVisitResult.Continue;
    }
  }
}

export class AssignmentStatement implements Statement {
  constructor(variables: Array<Expression>, init: Array<Expression>) {
    this.type = 'AssignmentStatement';
    this.variables = variables;
    this.init = init;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  variables: Array<Expression>;
  init: Array<Expression>;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodes(this.variables, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (this.init) {
      return visitParseNodes(this.init, parseNodeVisitor);
    } else {
      return ParseNodeVisitResult.Continue;
    }
  }
}

export class CallStatement implements Statement {
  constructor(expression: Expression) {
    this.type = 'CallStatement';
    this.expression = expression;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  expression: Expression;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.expression, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return this.expression.visitChildren(parseNodeVisitor);
  }
}

export interface Expression extends ParseNode {
  inParens: boolean|undefined;
}

export class FunctionDeclaration implements Statement, Expression {
  constructor(identifier: ParseNode|undefined, isLocal: boolean, parameters: Array<Identifier|VarargLiteral>, body: Block) {
    this.type = 'FunctionDeclaration';
    this.identifier = identifier;
    this.isLocal = isLocal;
    this.parameters = parameters;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  identifier: ParseNode|undefined;
  isLocal: boolean;
  parameters: Array<Identifier|VarargLiteral>;
  body: Block;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (this.identifier && visitParseNodeAndChildren(this.identifier, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (visitParseNodes(this.parameters, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class ForNumericStatement implements Statement {
  constructor(variable: Identifier, start: ParseNode, end: ParseNode, step: ParseNode|undefined, body: Block) {
    this.type = 'ForNumericStatement';
    this.variable = variable;
    this.start = start;
    this.end = end;
    this.step = step;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  variable: Identifier;
  start: ParseNode;
  end: ParseNode;
  step: ParseNode|undefined;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.variable, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (visitParseNodeAndChildren(this.start, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (visitParseNodeAndChildren(this.end, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (this.step && visitParseNodeAndChildren(this.step, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class ForGenericStatement implements Statement {
  constructor(variables: Array<Identifier>, iterators: Array<Expression>, body: Block) {
    this.type = 'ForGenericStatement';
    this.variables = variables;
    this.iterators = iterators;
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  variables: Array<Identifier>;
  iterators: Array<Expression>;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodes(this.variables, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    if (visitParseNodes(this.iterators, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class Chunk implements ParseNode {
  constructor(body: Block) {
    this.type = 'Chunk';
    this.body = body;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  body: Block;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.body, parseNodeVisitor);
  }
}

export class Identifier implements Expression {
  constructor(name: string) {
    this.type = 'Identifier';
    this.name = name;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  name: string;
  isLocal: boolean|undefined;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export interface Literal extends Expression {
  rawValue: string;
}

export class StringLiteral implements Literal {
  constructor(value: string, rawValue: string) {
    this.type = 'StringLiteral';
    this.value = value;
    this.rawValue = rawValue;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  value: string;
  rawValue: string;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class NumericLiteral implements Literal {
  constructor(value: number, rawValue: string) {
    this.type = 'NumericLiteral';
    this.value = value;
    this.rawValue = rawValue;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  value: number;
  rawValue: string;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class BooleanLiteral implements Literal {
  constructor(value: boolean, rawValue: string) {
    this.type = 'BooleanLiteral';
    this.value = value;
    this.rawValue = rawValue;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  value: boolean;
  rawValue: string;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class NilLiteral implements Literal {
  constructor() {
    this.type = 'NilLiteral';
    this.rawValue = 'nil';
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  rawValue: string;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class VarargLiteral implements Literal {
  constructor() {
    this.type = 'VarargLiteral';
    this.rawValue = '...';
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  rawValue: string;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult { return ParseNodeVisitResult.Continue;}
}

export class TableKey implements ParseNode {
  constructor(key: ParseNode, value: ParseNode) {
    this.type = 'TableKey';
    this.key = key;
    this.value = value;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  key: ParseNode;
  value: ParseNode;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.key, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.value, parseNodeVisitor);
  }
}

export class TableKeyString implements ParseNode {
  constructor(key: string, value: Expression) {
    this.type = 'TableKeyString';
    this.key = key;
    this.value = value;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  key: string;
  value: Expression;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.value, parseNodeVisitor);
  }
}

export class TableValue implements ParseNode {
  constructor(value: Expression) {
    this.type = 'TableValue';
    this.value = value;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  value: Expression;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.value, parseNodeVisitor);
  }
}

export class TableConstructorExpression implements Expression {
  constructor(fields: Array<ParseNode>) {
    this.type = 'TableConstructorExpression';
    this.fields = fields;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  fields: Array<ParseNode>;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodes(this.fields, parseNodeVisitor);
  }
}

export class LogicalExpression implements Expression {
  constructor(operator: string, left: ParseNode, right: ParseNode) {
    this.type = 'LogicalExpression';
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  operator: string;
  left: ParseNode;
  right: ParseNode;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.left, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.right, parseNodeVisitor);
  }
}

export class BinaryExpression implements Expression {
  constructor(operator: string, left: ParseNode, right: ParseNode) {
    this.type = 'BinaryExpression';
    this.operator = operator;
    this.left = left;
    this.right = right;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  operator: string;
  left: ParseNode;
  right: ParseNode;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.left, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.right, parseNodeVisitor);
  }
}

export class UnaryExpression implements Expression {
  constructor(operator: string, argument: ParseNode) {
    this.type = 'UnaryExpression';
    this.operator = operator;
    this.argument = argument;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  operator: string;
  argument: ParseNode;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    return visitParseNodeAndChildren(this.argument, parseNodeVisitor);
  }
}

export class MemberExpression implements Expression {
  constructor(base: ParseNode|undefined, indexer: string, identifier: Identifier) {
    this.type = 'MemberExpression';
    this.indexer = indexer;
    this.identifier = identifier;
    this.base = base;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  base: ParseNode|undefined;
  indexer: string;
  identifier: Identifier;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (this.base && visitParseNodeAndChildren(this.base, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.identifier, parseNodeVisitor);
  }
}

export class IndexExpression implements Expression {
  constructor(base: ParseNode|undefined, index: ParseNode) {
    this.type = 'IndexExpression';
    this.base = base;
    this.index = index;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  base: ParseNode|undefined;
  index: ParseNode;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (this.base && visitParseNodeAndChildren(this.base, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.index, parseNodeVisitor);
  }
}

export class CallExpression implements Expression {
  constructor(base: ParseNode, args: Array<ParseNode>) {
    this.type = 'CallExpression';
    this.base = base;
    this.args = args;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  base: ParseNode;
  args: Array<ParseNode>;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.base, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodes(this.args, parseNodeVisitor);
  }
}

export class TableCallExpression implements Expression {
  constructor(base: ParseNode, table: TableConstructorExpression) {
    this.type = 'TableCallExpression';
    this.base = base;
    this.table = table;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  base: ParseNode;
  table: TableConstructorExpression;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.base, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.table, parseNodeVisitor);
  }
}

export class StringCallExpression implements Expression {
  constructor(base: ParseNode, literal: StringLiteral) {
    this.type = 'StringCallExpression';
    this.base = base;
    this.literal = literal;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  base: ParseNode;
  literal: StringLiteral;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {
    if (visitParseNodeAndChildren(this.base, parseNodeVisitor) === ParseNodeVisitResult.Stop) {
      return ParseNodeVisitResult.Stop;
    }
    return visitParseNodeAndChildren(this.literal, parseNodeVisitor);
  }
}

export class Comment implements ParseNode {
  constructor(value: string, rawValue: string) {
    this.type = 'Comment';
    this.value = value;
    this.rawValue = rawValue;
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  value: string;
  rawValue: string;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {return ParseNodeVisitResult.Continue;}
}

// Created when there's a problem reading a parse node, can stand in for any node.
export class ErroneousNode implements Statement, Expression, IfStatementClause {
  constructor() {
    this.type = "ErroneousNode";
  }
  type: string;
  loc: ParseNodeLocation = invalidParseNodeLoc;
  inParens: boolean|undefined;

  // Visits all child nodes of this parse node. Visitor function and this function return whether visiting should continue, stop or skip node.
  visitChildren(parseNodeVisitor: ParseNodeVisitorFunc): ParseNodeVisitResult {return ParseNodeVisitResult.Continue;}
}


export class ScopedIdentifierInfo {
  constructor(name: string) {
    this.name = name;
  }
  name: string;
  identifier?: Identifier;
  // Node at which identifier is initialized
  initializeParseNode?: ParseNode;
  description?: string;
  type?: string;
  typeHinted?: boolean;
}

export interface LuaParseResults {
  readonly tokens: Array<LuaToken>;
  readonly globals: Array<Identifier>;
  readonly parsedChunk?: Chunk;
  readonly errors: Array<LuaSyntaxError>;
}

type OnCreateNodeCallback = (node: ParseNode) => void;

export function parseLuaSource(inputSource: string, onCreateNodeCallback?: OnCreateNodeCallback) : LuaParseResults {
  // all tokens - including erroneous and comments
  let allTokens = new Array<LuaToken>();
  // tokens considered for parsing
  let tokens = new Array<LuaToken>();
  let lexer = LuaLexer(inputSource);

  // first find all tokens (as we return them anyway, even in case of errors)
  while (true) {
    let token = lexer.getNextToken();
    allTokens.push(token);
    if (token.type !== LuaTokenType.Unexpected && token.type !== LuaTokenType.Comment) {
      tokens.push(token);
      if (token.type === LuaTokenType.EOF) {
        break;
      }
    }
  }
  let iToken = 0;
  let token = tokens[iToken];

  function moveToNextToken() {
    iToken = Math.min(iToken + 1, tokens.length - 1);
    token = tokens[iToken];
  }

  function isTokenInRange(iToken: number) {
    return iToken >= 0 && iToken < tokens.length;
  }

  function raiseUnexpected(iFoundToken: number, near?: string) {
    if (!near) {
      if (isTokenInRange(iFoundToken + 1)) {
        near = tokens[iFoundToken + 1].rawValue;
      }
    }
    let foundToken = tokens[iFoundToken];
    let type;
    switch (foundToken.type) {
      case LuaTokenType.StringLiteral: type = 'string'; break;
      case LuaTokenType.Keyword: type = 'keyword'; break;
      case LuaTokenType.Identifier: type = 'identifier'; break;
      case LuaTokenType.NumericLiteral: type = 'number'; break;
      case LuaTokenType.Punctuator: type = 'symbol'; break;
      case LuaTokenType.BooleanLiteral: type = 'boolean'; break;
      case LuaTokenType.NilLiteral:
        return lexer.raiseError(foundToken, errorStrings.unexpected, 'symbol', 'nil', near);
      default:
        type = 'unknown';
    }
    return lexer.raiseError(foundToken, errorStrings.unexpected, type, foundToken.rawValue, near);
  }

  function raiseUnexpectedToken(type: string, token: LuaToken) {
    lexer.raiseError(token, errorStrings.expectedToken, type, token.value);
  }

  // Consumes the token if type and value match. Returns whether matched.
  function consume(tokenType: LuaTokenType, rawValue: string) {
    if (token.type === tokenType && token.rawValue === rawValue) {
      moveToNextToken();
      return true;
    }
    return false;
  }
  function consumePunctuator(rawValue: string) {
    return consume(LuaTokenType.Punctuator, rawValue);
  }
  function consumeKeyword(rawValue: string) {
    return consume(LuaTokenType.Keyword, rawValue);
  }

  function expect(tokenType: LuaTokenType, rawValue: string) {
    if (!consume(tokenType, rawValue)) {
      lexer.raiseError(token, errorStrings.expected, rawValue, token.rawValue);
      return false;
    } else {
      return true;
    }
  }
  function expectPunctuator(rawValue: string) {
    return expect(LuaTokenType.Punctuator, rawValue);
  }
  function expectKeyword(rawValue: string) {
    return expect(LuaTokenType.Keyword, rawValue);
  }


  //     tableconstructor ::= '{' [fieldlist] '}'
  //     fieldlist ::= field {fieldsep field} fieldsep
  //     field ::= '[' exp ']' '=' exp | Name = 'exp' | exp
  //
  //     fieldsep ::= ',' | ';'
  function parseTableConstructor() : TableConstructorExpression {
    var fields = [];
    while (true) {
      markLocation();
      if (consumePunctuator('[')) {
        let key = parseExpectedExpression();
        if (key) {
          if (expectPunctuator(']') && expectPunctuator('=')) {
            let value = parseExpectedExpression();
            if (value) {
              fields.push(finishNode(new TableKey(key, value)));
            }
          }
        }
      } else if (token.type === LuaTokenType.Identifier) {
        let lookahead = tokens[iToken + 1];
        if (lookahead.type === LuaTokenType.Punctuator && lookahead.rawValue === '=') {
          let key = parseIdentifier();
          moveToNextToken();
          let value = parseExpectedExpression();
          if (value) {
            fields.push(finishNode(new TableKeyString(key.name, value)));
          }
        } else {
          let value = parseExpectedExpression();
          if (value) {
            fields.push(finishNode(new TableValue(value)));
          }
        }
      } else {
        let value = parseExpression();
        if (!value) {
          popLocation();
          break;
        }
        fields.push(finishNode(new TableValue(value)));
      }
      if (consumePunctuator(',') || consumePunctuator(';')) {
        continue;
      }
      break;
    }
    expectPunctuator('}');
    return finishNode(new TableConstructorExpression(fields));
  }

  //     args ::= '(' [explist] ')' | tableconstructor | String
  function parseCallExpression(base: ParseNode) {
    if (token.type  === LuaTokenType.Punctuator) {
      switch (token.value) {
        case '(':
          function createErroneousLocationMarker() {
            let erroneousMarker = createLocationMarker();
            erroneousMarker.rangeStart++;
            erroneousMarker.startCol++;
            return erroneousMarker;
          }
          function finishErroneousLocationMarker(erroneousMarker: ParseNodeLocation) {
            // finishing right before the token that follows
            erroneousMarker.rangeEnd = token.rangeStart;
            erroneousMarker.endCol = token.startCol;
            erroneousMarker.endLine = token.startLine;
            return erroneousMarker;
          }
          
          let erroneousMarker = createErroneousLocationMarker();
          
          moveToNextToken();

          // List of expressions
          var expressions = [];
          var expression = parseExpression();
          if (expression) {
            if (expression instanceof ErroneousNode) {
              expression.loc = finishErroneousLocationMarker(erroneousMarker);
            }
            expressions.push(expression);
          }
          erroneousMarker = createErroneousLocationMarker();
          while (consumePunctuator(',')) {
            expression = parseExpectedExpression();
            if (expression) {
              if (expression instanceof ErroneousNode) {
                expression.loc = finishErroneousLocationMarker(erroneousMarker);
              }
              expressions.push(expression);
            }
            erroneousMarker = createErroneousLocationMarker();
          }

          expectPunctuator(')');
          return finishNode(new CallExpression(base, expressions));

        case '{':
          markLocation();
          moveToNextToken();
          var table = parseTableConstructor();
          if (table) {
            return finishNode(new TableCallExpression(base, table));
          } else {
            return undefined;
          }
      }
    } else if (token.type === LuaTokenType.StringLiteral) {
      let stringLiteral = parsePrimaryExpression() as StringLiteral;
      return finishNode(new StringCallExpression(base, stringLiteral));
    }
    raiseUnexpectedToken('function arguments', token);
  }

  //     primary ::= String | Numeric | nil | true | false
  //          | functiondef | tableconstructor | '...'
  function parsePrimaryExpression() {
    let marker = createLocationMarker();
    let type = token.type;
    let value = token.value;
    let rawValue = token.rawValue;

    let finishLiteral = (creationFunc: () => Literal) => {
      pushLocation(marker);
      moveToNextToken();
      return finishNode(creationFunc());
    };

    if (type === LuaTokenType.StringLiteral) {
      return finishLiteral(() => new StringLiteral(value as string, rawValue));
    } else if (type === LuaTokenType.NumericLiteral) {
      return finishLiteral(() => new NumericLiteral(value as number, rawValue));
    } else if (type === LuaTokenType.BooleanLiteral) {
      return finishLiteral(() => new BooleanLiteral((value as string) === 'true', rawValue));
    } else if (type === LuaTokenType.NilLiteral) {
      return finishLiteral(() => new NilLiteral());
    } else if (type === LuaTokenType.VarargLiteral) {
      return finishLiteral(() => new VarargLiteral());
    } else if (type === LuaTokenType.Keyword && rawValue === 'function') {
      pushLocation(marker);
      moveToNextToken();
      createScope();
      return parseFunctionDeclaration(undefined);
    } else if (consumePunctuator('{')) {
      pushLocation(marker);
      return parseTableConstructor();
    }
  }

  // Parse the functions parameters and body block. The name should already
  // have been parsed and passed to this declaration function. By separating
  // this we allow for anonymous functions in expressions.
  //
  // For local functions there's a boolean parameter which needs to be set
  // when parsing the declaration.
  //
  //     funcdecl ::= '(' [parlist] ')' block 'end'
  //     parlist ::= Name {',' Name} | [',' '...'] | '...'
  function parseFunctionDeclaration(name?: ParseNode, isLocal?: boolean) {
    let parameters = new Array<Identifier|VarargLiteral>();
    if (!expectPunctuator('(')) {
      return undefined;
    }

    let scopedParameterInfos = [];

    // The declaration has arguments
    if (!consumePunctuator(')')) {
      // Arguments are a comma separated list of identifiers, optionally ending
      // with a vararg.
      while (true) {
        if (token.type === LuaTokenType.Identifier) {
          var parameter = parseIdentifier();
          // Function parameters are local.
          scopedParameterInfos.push(scopeIdentifier(parameter));
          parameters.push(parameter);
          if (consumePunctuator(',')) {
            continue;
          } else if (consumePunctuator(')')) {
            break;
          }
          raiseUnexpectedToken("',' or ')' expected", token);
        } else if (token.type === LuaTokenType.VarargLiteral) {
          parameters.push(parsePrimaryExpression() as VarargLiteral);
          // No arguments are allowed after a vararg.
          if (expectPunctuator(')')) {
            break;
          }
        } else {
          raiseUnexpectedToken('<name> or \'...\'', token);
          break;
        }
      }
    }
    var body = parseBlock();
    if (expectKeyword('end')) {
      destroyScope();
    }
    let funcDeclaration = new FunctionDeclaration(name, isLocal || false, parameters, body);
    // set up scoped identifier infos for the parameters
    if (scopedParameterInfos.length) {
      for (let scopedParameterInfo of scopedParameterInfos) {
        scopedParameterInfo.initializeParseNode = funcDeclaration;
      }
    }
    return finishNode(funcDeclaration);
  }

  // Parse the function name as identifiers and member expressions.
  //
  //     Name {'.' Name} [':' Name]
  function parseFunctionName() {
    let marker = createLocationMarker();
    let baseIdentifier = parseIdentifier();
    let base: ParseNode = baseIdentifier;

    attachScope(baseIdentifier, scopeHasName(baseIdentifier.name));
    createScope();

    while (consumePunctuator('.')) {
      pushLocation(marker);
      let name = parseIdentifier();
      base = finishNode(new MemberExpression(base, '.', name));
    }

    if (consumePunctuator(':')) {
      pushLocation(marker);
      let name = parseIdentifier();
      base = finishNode(new MemberExpression(base, ':', name));
      scopeIdentifierName('self').identifier = name;
    }
    return base;
  }

  // Implement an operator-precedence parser to handle binary operator
  // precedence.
  //
  // We use this algorithm because it's compact, it's fast and Lua core uses
  // the same so we can be sure our expressions are parsed in the same manner
  // without excessive amounts of tests.
  //
  //     exp ::= (unop exp | primary | prefixexp ) { binop exp }
  function parseSubExpression(minPrecedence: number) : FunctionDeclaration | Identifier | Literal | Expression | TableConstructorExpression | MemberExpression | IndexExpression | CallExpression | TableCallExpression | StringCallExpression | undefined
  {
    let operator = token.rawValue;
    // The left-hand side in binary operations.
    let expression;

    let marker = createLocationMarker();

    // UnaryExpression
    if (isUnaryOperator(token)) {
      markLocation();
      moveToNextToken();
      let argument = parseSubExpression(10);
      if (!argument) {
        raiseUnexpectedToken('<expression>', token);
        return undefined;
      } else {
        expression = finishNode(new UnaryExpression(operator, argument));
      }
    }
    if (!expression) {
      // PrimaryExpression
      expression = parsePrimaryExpression();

      // PrefixExpression
      if (!expression) {
        expression = parsePrefixExpression();
      }
    }
    // This is not a valid left hand expression.
    if (!expression) {
      return undefined;
    }

    let precedence;
    while (true) {
      let operator = token.rawValue;
      precedence = (token.type  === LuaTokenType.Punctuator || token.type === LuaTokenType.Keyword) ?
        binaryPrecedence(operator) : 0;

      if (precedence === 0 || precedence <= minPrecedence) {
        break;
      }
      // Right-hand precedence operators
      if ('^' === operator || '..' === operator) {
        precedence--;
      }
      moveToNextToken();
      let right = parseSubExpression(precedence);
      if (!right) {
        raiseUnexpectedToken('<expression>', token);
      } else {
        // Push in the marker created before the loop to wrap its entirety.
        pushLocation(marker);
        expression = finishNode(new BinaryExpression(operator, expression, right));
      }
    }
    return expression;
  }

  //     prefixexp ::= prefix {suffix}
  //     prefix ::= Name | '(' exp ')'
  //     suffix ::= '[' exp ']' | '.' Name | ':' Name args | args
  //
  //     args ::= '(' [explist] ')' | tableconstructor | String
  function parsePrefixExpression() {
    let marker = createLocationMarker();
    let base;

    // The prefix
    if (token.type === LuaTokenType.Identifier) {
      let name = token.rawValue;
      base = parseIdentifier();
      // Set the parent scope.
      attachScope(base, scopeHasName(name));
    } else if (consumePunctuator('(')) {
      base = parseExpectedExpression();
      expectPunctuator(')');
      if (base !== undefined) {
        base.inParens = true; // XXX: quick and dirty. needed for validateVar
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }

    // The suffix
    var expression, identifier;
    while (true) {
      if (token.type === LuaTokenType.Punctuator) {
        switch (token.rawValue) {
          case '[':
            pushLocation(marker);
            moveToNextToken();
            let expression = parseExpectedExpression();
            if (expression) {
              base = finishNode(new IndexExpression(base, expression));
            }
            expectPunctuator(']');
            break;
          case '.':
            pushLocation(marker);
            moveToNextToken();
            identifier = parseIdentifier();
            base = finishNode(new MemberExpression(base, '.', identifier));
            break;
          case ':':
            pushLocation(marker);
            moveToNextToken();
            identifier = parseIdentifier();
            base = finishNode(new MemberExpression(base, ':', identifier));
            // Once a : is found, this has to be a CallExpression, otherwise
            // throw an error.
            pushLocation(marker);
            base = parseCallExpression(base);
            break;
          case '(': case '{': // args
            pushLocation(marker);
            if (base) {
              base = parseCallExpression(base);
            }
            break;
          default:
            return base;
        }
      } else if (token.type === LuaTokenType.StringLiteral) {
        pushLocation(marker);
        if (base) {
          base = parseCallExpression(base);
        }
      } else {
        break;
      }
    }
    return base;
  }

  // Expression parser
  // -----------------
  //
  // Expressions are evaluated and always return a value. If nothing is
  // matched null will be returned.
  //
  //     exp ::= (unop exp | primary | prefixexp ) { binop exp }
  //
  //     primary ::= nil | false | true | Number | String | '...'
  //          | functiondef | tableconstructor
  //
  //     prefixexp ::= (Name | '(' exp ')' ) { '[' exp ']'
  //          | '.' Name | ':' Name args | args }
  //
  function parseExpression() {
    var expression = parseSubExpression(0);
    return expression;
  }

  // Identifier ::= Name
  function parseIdentifier(): Identifier {
    markLocation();
    let identifier = token.rawValue;
    if (token.type !== LuaTokenType.Identifier) {
      raiseUnexpectedToken('<name>', token);
    }
    moveToNextToken();
    return finishNode(new Identifier(identifier));
  }

  // Parse an expression expecting it to be valid.
  function parseExpectedExpression(): Expression {
    let expression = parseExpression();
    if (!expression) {
      raiseUnexpectedToken('<expression>', token);
      return new ErroneousNode();
    } else {
      return expression;
    }
  }

  // There are two types of for statements, generic and numeric.
  //
  //     for ::= Name '=' exp ',' exp [',' exp] 'do' block 'end'
  //     for ::= namelist 'in' explist 'do' block 'end'
  //     namelist ::= Name {',' Name}
  //     explist ::= exp {',' exp}
  function parseForStatement() {
    let variable = parseIdentifier();
    // The start-identifier is local.
    createScope();
    let scopedForVariableInfo = scopeIdentifier(variable);

    // If the first expression is followed by a `=` punctuator, this is a
    // Numeric For Statement.
    if (consumePunctuator('=')) {
      // Start expression
      let start = parseExpectedExpression();
      expectPunctuator(',');
      // End expression
      let end = parseExpectedExpression();
      // Optional step expression
      let step = consumePunctuator(',') ? parseExpectedExpression() : undefined;

      expectKeyword('do');
      let body = parseBlock();
      expectKeyword('end');
      destroyScope();

      let forStatement = new ForNumericStatement(variable, start, end, step, body);
      scopedForVariableInfo.initializeParseNode = forStatement;
      return finishNode(forStatement);
    }
    // If not, it's a Generic For Statement
    else {
      // The namelist can contain one or more identifiers.
      let variables = [variable];
      let scopedVarInfos = [];
      while (consumePunctuator(',')) {
        variable = parseIdentifier();
        // Each variable in the namelist is locally scoped.
        scopedVarInfos.push(scopeIdentifier(variable));
        variables.push(variable);
      }
      expectKeyword('in');
      var iterators = [];

      // One or more expressions in the explist.
      do {
        var expression = parseExpectedExpression();
        iterators.push(expression);
      } while (consumePunctuator(','));

      expectKeyword('do');
      let body = parseBlock();
      expectKeyword('end');
      destroyScope();

      let forStatement = new ForGenericStatement(variables, iterators, body);
      scopedForVariableInfo.initializeParseNode = forStatement;
      for (let scopedVarInfo of scopedVarInfos) {
        scopedVarInfo.initializeParseNode = forStatement;
      }
      return finishNode(forStatement);
    }
  }

  // Local statements can either be variable assignments or function
  // definitions. If a function definition is found, it will be delegated to
  // `parseFunctionDeclaration()` with the isLocal flag.
  //
  // This AST structure might change into a local assignment with a function
  // child.
  //
  //     local ::= 'local' 'function' Name funcdecl
  //        | 'local' Name {',' Name} ['=' exp {',' exp}]
  function parseLocalStatement() {
    if (token.type === LuaTokenType.Identifier) {
      let variables = [];
      let init = new Array<Expression>();
      do {
        let name = parseIdentifier();
        if (name) {
          variables.push(name);
        }
      } while (consumePunctuator(','));
      if (consumePunctuator('=')) {
        do {
          var expression = parseExpectedExpression();
          if (expression) {
            init.push(expression);
          }
        } while (consumePunctuator(','));
      }

      let localStatement = new LocalStatement(variables, init);
      // Declarations doesn't exist before the statement has been evaluated.
      // Therefore assignments can't use their declarator. And the identifiers
      // shouldn't be added to the scope until the statement is complete.
      for (var i = 0, l = variables.length; i < l; i++) {
        scopeIdentifier(variables[i]).initializeParseNode = localStatement;
      }
      return finishNode(localStatement);
    }
    if (consumeKeyword('function')) {
      let name = parseIdentifier();
      let scopedIdentifierInfo = scopeIdentifier(name);
      createScope();
      // MemberExpressions are not allowed in local function statements.
      let functionDeclaration = parseFunctionDeclaration(name, true);
      scopedIdentifierInfo.initializeParseNode = functionDeclaration;
      return functionDeclaration;
    }
    // there's an error in local statement, so we will make an erroneous one
    raiseUnexpectedToken('<name>', token);
    return finishNode(new LocalStatement([], undefined));
  }

  //     do ::= 'do' block 'end'
  function parseDoStatement() {
    createScope();
    let body = parseBlock();
    destroyScope();
    expectKeyword('end');
    return finishNode(new DoStatement(body));
  }

  function validateVar(node: Expression) {
    // @TODO we need something not dependent on the exact AST used. see also isCallExpression()
    if (node.inParens || (['Identifier', 'MemberExpression', 'IndexExpression'].indexOf(node.type) === -1)) {
      lexer.raiseError(token, errorStrings.invalidVar, token.rawValue);
    }
  }

  //     assignment ::= varlist '=' explist
  //     var ::= Name | prefixexp '[' exp ']' | prefixexp '.' Name
  //     varlist ::= var {',' var}
  //     explist ::= exp {',' exp}
  //
  //     call ::= callexp
  //     callexp ::= prefixexp args | prefixexp ':' Name args
  function parseAssignmentOrCallStatement(): Statement {
    // Keep a reference to the previous token for better error messages in case
    // of invalid statement
    var previous = token
      , expression;

    let marker = createLocationMarker();
    let ctErrorsBefore = lexer.errors.length;
    expression = parsePrefixExpression();

    if (!expression) {
      // report errors only if no errors were already reported
      if (lexer.errors.length === ctErrorsBefore) {
        raiseUnexpected(iToken);
      }
      moveToNextToken();
      return new ErroneousNode();
    }
    if (token.isPunctuator(',') || token.isPunctuator('=')) {
      let variables = [expression];
      let init = [];

      validateVar(expression);
      while (consumePunctuator(',')) {
        let exp = parsePrefixExpression();
        if (!exp) {
          raiseUnexpectedToken('<expression>', token);
          exp = new ErroneousNode();
        } else {
          validateVar(exp);
        }
        variables.push(exp);
      }
      expectPunctuator('=');
      do {
        let exp = parseExpectedExpression();
        init.push(exp);
      } while (consumePunctuator(','));

      pushLocation(marker);
      return finishNode(new AssignmentStatement(variables, init));
    }
    if (isCallExpression(expression)) {
      pushLocation(marker);
      return finishNode(new CallStatement(expression));
    }
    // The prefix expression was neither part of an assignment or a
    // callstatement, however as it was valid it's been consumed, so raise
    // the exception on the previous token to provide a helpful message.
    raiseUnexpected(Math.max(iToken - 1, 0), token.rawValue);
    return new ErroneousNode();
  }

  //     while ::= 'while' exp 'do' block 'end'
  function parseWhileStatement() {
    let condition = parseExpectedExpression() || new ErroneousNode();
    expectKeyword('do');
    createScope();
    let body = parseBlock();
    destroyScope();
    expectKeyword('end');
    return finishNode(new WhileStatement(condition, body));
  }

  //     repeat ::= 'repeat' block 'until' exp
  function parseRepeatStatement() {
    createScope();
    var body = parseBlock();
    expectKeyword('until');
    let  condition = parseExpectedExpression() || new ErroneousNode();
    destroyScope();
    return finishNode(new RepeatStatement(condition, body));
  }

  //     break ::= 'break'
  function parseBreakStatement() {
    return finishNode(new BreakStatement());
  }

  //     retstat ::= 'return' [exp {',' exp}] [';']
  function parseReturnStatement() {
    let expressions = [];

    if (!token.isKeyword('end')) {
      let expression = parseExpression();
      if (expression) {
        expressions.push(expression);
      }
      while (consumePunctuator(',')) {
        expression = parseExpectedExpression();
        if (expression) {
          expressions.push(expression);
        }
      }
      consumePunctuator(';'); // grammar tells us ; is optional here.
    }
    return finishNode(new ReturnStatement(expressions));
  }

  //     if ::= 'if' exp 'then' block {elif} ['else' block] 'end'
  //     elif ::= 'elseif' exp 'then' block
  function parseIfStatement() {
    // IfClauses begin at the same location as the parent IfStatement.
    // It ends at the start of `end`, `else`, or `elseif`.
    let marker = getLastLocation();
    pushLocation(marker);
    let condition = parseExpectedExpression();
    expectKeyword('then');
    createScope();
    let body = parseBlock();
    destroyScope();
    let clauses = new Array<IfStatementClause>();
    if (condition) {
      clauses.push(finishNode(new IfClause(condition, body)));
    }

    marker = createLocationMarker();
    while (consumeKeyword('elseif')) {
      pushLocation(marker);
      let condition = parseExpectedExpression();
      expectKeyword('then');
      createScope();
      body = parseBlock();
      destroyScope();
      if (condition) {
        clauses.push(finishNode(new IfClause(condition, body)));
      }
      marker = createLocationMarker();
    }

    if (consumeKeyword('else')) {
      // Include the `else` in the location of ElseClause.
      pushLocation(new ParseNodeLocation(tokens[iToken - 1]));
      createScope();
      let body = parseBlock();
      destroyScope();
      clauses.push(finishNode(new ElseClause(body)));
    }

    expectKeyword('end');
    return finishNode(new IfStatement(clauses));
  }

  // There are two types of statements, simple and compound.
  //
  //     statement ::= break | do | while | repeat | return
  //          | if | for | function | local | label | assignment
  //          | functioncall | ';'
  function parseStatement(): Statement|undefined {
    markLocation();
    if (token.type === LuaTokenType.Keyword) {
      switch (token.value) {
        case 'local':
          moveToNextToken();
          return parseLocalStatement();
        case 'if':
          moveToNextToken();
          return parseIfStatement();
        case 'return':
          moveToNextToken();
          return parseReturnStatement();
        case 'function':
          moveToNextToken();
          let name = parseFunctionName();
          return parseFunctionDeclaration(name);
        case 'while':
          moveToNextToken();
          return parseWhileStatement();
        case 'for':
          moveToNextToken();
          return parseForStatement();
        case 'repeat':
          moveToNextToken();
          return parseRepeatStatement();
        case 'break':
          moveToNextToken();
          return parseBreakStatement();
        case 'do':
          moveToNextToken();
          return parseDoStatement();
      }
    }
    // Assignments memorizes the location and pushes it manually for wrapper
    // nodes. Additionally empty `;` statements should not mark a location.
    popLocation();

    // When a `;` is encounted, simply eat it without storing it.
    if (consumePunctuator(';')) {
      return undefined;
    }
    return parseAssignmentOrCallStatement();
  }

  // A block contains a list of statements with an optional return statement
  // as its last statement.
  //
  //     block ::= {stat} [retstat]
  function parseBlock() : Block {
    markLocation();
    let statements = new Array<Statement>();

    while (!isBlockFollow(token)) {
      // Return has to be the last statement in a block.
      if (token.rawValue === 'return') {
        let statement = parseStatement();
        if (statement) {
          statements.push(statement);
        }
        break;
      }
      let statement = parseStatement();
      // Statements are only added if they are returned, this allows us to
      // ignore some statements, such as EmptyStatement.
      if (statement) {
        statements.push(statement);
      }
    }

    // Doesn't really need an ast node
    return finishNode(new Block(statements, scopes[scopes.length - 1]));
  }

  // array used to track locations
  let locations = new Array<ParseNodeLocation>();

  function markLocation() {
    locations.push(createLocationMarker());
  }
  function getLastLocation() {
    return locations[locations.length - 1];
  }
  function finishNode<T extends ParseNode>(parseNode: T) : T {
    let loc = locations.pop();
    if (loc) {
      let previousToken = tokens[iToken - 1];
      loc.finish(previousToken);
      parseNode.loc = loc;
    } else {
      lexer.raiseError(token, errorStrings.missingLocation);
    }
    if (onCreateNodeCallback) {
      onCreateNodeCallback(parseNode);
    }
    return parseNode;
  }
  function popLocation() {
    return locations.pop();
  }
  function pushLocation(marker: ParseNodeLocation) {
    locations.push(marker.clone());
  }
  function createLocationMarker() {
    return new ParseNodeLocation(token);
  }

  let globals = Array<Identifier>();
  function addUniqueGlobal(identifier: Identifier) {
    if (globals.findIndex((value) => identifier.name === value.name) !== -1) {
      return;
    }
    globals.push(identifier);
  }

  let scopes = Array<Array<ScopedIdentifierInfo>>();
  // Create a new scope inheriting all declarations from the previous scope.
  function createScope() {
    scopes.push(new Array<ScopedIdentifierInfo>());
  }
  function destroyScope() {
    scopes.pop();
  }
  function scopeIdentifierName(name: string) : ScopedIdentifierInfo {
    let currentScope = scopes[scopes.length - 1];
    let identifierInfo = currentScope.find((value) => value.name === name);
    if (identifierInfo) {
      return identifierInfo;
    }
    identifierInfo = new ScopedIdentifierInfo(name);
    currentScope.push(identifierInfo);
    return identifierInfo;
  }
  function scopeIdentifier(identifier: Identifier) : ScopedIdentifierInfo {
    attachScope(identifier, true);
    let scopedIdentifierInfo = scopeIdentifierName(identifier.name);
    scopedIdentifierInfo.identifier = identifier;
    return scopedIdentifierInfo;
  }
  // Attach scope information to node. If the node is global, store it in the
  // globals array so we can return the information to the user.
  function attachScope(identifier: Identifier, isLocal: boolean) {
    if (!isLocal) {
      addUniqueGlobal(identifier);
      return;
    }
    identifier.isLocal = isLocal;
  }
  function scopeHasName(name: string): boolean {
    for (let scope of scopes) {
      if (scope.findIndex((value) => value.name === name) !== -1) {
        return true;
      }
    }
    return false;
  }

  function parseChunk() : Chunk {
    markLocation();
    createScope();
    let body = parseBlock();
    destroyScope();
    if (token.type !== LuaTokenType.EOF) {
      raiseUnexpected(iToken, errorStrings.expectedToken);
    }
    return finishNode(new Chunk(body));
  }

  let parsedChunk = parseChunk();
  return {tokens: allTokens,
    parsedChunk: parsedChunk,
    globals: globals,
    errors: lexer.errors};
}

// @TODO this needs to be rethought.
function isCallExpression(expression: Expression) {
  switch (expression.type) {
    case 'CallExpression':
    case 'TableCallExpression':
    case 'StringCallExpression':
      return true;
  }
  return false;
}

function isBlockFollow(token: LuaToken) {
  if (token.type === LuaTokenType.EOF) {
    return true;
  }
  if (token.type !== LuaTokenType.Keyword) {
    return false;
  }
  switch (token.value) {
    case 'else': case 'elseif':
    case 'end': case 'until':
      return true;
    default:
      return false;
  }
}

function isUnaryOperator(token: LuaToken) {
  if (token.type === LuaTokenType.Punctuator) {
    return '#-~'.indexOf(token.rawValue) >= 0;
  }
  if (token.type === LuaTokenType.Keyword) {
    return token.rawValue === 'not';
  }
  return false;
}

// Return the precedence priority of the operator.
  //
  // As unary `-` can't be distinguished from binary `-`, unary precedence
  // isn't described in this table but in `parseSubExpression()` itself.
  //
  // As this function gets hit on every expression it's been optimized due to
  // the expensive CompareICStub which took ~8% of the parse time.
  function binaryPrecedence(operator: string) {
    let charCode = operator.charCodeAt(0);
    let length = operator.length;

    if (length === 1) {
      switch (charCode) {
        case 94: return 12; // ^
        case 42: case 47: case 37: return 10; // * / %
        case 43: case 45: return 9; // + -
        // not Lua5.1 case 38: return 6; // &
        case 126: return 5; // ~
        // not Lua5.1 case 124: return 4; // |
        case 60: case 62: return 3; // < >
      }
    } else if (2 === length) {
      switch (charCode) {
        // not Lua5.1 case 47: return 10; // //
        case 46: return 8; // ..
        case 60: case 62:
        // not Lua5.1.  if ('<<' === operator || '>>' === operator) return 7; // << >>
            return 3; // <= >=
        case 61: case 126: return 3; // == ~=
        case 111: return 1; // or
      }
    } else if (97 === charCode && 'and' === operator) {
      return 2;
    }
    return 0;
  }