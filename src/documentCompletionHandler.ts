let luaparse = require('luaparse');
import * as vscode from 'vscode';

class VariableInfo {
  constructor(varType?: string) {
    this.type = varType;
  }
  type: string|undefined;
}

let luaparseTokenToStringMap : Map<number, string>|undefined;
function luaparseTokenTypeToString(luaparseTokenType: number): string {
  if (!luaparseTokenToStringMap) {
    luaparseTokenToStringMap = new Map<number, string>();
    for (let tokenString in luaparse.tokenTypes) {
      luaparseTokenToStringMap.set(luaparse.tokenTypes[tokenString], tokenString);
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
      while (true) {
        let token = manualParser.lex();
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