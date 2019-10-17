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
  error: string|undefined;

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

export class DocumentCompletionHandler {
  constructor(document: vscode.TextDocument) {
    this.startParsingDocument(document);
  }
  getCompletionInfo(): DocumentCompletionInfo|undefined {
    if (this.currentAsyncParsing) {
      this.currentAsyncParsing.then();
      this.currentAsyncParsing = undefined;
    }
    return this.currentCompletionInfo;
  }
  async getCompletionInfoNow(): Promise<DocumentCompletionInfo|undefined> {
    if (this.currentAsyncParsing) {
      await this.currentAsyncParsing;
    }
    return this.currentCompletionInfo;
  }
  getLastError(): string {
    return this.lastError;
  }
  onDocumentChanged(document: vscode.TextDocument) {
    this.startParsingDocument(document);
  }

  private startParsingDocument(document: vscode.TextDocument) {
    this.currentAsyncParsing = this.parseDocument(document.getText());
    
    this.currentAsyncParsing.then((result) => {
        this.currentCompletionInfo = result;
        this.lastError = "";
      })
      .catch(err => this.lastError = err.message)
      .finally(() => this.currentAsyncParsing = undefined);
  }

  private async parseDocument(documentText: string): Promise<DocumentCompletionInfo> {
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
      result.error = err.message;
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
    return result;
  }
  private currentCompletionInfo: DocumentCompletionInfo|undefined = undefined;
  private currentAsyncParsing: Promise<DocumentCompletionInfo>|undefined = undefined;
  private lastError: string = "";
}

function isIndexingChar(char: string) {return char === '.' || char === ':';}