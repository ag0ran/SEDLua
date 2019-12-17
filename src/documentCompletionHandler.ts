import { LuaToken, LuaTokenType } from './luaLexer';
import { parseLuaSource, LuaParseResults, ParseNode, Comment, MemberExpression, Identifier, ParseNodeVisitResult, visitParseNodes, CallExpression, FunctionDeclaration } from './luaParser';
import * as vscode from 'vscode';
import { helpCompletionInfo, MacroFuncCompletionInfo, CvarFunctionCompletionInfo, MacroClassCompletionInfo,
  LuaObjectCompletionInfo, LuaFunctionCompletionInfo, extractLuaParamByIndex, extractMacroParamByIndex } from './seHelp';
import {worldScriptsStorage} from './worldScripts';
import * as seFilesystem from './sefilesystem';


export class VariableInfo {
  constructor(varType?: string) {
    this.type = varType;
  }
  type: string|undefined;
}

export class ParseInfo {
  token2Before: LuaToken|undefined;
  token1Before: LuaToken|undefined;
  token0: LuaToken|undefined;
}

interface FuncCallParamInfo {
  name: string;
  type?: string;
}

export class DocumentCompletionInfo {
  constructor (documentSofPath?: string) {
    this.documentSoftPath = documentSofPath || "";
  }
  parseResults?: LuaParseResults;

  variables: Map<string, VariableInfo> = new Map<string, VariableInfo>();
  functions: Set<string> = new Set<string>();
  tokens: Array<LuaToken> = [];
  error: DocumentParsingError|undefined;
  errors: Array<DocumentParsingError>|undefined;
  warnings: Array<DocumentParsingError>|undefined;
  documentSoftPath: string;
  cvarHintMode = true;
  macroHintMode = true;

  getVariableInfoForToken(token: LuaToken): VariableInfo|undefined {
    if (token.type !== LuaTokenType.Identifier) {
      return undefined;
    }
    return this.getVariableInfo(token.rawValue);
  }

  getVariableInfo(variableName: string): VariableInfo|undefined {
    let variableInfo = this.variables.get(variableName);
    if (variableInfo && variableInfo.type) {
      return variableInfo;
    }
    let varInfos = worldScriptsStorage.getVarInfosForScript(this.documentSoftPath);
    if (!varInfos) {
      return undefined;
    }
    return varInfos.get(variableName);
  }

  forEachVariable(callbackFunc: (variableInfo: VariableInfo, variableName: string) => void) {
    this.variables.forEach(callbackFunc);
    let varInfos = worldScriptsStorage.getVarInfosForScript(this.documentSoftPath);
    if (varInfos) {
      varInfos.forEach(callbackFunc);
    }
  }

  getTokenIndexAtOffset(offset: number) : number {
    for (let i = 0; i < this.tokens.length; i++) {
      let token = this.tokens[i];
      if (token.rangeStart <= offset && offset <= token.rangeEnd) {
        return i;
      }
      if (token.rangeEnd >= offset) {
        return i - 1;
      }
    }
    return this.tokens.length - 1;
  }
  getTokenByIndex(tokenIndex: number) : LuaToken {
    return this.tokens[tokenIndex];
  }

  getParseInfoAroundOffset(offset: number) : ParseInfo|undefined {
    let token2Before : any;
    let token1Before : any;
    let token0 : any;
    for (let i = 0; i < this.tokens.length; i++) {
      let token = this.tokens[i];
      if (token.rangeStart <= offset && offset <= token.rangeEnd) {
        token0 = token;
        break;
      } else if (token.rangeEnd <= offset) {
        token2Before = token1Before;
        token1Before = token;
      }
    }
    if (token0 || token1Before) {
      let parseInfo = new ParseInfo();
      parseInfo.token0 = token0;
      parseInfo.token1Before = token1Before;
      parseInfo.token2Before = token2Before;
      return parseInfo;
    }
    return undefined;
  }

  // Tries to find a function call of a known function at given offset. Returns the parameter info at provided offset
  getFunctionCallParamInfoAtOffset(offset: number): FuncCallParamInfo|undefined {
    let functionCallInfo = this.getFunctionCallInfoAtOffset(offset);
    if (!functionCallInfo) {
      return undefined;
    }
    let [funcInfo, iParam] = functionCallInfo;
    if (funcInfo instanceof MacroFuncCompletionInfo) {
      let paramString = extractMacroParamByIndex(funcInfo.params, iParam);
      if (paramString === undefined) {
        return undefined;
      }
      return {
        name: paramString
      };
    } else if (funcInfo instanceof CvarFunctionCompletionInfo) {
      let paramString = extractMacroParamByIndex(funcInfo.params, iParam);
      if (paramString === undefined) {
        return undefined;
      }
      return {
        name: paramString
      };
    } else if (funcInfo instanceof LuaFunctionCompletionInfo) {
      let paramInfo = extractLuaParamByIndex(funcInfo, iParam);
      if (!paramInfo) {
        return undefined;
      }
      return {
        name: paramInfo.name
      };
    } else {
      return undefined;
    }
  }

  // Tries to find a function call of a known function at given offset. Returns the function info and the current parameter index if function is found.
  getFunctionCallInfoAtOffset(offset: number):
    [MacroFuncCompletionInfo|CvarFunctionCompletionInfo|LuaFunctionCompletionInfo, number]|undefined
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
    if (firstToken.rangeStart === offset && firstToken.isPunctuator(')')) {
      iTokenAtOffset--;
    }

    let bracketCounter = 0;
    let parameter = 0;
    let potentialCallStartFound = false;
    let iCurrentToken = iTokenAtOffset;
    let expectingTokenTypesAndValues: [LuaTokenType, string[]][] = [];
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
      if (currentToken.type === LuaTokenType.Identifier
          || currentToken.type === LuaTokenType.StringLiteral
          || currentToken.type === LuaTokenType.NumericLiteral) {
        expectingTokenTypesAndValues = [[LuaTokenType.Punctuator, [",", "+", "-", "*", "%", "(", "{"]]];
      }
    }
    if (!potentialCallStartFound || iCurrentToken <= 0) {
      return undefined;
    }
    // try to resolve indexing expression starting at the token before the call start
    let expressionBeforeInfo = this.resolveIndexingExpressionAtToken(iCurrentToken - 1);
    if (!expressionBeforeInfo) {
      return undefined;
    }

    if (expressionBeforeInfo instanceof MacroFuncCompletionInfo
        || expressionBeforeInfo instanceof CvarFunctionCompletionInfo
        || expressionBeforeInfo instanceof LuaFunctionCompletionInfo) {
      return [expressionBeforeInfo, parameter];
    } else {
      return undefined;
    }
  }

  resolveMemberExpressionAtOffset(offset: number):
  VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|LuaObjectCompletionInfo|LuaFunctionCompletionInfo|string|undefined
  {
    if (this.parseResults  === undefined || this.parseResults.parsedChunk === undefined) {
      return undefined;
    }
    let identifierOrMemberExpression: MemberExpression|Identifier|undefined;
    function findIdentifierOrMemberExpressionVisitor(parseNode: ParseNode): ParseNodeVisitResult {
      if (!parseNode.loc.containsPos(offset)) {
        return ParseNodeVisitResult.SkipNode;
      }
      if (parseNode.type === "MemberExpression") {
        let memberExpression = parseNode as MemberExpression;
        // find the subset of the member expression that is within offset
        while (true) {
          if (memberExpression.base === undefined || !memberExpression.base.loc.containsPos(offset)) {
            break;
          }
          if (memberExpression.base.type === "MemberExpression") {
            memberExpression = memberExpression.base as MemberExpression;
          } else {
            if (memberExpression.base.type === "Identifier") {
              identifierOrMemberExpression = memberExpression.base as Identifier;
              return ParseNodeVisitResult.Stop;
            }
            break;
          }
        }
        identifierOrMemberExpression = memberExpression;
        return ParseNodeVisitResult.Stop;
      } else if (parseNode.type === "Identifier") {
        identifierOrMemberExpression = parseNode as Identifier;
        return ParseNodeVisitResult.Stop;
      }
      return ParseNodeVisitResult.Continue;
    }

    this.parseResults.parsedChunk.visitChildren(findIdentifierOrMemberExpressionVisitor);
    let documentCompletionInfo = this;

    function resolveMemberExpressionRecursive(memberExpression: any):
      VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|LuaObjectCompletionInfo|LuaFunctionCompletionInfo|string|undefined
    {
      if (memberExpression.type === "Identifier") {
        let variableInfo = documentCompletionInfo.getVariableInfo(memberExpression.name);
        if (variableInfo) {
          return variableInfo.type ? helpCompletionInfo.findMacroClassInfo(variableInfo.type) : undefined;
        }
        return helpCompletionInfo.findMacroFuncInfo(memberExpression.name)
          || helpCompletionInfo.findCvarFuncInfo(memberExpression.name) || helpCompletionInfo.findLuaCompletionInfo(memberExpression.name);
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
      } else if (baseExpressionValue instanceof LuaObjectCompletionInfo) {
        return baseExpressionValue.findCompletionInfoByName(memberExpression.identifier.name);
      } else {
        return undefined;
      }
    }

    if (identifierOrMemberExpression) {
      return resolveMemberExpressionRecursive(identifierOrMemberExpression);
    }

    return undefined;
  }

  resolveIndexingExpressionAtToken(iStartingToken: number):
    MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|string|LuaFunctionCompletionInfo|LuaObjectCompletionInfo|undefined
  {
    let startingToken = this.tokens[iStartingToken];
    if (startingToken.type !== LuaTokenType.Identifier) {
      return undefined;
    }
    let tokenChain = [startingToken];
    let lastTokenIndexing = false;
    for (let iToken = iStartingToken - 1; iToken >= 0; iToken--) {
      let token = this.tokens[iToken];
      if (!lastTokenIndexing) {
        if (isMemberIndexingToken(token)) {
          lastTokenIndexing = true;
        } else {
          break;
        }
      } else {
        if (token.type !== LuaTokenType.Identifier) {
          break;
        }
        lastTokenIndexing = false;
      }
      tokenChain.push(token);
    }

    // going through the token chain in reverse and trying to index the chain up to current token
    let lastInfo: MacroClassCompletionInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|LuaFunctionCompletionInfo|LuaObjectCompletionInfo|string|undefined;
    let indexingToken: string|undefined;
    while (tokenChain.length > 0) {
      let token = tokenChain.pop()!;
      if (!lastInfo) {
        // we're interested in identifiers only for indexing (for now)
        if (token.type !== LuaTokenType.Identifier) {
          return undefined;
        }
        let variableInfo = this.getVariableInfo(token.rawValue);
        if (variableInfo) {
          if (variableInfo.type) {
            lastInfo = helpCompletionInfo.findMacroClassInfo(variableInfo.type);
          }
        } else {
          lastInfo = helpCompletionInfo.findLuaCompletionInfo(token.rawValue);
        }
        if (!lastInfo) {
          lastInfo = helpCompletionInfo.findCvarFuncInfo(token.rawValue);
          if (!lastInfo) {
            lastInfo = helpCompletionInfo.findMacroFuncInfo(token.rawValue);
          }
        }
        if (!lastInfo) {
          return undefined;
        }
      } else {
        if (indexingToken) {
          if (lastInfo instanceof MacroClassCompletionInfo) {
            if (token.type !== LuaTokenType.Identifier) {
              return undefined;
            }
            if (indexingToken === ".") {
              let eventName = token.rawValue;
              if (!helpCompletionInfo.findMacroClassEvent(lastInfo, eventName)) {
                return undefined;
              } else {
                  lastInfo = `Event ${lastInfo.name}.${eventName}`;
                break;
              }
            } else if (indexingToken === ":") {
              let functionName = token.rawValue;
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
          } else if (lastInfo instanceof LuaObjectCompletionInfo) {
            let memberName = token.rawValue;
            let onlySelf = indexingToken === ':';
            return lastInfo.findCompletionInfoByName(memberName, onlySelf);
          } else {
            return undefined;
          }
        } else {
          if (!isMemberIndexingToken(token)) {
            return undefined;
          }
          indexingToken = token.rawValue;
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
  private scriptSoftPath: string;
  
  constructor(document: vscode.TextDocument) {
    this.scriptSoftPath = seFilesystem.uriToSoftpath(document.uri);
    this.parseDocument(document.getText(), this.scriptSoftPath);
  }
  getCompletionInfo(): DocumentCompletionInfo|undefined {
    return this.currentCompletionInfo;
  }
  getCompletionInfoNow(): DocumentCompletionInfo|undefined {
    return this.currentCompletionInfo;
  }
  async onDocumentChanged(e: vscode.TextDocumentChangeEvent) {
    await this.parseDocument(e.document.getText(), seFilesystem.uriToSoftpath(e.document.uri));
  }

  private async parseDocument(documentText: string, documentSoftPath?: string) {
    let result = new DocumentCompletionInfo(documentSoftPath);
    function processTokens(tokens: Array<LuaToken>)
    {
      // if first token in a file is a comment, it may signal the hint mode for the script
      {
        let firstToken = tokens[0];
        let hintModeExplicitelySet = false;
        if (firstToken && firstToken.type === LuaTokenType.Comment) {
          const hintModePrefix = 'HINT_MODE!';
          let commentValue = (firstToken.value as string).trim();
          if (commentValue.startsWith(hintModePrefix)) {
            let hintModes = commentValue.substr(hintModePrefix.length);
            const cvarHintModeKeyword = 'cvar!';
            const macroHintModeKeyword = 'macro!';

            let cvarHintMode = false;
            let macroHintMode = false;

            while (true) {
              if (hintModes.startsWith(cvarHintModeKeyword)) {
                hintModes = hintModes.substr(cvarHintModeKeyword.length);
                cvarHintMode = true;
              } else if (hintModes.startsWith(macroHintModeKeyword)) {
                hintModes = hintModes.substr(macroHintModeKeyword.length);
                macroHintMode = true;
              } else {
                break;
              }
            }
            // if some unexpected word remains, this is considered an error in hint mode specifier
            let remainingModes = hintModes.match(/^\w+/);
            if (remainingModes) {
              hintModeExplicitelySet = false;
              if (!result.warnings) {
                result.warnings = [];
              }
              let errorRange = [firstToken.startLine - 1, firstToken.startCol - 1, firstToken.endLine - 1, firstToken.endCol - 1];
              result.warnings.push(new DocumentParsingError(errorRange, `Error in hint mode specification!\nExpected values: "--HINT_MODE!cvar!macro!" or "--HINT_MODE!cvar!" or "--HINT_MODE!macro!"`));
              hintModeExplicitelySet = false;
            } else {
              hintModeExplicitelySet = true;
              result.cvarHintMode = cvarHintMode;
              result.macroHintMode = macroHintMode;
            }
          }
    }
        // if hint mode is not explicitely set, we will consider world scripts in macro mode only
        if (!hintModeExplicitelySet) {
          // cvar hint mode is off by default for world scripts
          let isWorldScript = !!worldScriptsStorage.getVarInfosForScript(result.documentSoftPath);
          result.cvarHintMode = !isWorldScript;
          // macro mode is always allowed when not specifically hinted
          result.macroHintMode = true;
        }
      }

      for (let token of tokens) {
        // comment tokens can hold type hints
        if (token.type === LuaTokenType.Comment) {
          let comment = token.value as string;
          // we have to be careful not to match a commented out call of a member function, therefore only whitespace is allowed before the end of the comment
          let commentMatch = comment.match(/(\w+)\s*:\s*(\w+)\s*$/);
          if (commentMatch) {
            let varName: string = commentMatch[1];
            let varType: string = commentMatch[2];
            if (helpCompletionInfo.findMacroClassInfo(varType)) {
              result.variables.set(varName, new VariableInfo(varType));
            } else {
              if (!result.warnings) {
                result.warnings = [];
              }
              let errorRange = [token.startLine - 1, token.startCol - 1, token.endLine - 1, token.endCol - 1];
              let errorMessage = `unrecognized type ${varType}`;
              function rangesEqual(rangeA: number[], rangeB: number[]) {
                return rangeA.length === 4 && rangeA.length === rangeB.length && rangeA[0] === rangeB[0]
                  && rangeA[1] === rangeB[1] && rangeA[2] === rangeB[2] && rangeA[3] === rangeB[3];
              }
              if (!result.warnings.find((docParsingError) => docParsingError.message === errorMessage && rangesEqual(docParsingError.range, errorRange))) {
                result.warnings.push(new DocumentParsingError(errorRange, errorMessage));
              }
            }
          }
        }
      }
    }

    function onCreateNodeCallback(node: ParseNode) {
      switch (node.type) {
        case "Identifier":
          let identifier = node as Identifier;
          let varName: string = identifier.name;
          if (!result.variables.get(varName)) {
            result.variables.set(varName, new VariableInfo());
          }
          break;
        case "CallExpression":
          let callExpression = node as CallExpression;
          let funcName;

          if (callExpression.base) {
            if (callExpression.base.type === "MemberExpression") {
              let baseMemberExpression = callExpression.base as MemberExpression;
              funcName = baseMemberExpression.identifier.name;
            } else if (callExpression.base.type === "Identifier") {
              let baseIdentifier = callExpression.base as Identifier;
              funcName = baseIdentifier.name;
            }
          }
          if (funcName) {
            result.functions.add(funcName);
          }
          break;
        case "FunctionDeclaration":
          let funcDecl = node as FunctionDeclaration;
          if (funcDecl.identifier && funcDecl.identifier.type === "Identifier") {
            let funcIdentifier = funcDecl.identifier as Identifier;
            let nodeIdentifier = funcIdentifier.name;
            result.functions.add(nodeIdentifier);
          }
          break;
      }
    }
    let parseOptions = {
      wait: false,
      scope: true,
      locations: true,
      ranges: true,
      errorsNotExceptions: true,
      onCreateNode: onCreateNodeCallback
    };
    try {
      let parseResults = parseLuaSource(documentText, onCreateNodeCallback);
      result.parseResults = parseResults;
      result.tokens = parseResults.tokens;
      processTokens(result.tokens);

      if (parseResults.errors !== undefined) {
        result.errors = [];
        for (let err of parseResults.errors) {
          result.errors.push(new DocumentParsingError([err.line - 1, err.column - 1, err.endLine - 1, err.endColumn - 1], err.message));
        }
      }
    } catch (err) {
      if (result.errors === undefined) {
        result.errors = [];
      }
      result.errors.push(new DocumentParsingError([0, 0, 0, 0], `Unexpected lua parsing error: ${err.message}`));
    }
    // don't let functions be specified in variables
    for (const func of result.functions) {
      result.variables.delete(func);
    }
    this.currentCompletionInfo = result;
  }
  private currentCompletionInfo: DocumentCompletionInfo|undefined = undefined;
}

export function isMemberIndexingChar(char: string) {return char === '.' || char === ':';}

export function isMemberIndexingToken(token: LuaToken) {
  return token.type === LuaTokenType.Punctuator && isMemberIndexingChar(token.rawValue);
}
