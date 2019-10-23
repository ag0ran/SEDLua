let luaparse = require('./luaparse');
import * as vscode from 'vscode';
import { MacroFuncCompletionInfo, CvarFunctionCompletionInfo, MacroClassCompletionInfo, HelpCompletionInfo } from './seHelp';

export class VariableInfo {
  constructor(varType?: string) {
    this.type = varType;
  }
  type: string|undefined;
}

let luaparseTokenToStringMap : Map<number, string>|undefined;
function luaparseTokenTypeToString(luaparseTokenType: number): string {
  if (!luaparseTokenToStringMap) {
    luaparseTokenToStringMap = new Map<number, string>();
    let commentFound = false;
    for (let tokenString in luaparse.tokenTypes) {
      if (tokenString === "Comment") {
        commentFound = true;
      }
      luaparseTokenToStringMap.set(luaparse.tokenTypes[tokenString], tokenString);
    }
    if (!commentFound) {
      luaparseTokenToStringMap.set(-1, "Comment");
    }
  }
  return luaparseTokenToStringMap.get(luaparseTokenType) || "";
}

export class TokenInfo {
  constructor(luaparseToken?: any) {
    if (luaparseToken) {
      this.type = luaparseTokenTypeToString(luaparseToken.type);
      this.value = luaparseToken.value;
    }
  }
  static fromLuaparseToken(luaparseToken: any) {
    if (luaparseToken) {
      return new TokenInfo(luaparseToken);
    }
    return undefined;
  }
  type: string = "";
  value: string = "";
}

export class ParseInfo {
  token2Before: TokenInfo|undefined;
  token1Before: TokenInfo|undefined;
  token0: TokenInfo|undefined;
}

export class DocumentCompletionInfo {
  variables: Map<string, VariableInfo> = new Map<string, VariableInfo>();
  functions: Set<string> = new Set<string>();
  ast: any;
  tokens: any[] = [];
  error: DocumentParsingError|undefined;

  getTokenIndexAtOffset(offset: number) : number {
    for (let i = 0; i < this.tokens.length; i++) {
      let token = this.tokens[i];
      if (token.range[0] <= offset && offset <= token.range[1]) {
        return i;
      }
      if (token.range[1] >= offset) {
        return i - 1;
      }
    }
    return this.tokens.length - 1;
  }
  getTokenByIndex(tokenIndex: number) : TokenInfo {
    return new TokenInfo(this.tokens[tokenIndex]);
  }

  getParseInfoAroundOffset(offset: number) : ParseInfo|undefined {
    let token2Before : any;
    let token1Before : any;
    let token0 : any;
    for (let i = 0; i < this.tokens.length; i++) {
      let token = this.tokens[i];
      if (token.range[0] <= offset && offset <= token.range[1]) {
        token0 = token;
        break;
      } else if (token.range[1] <= offset) {
        token2Before = token1Before;
        token1Before = token;
      }
    }
    if (token0 || token1Before) {
      let parseInfo = new ParseInfo();
      parseInfo.token0 = TokenInfo.fromLuaparseToken(token0);
      parseInfo.token1Before = TokenInfo.fromLuaparseToken(token1Before);
      parseInfo.token2Before = TokenInfo.fromLuaparseToken(token2Before);
      return parseInfo;
    }
    return undefined;
  }

  // Tries to find a function call of a know function at given offset. Returns the function info and the current parameter index if function is found.
  getFunctionCallInfoAtOffset(offset: number, helpCompletionInfo: HelpCompletionInfo):
    [MacroFuncCompletionInfo|CvarFunctionCompletionInfo, number]|undefined
  {
    // go through the tokens starting at the current offset, trying to find opening '(' character preceeded by a known function
    let iTokenAtOffset = this.getTokenIndexAtOffset(offset);
    if (iTokenAtOffset === -1) {
      return undefined;
    }
    let firstToken = this.tokens[iTokenAtOffset];
    // if were exactly at the closing bracket, we should move one token back
    // (otherwise that would be considered as already closed function call and no
    // signature would be given)
    if (firstToken.value === ")" && firstToken.range[0] === offset) {
      iTokenAtOffset--;
    }

    let bracketCounter = 0;
    let parameter = 0;
    let potentialCallStartFound = false;
    let iCurrentToken = iTokenAtOffset;
    let expectingTokenTypesAndValues: [number, string[]][] = [];
    function IsTokenUnexpected(token: any): boolean {
      if (expectingTokenTypesAndValues.length === 0) {
        return false;
      }
      for (let expectedTypeAndValue of expectingTokenTypesAndValues) {
        let [expectedType, expectedValues] = expectedTypeAndValue;
        if (token.type === expectedType) {
          for (let value of expectedValues) {
            if (token.value === value) {
              return false;
            }
          }
        }
      }
      return true;
    }
    for ( ; iCurrentToken >= 0; --iCurrentToken) {
      let currentToken = this.tokens[iCurrentToken];

      if (IsTokenUnexpected(currentToken)) {
        return undefined;
      } else {
        expectingTokenTypesAndValues = [];
      }

      if (currentToken.value === '(') {
        if (bracketCounter === 0) {
          potentialCallStartFound = true;
          break;
        }
        bracketCounter--;
        continue;
      }
     
      // detecting nested function calls
      if (currentToken.value === ')') {
        bracketCounter++;
        continue;
      }
      // skip tokens inside nested calls
      if (bracketCounter > 0) {
        continue;
      }
      if (currentToken.value === ',') {
        parameter++;
        continue;
      }
      if (currentToken.type === luaparse.tokenTypes.Identifier
          || currentToken.type === luaparse.tokenTypes.StringLiteral
          || currentToken.type === luaparse.tokenTypes.NumericLiteral) {
        expectingTokenTypesAndValues = [[luaparse.tokenTypes.Punctuator, [",", "+", "-", "*", "%", "(", "{"]]];
      }
    }
    if (!potentialCallStartFound || iCurrentToken <= 0) {
      return undefined;
    }
    // try to resolve indexing expression starting at the token before the call start
    let expressionBeforeInfo = this.resolveIndexingExpressionAtToken(iCurrentToken - 1, helpCompletionInfo);
    if (!expressionBeforeInfo) {
      return undefined;
    }

    if (expressionBeforeInfo instanceof MacroFuncCompletionInfo
        || expressionBeforeInfo instanceof CvarFunctionCompletionInfo) {
      return [expressionBeforeInfo, parameter];
    } else {
      return undefined;
    }
  }

  resolveMemberExpressionAtOffset(offset: number, helpCompletionInfo: HelpCompletionInfo):
  VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|string|undefined
  {
    if (!this.ast) {
      return undefined;
    }
    function IsOutsideOfRange(obj: any, offset: number) {
      if (!obj.range || !Array.isArray(obj.range)) {
        return false;
      }
      return offset < obj.range[0] || offset > obj.range[1];
    }
    function findIdentifierOrMemberExpressionRecursive(obj: any, offset: number): any {
      if (IsOutsideOfRange(obj, offset)) {
        return;
      }
      for (const key of Object.keys(obj)) {
        const value = obj[key];
        if (key === "type") {
          if (value === "MemberExpression") {
            if (obj.identifier && !IsOutsideOfRange(obj.identifier, offset)) {
              return obj;
            }
          } else if (value === "Identifier") {
            return obj;
          }
        } 
        if (Array.isArray(value)) {
          for (const v of value) {
            if (v instanceof Object) {
              let result = findIdentifierOrMemberExpressionRecursive(v, offset);
              if (result) {
                return result;
              }
            }
          }
        } else if (value instanceof Object) {
          let result = findIdentifierOrMemberExpressionRecursive(value, offset);
          if (result) {
            return result;
          }
        }
      }
      return undefined;
    }
    let identifierOrMemberExpression: any;
    // find member expression at offset range
    for (const statement of this.ast.body) {
      identifierOrMemberExpression = findIdentifierOrMemberExpressionRecursive(statement, offset);
      if (identifierOrMemberExpression) {
        break;
      }
    }
    let variables = this.variables;

    function resolveMemberExpressionRecursive(memberExpression: any):
      VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|string|undefined
    {
      if (memberExpression.type === "Identifier") {
        let variableInfo = variables.get(memberExpression.name);
        if (variableInfo) {
          return variableInfo.type ? helpCompletionInfo.findMacroClassInfo(variableInfo.type) : undefined;
        }
        return helpCompletionInfo.findMacroFuncInfo(memberExpression.name)
          || helpCompletionInfo.findCvarFuncInfo(memberExpression.name);
      } else if (memberExpression.type !== "MemberExpression") {
        return undefined;
      }
      let baseExpressionValue = resolveMemberExpressionRecursive(memberExpression.base);
      if (!baseExpressionValue) {
        return undefined;
      }
      if (baseExpressionValue instanceof MacroClassCompletionInfo) {
        if (memberExpression.indexer === ".") {
          return helpCompletionInfo.findMacroClassEvent(baseExpressionValue, memberExpression.identifier.name);
        } else if (memberExpression.indexer === ":") {
          return helpCompletionInfo.findMacroClassFunction(baseExpressionValue, memberExpression.identifier.name);
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }

    if (identifierOrMemberExpression) {
      return resolveMemberExpressionRecursive(identifierOrMemberExpression);
    }

    return undefined;
  }

  resolveIndexingExpressionAtToken(iStartingToken: number, helpCompletionInfo: HelpCompletionInfo):
    MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|string|undefined
  {
    let startingToken = this.tokens[iStartingToken];
    if (startingToken.type !== luaparse.tokenTypes.Identifier) {
      return undefined;
    }
    let tokenChain = [startingToken];
    let lastTokenIndexing = false;
    for (let iToken = iStartingToken - 1; iToken >= 0; iToken--) {
      let token = this.tokens[iToken];
      if (!lastTokenIndexing) {
        if (isIndexingChar(token.value)) {
          lastTokenIndexing = true;
        } else {
          break;
        }
      } else {
        if (token.type !== luaparse.tokenTypes.Identifier) {
          break;
        }
        lastTokenIndexing = false;
      }
      tokenChain.push(token);
    }

    // going through the token chain in reverse and trying to index the chain up to current token
    let lastInfo: MacroClassCompletionInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|string|undefined;
    let indexWhat: string|undefined;
    while (tokenChain.length > 0) {
      let token = tokenChain.pop();
      if (!lastInfo) {
        let variableInfo = this.variables.get(token!.value);
        if (variableInfo && variableInfo.type) {
          lastInfo = helpCompletionInfo.findMacroClassInfo(variableInfo.type);
        }
        if (!lastInfo) {
          lastInfo = helpCompletionInfo.findCvarFuncInfo(token!.value);
          if (!lastInfo) {
            lastInfo = helpCompletionInfo.findMacroFuncInfo(token!.value);
          }
        }
        
        if (!lastInfo) {
          return undefined;
        }
      } else {
        if (indexWhat) {
          if (!(lastInfo instanceof MacroClassCompletionInfo)) {
            return undefined;
          }
          if (token!.type !== luaparse.tokenTypes.Identifier) {
            return undefined;
          }
          if (indexWhat === "Event") {
            let eventName = token!.value;
            if (!helpCompletionInfo.findMacroClassEvent(lastInfo, eventName)) {
              return undefined;
            } else {
                lastInfo = `Event ${lastInfo.name}.${eventName}`;
              break;
            }
          } else if (indexWhat === "Function") {
            let functionName = token!.value;
            let funcInfo = helpCompletionInfo.findMacroClassFunction(lastInfo, functionName);
            if (!funcInfo) {
              return undefined;
            } else {
                lastInfo = funcInfo;
              break;
            }
          } else {
            return undefined;
          }
          indexWhat = undefined;
        } else {
          if (token!.value === ".") {
            indexWhat = "Event";
          } else if (token!.value === ":") {
            indexWhat = "Function";
          } else {
            return undefined;
          }
        }
      }
    }

    // we should have gone through all the tokens in the chain
    if (tokenChain.length > 0) {
      return undefined;
    }
    return lastInfo;
  }
}

export class DocumentParsingError {
  constructor(range: Array<number>, message: string) {
    this.range = range;
    this.message = message;
  }
  range: Array<number> = [];
  message: string = "";
}

export class DocumentCompletionHandler {
  constructor(document: vscode.TextDocument) {
    this.parseDocument(document.getText());
  }
  getCompletionInfo(): DocumentCompletionInfo|undefined {
    return this.currentCompletionInfo;
  }
  async getCompletionInfoNow(): Promise<DocumentCompletionInfo|undefined> {
    return this.currentCompletionInfo;
  }
  getLastError(): string {
    return this.lastError;
  }
  async onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    await this.parseDocument(e.document.getText());
    await this.fixAst(e.contentChanges);
  }

  private async parseDocument(documentText: string) {
    let result = new DocumentCompletionInfo();
    function onCreateNodeCallback(node: any) {
      switch (node.type) {
        case "Identifier":
          let varName: string = node.name;
          if (!result.variables.get(varName)) {
            result.variables.set(varName, new VariableInfo());
          }
          break;
        case "Comment":
          let comment: string = node.value;
          let commentMatch = comment.match(/(\w+)\s*:\s*(\w+)/);
          if (commentMatch) {
            let varName: string = commentMatch[1];
            let varType: string = commentMatch[2];
            result.variables.set(varName, new VariableInfo(varType));
          }
          break;
        case "CallExpression":
          let funcName;

          if (node.base) {
            if (node.base.identifier && node.base.identifier.name) {
              funcName = node.base.identifier.name;
            } else if (node.base.name) {
              funcName = node.base.name;
            }
          }
          if (funcName) {
            result.functions.add(funcName);
          }
          break;
        case "FunctionDeclaration":
          if (node.identifier) {
            let nodeIdentifier = node.identifier.name;
            result.functions.add(nodeIdentifier);
          }
          break;
      }
    }
    let parseOptions = {
      wait: false,
      scope: true,
      location: true,
      ranges: true,
      onCreateNode: onCreateNodeCallback
    };
    try {
      result.ast = luaparse.parse(documentText, parseOptions);
    } catch (err) {
      result.error = new DocumentParsingError([err.line - 1, err.column, err.line - 1, err.column + 10000], err.message);
    } finally {
      parseOptions.wait = true;
      let manualParser = luaparse.parse(documentText, parseOptions);
      // We will also collect comments as tokens as we're interested in them for
      // variable hinting purposes.
      let lastCommentsLen = 0;
      while (true) {
        let token = manualParser.lex();
        if (manualParser.comments && lastCommentsLen !== manualParser.comments.length) {
          lastCommentsLen = manualParser.comments.length;
          let comment = manualParser.comments[lastCommentsLen - 1];
          let commentToken = {
            type: -1,
            value: comment.value,
            range: comment.range,
          };
          result.tokens.push(commentToken);
        }
        if (!token || token.type === luaparse.tokenTypes.EOF) {
          break;
        }
        result.tokens.push(token);
      }
    }
    // don't let functions be specified in variables
    for (const func of result.functions) {
      result.variables.delete(func);
    }
    this.currentCompletionInfo = result;
    if (!result.error && result.ast) {
      this.lastAst = result.ast;
    }
  }
  private fixAst(contentChanges: ReadonlyArray<vscode.TextDocumentContentChangeEvent>)
  {
    // nothing to do if no current completion info or no last error (AST is correct when there was no error)
    if (!this.currentCompletionInfo || !this.currentCompletionInfo.error) {
      return;
    }
    let ast = this.lastAst;
    if (!ast) {
      return;
    }
    function fixRangesRecursive(obj: any, rangeOffset: number, rangeChange: number) {
      for (const key of Object.keys(obj)) {
        let value = obj[key];
        if (key === "range") {
          if (Array.isArray(value) && value.length === 2) {
            if (rangeOffset > value[0]) {
              if (rangeOffset <= value[1]) {
                value[1] += rangeChange;
              }
            } else if (rangeOffset <= value[0]) {
              value[0] += rangeChange;
              value[1] += rangeChange;
            }
          }
        } else if (Array.isArray(value)) {
          for (const v of value) {
            if (v instanceof Object) {
              fixRangesRecursive(v, rangeOffset, rangeChange);
            }
          }
        } else if (value instanceof Object) {
          fixRangesRecursive(value, rangeOffset, rangeChange);
        }
      }
    }

    for (const contentChangeEvent of contentChanges) {
      let rangeOffset = contentChangeEvent.rangeOffset;
      let rangeChange = contentChangeEvent.text.length - contentChangeEvent.rangeLength;
      fixRangesRecursive(ast, rangeOffset, rangeChange);
    }
  }
  private currentCompletionInfo: DocumentCompletionInfo|undefined = undefined;
  private lastError: string = "";
  private lastAst: any;
}

function isIndexingChar(char: string) {return char === '.' || char === ':';}