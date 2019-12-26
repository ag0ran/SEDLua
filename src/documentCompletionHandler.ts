import { LuaToken, LuaTokenType } from './luaLexer';
import { parseLuaSource, LuaParseResults, ParseNode, Comment, MemberExpression, Identifier,
  ParseNodeVisitResult, visitParseNodes, CallExpression, FunctionDeclaration, ForNumericStatement,
  ForGenericStatement, ScopedIdentifierInfo, Block, LocalStatement, Expression, ParseNodeLocation, ElseifClause, VarargLiteral } from './luaParser';
import * as vscode from 'vscode';
import { helpCompletionInfo, MacroFuncCompletionInfo, CvarFunctionCompletionInfo, MacroClassCompletionInfo,
  LuaObjectCompletionInfo, LuaFunctionCompletionInfo, extractLuaParamByIndex, extractMacroParamByIndex,
  MacroClassEvent, 
  LuaFunctionParamCompletionInfo} from './seHelp';
import {worldScriptsStorage} from './worldScripts';
import * as seFilesystem from './sefilesystem';


export class VariableInfo {
  constructor(varType: string) {
    this.type = varType;
  }
  type: string;
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
  constructor (documentText: string, documentSofPath?: string) {
    this.documentText = documentText;
    this.documentSoftPath = documentSofPath || "";
  }
  parseResults?: LuaParseResults;
  documentText: string;

  // Variables hinted the old way (before scope information). Should become obsolete some day.
  hintedVariables: Map<string, VariableInfo> = new Map<string, VariableInfo>();
  tokens: Array<LuaToken> = [];
  error: DocumentParsingError|undefined;
  errors: Array<DocumentParsingError>|undefined;
  warnings: Array<DocumentParsingError>|undefined;
  documentSoftPath: string;
  cvarHintMode = true;
  macroHintMode = true;

  private getVariableInfo(variableName: string): VariableInfo|undefined {
    let variableInfo = this.hintedVariables.get(variableName);
    if (variableInfo && variableInfo.type) {
      return variableInfo;
    }
    let varInfos = worldScriptsStorage.getVarInfosForScript(this.documentSoftPath);
    if (!varInfos) {
      return undefined;
    }
    return varInfos.get(variableName);
  }

  getLocalIdentifierInfoAtOffset(offset: number, name: string): ScopedIdentifierInfo|undefined {
    let localIdentifierInfo: ScopedIdentifierInfo|undefined;
    this.forEachLocalAtOffset(offset, (identifierInfo: ScopedIdentifierInfo) => {
      if (!localIdentifierInfo && identifierInfo.name === name) {
        localIdentifierInfo = identifierInfo;
      }
    });
    return localIdentifierInfo;
  }

  getIdentifierTypeForIdentifierInfo(localIdentifierInfo: ScopedIdentifierInfo|undefined, name: string): string|undefined {
    if (localIdentifierInfo) {
      // hinted type on local identifier has precendence over globally hinted variable type
      if (localIdentifierInfo.typeHinted) {
        return localIdentifierInfo.type;
      }
      // hinted var info has precendence over init type (as we need to support this obsolete way of type hinting for the sake of older scripts)
      let hintedVarInfo = this.hintedVariables.get(name);
      if (hintedVarInfo && hintedVarInfo.type) {
        return hintedVarInfo.type;
      }
      return localIdentifierInfo.type || "";
    }
    let varInfo = this.getVariableInfo(name);
    return varInfo ? varInfo.type : undefined;
  }

  getIdentifierType(identifierOffset: number, name: string): string|undefined {
    let localIdentifierInfo = this.getLocalIdentifierInfoAtOffset(identifierOffset, name);
    return this.getIdentifierTypeForIdentifierInfo(localIdentifierInfo, name);
  }


  forEachVariable(callbackFunc: (variableInfo: VariableInfo, variableName: string) => void) {
    this.hintedVariables.forEach(callbackFunc);
    let varInfos = worldScriptsStorage.getVarInfosForScript(this.documentSoftPath);
    if (varInfos) {
      varInfos.forEach(callbackFunc);
    }
  }

  // Returns value of the comment before parse node
  getCommentTokenBeforeInitParseNode(initParseNode: ParseNode): LuaToken|undefined {
    let locInit = initParseNode.loc;
    // it makes sense to include the token before the identifier in case of local statement or function declaration
    let commentTokenBefore;
    if (initParseNode.type === "FunctionDeclaration" || initParseNode.type === "LocalStatement") {
      let iSearchToken = this.getTokenIndexAtOffset(locInit.rangeStart);
      while (iSearchToken > 1) {
        let searchToken = this.tokens[iSearchToken];
        if (searchToken.endLine < locInit.startLine - 1) {
          break;
        }
        if (searchToken.endLine === locInit.startLine - 1 && searchToken.type === LuaTokenType.Comment) {
          commentTokenBefore = searchToken;
          break;
        }
        iSearchToken--;
      }
    }
    return commentTokenBefore;
  }
  // Returns string showing the initialization of the identifier (including optional comment directly above).
  getIdentifierDefinitionString(identifierInfo: ScopedIdentifierInfo): string|undefined {
    let initParseNode = identifierInfo.initializeParseNode;
    if (!initParseNode) {
      return undefined;
    }
    let locInit = initParseNode.loc;
    // it makes sense to include the token before the identifier in case of local statement or function declaration
    let commentTokenBefore = this.getCommentTokenBeforeInitParseNode(initParseNode);
    let defStart = locInit.rangeStart;
    let defEnd = locInit.rangeEnd;
    let completionInfo = this;
    function updateDefEndBeforeBody(body: Block|undefined, tokenType: LuaTokenType, tokenRawValue: string) {
      if (!body) {
        return;
      }
      let iSearchToken = completionInfo.getTokenIndexAtOffset(body.loc.rangeStart);
        while (iSearchToken > 0) {
          let searchToken = completionInfo.tokens[iSearchToken];
          if (searchToken.type === tokenType && searchToken.rawValue === tokenRawValue) {
            defEnd = searchToken.rangeEnd;
            break;
          }
          if (searchToken.rangeStart < defStart) {
            break;
          }
          iSearchToken--;
        }
    }
    // for function declaration, we want to exclude the function body from the definition string
    if (initParseNode.type === "FunctionDeclaration") {
      let functionDeclaration = initParseNode as FunctionDeclaration;
      updateDefEndBeforeBody(functionDeclaration.body, LuaTokenType.Punctuator, ")");
    } else if (initParseNode.type === "ForNumericStatement") {
      let forStatement = initParseNode as ForNumericStatement;
      updateDefEndBeforeBody(forStatement.body, LuaTokenType.Keyword, "do");
    } else if (initParseNode.type === "ForGenericStatement") {
      let forStatement = initParseNode as ForGenericStatement;
      updateDefEndBeforeBody(forStatement.body, LuaTokenType.Keyword, "do");
    }
    let defString = commentTokenBefore ? commentTokenBefore.rawValue + "\n" : "";
    defString += this.documentText.substring(defStart, defEnd);
    return defString;
  }
  // Calls the provided callback for all local variables available in block at given offset.
  forEachLocalAtOffset(offset: number, callbackFunc: (identifierInfo: ScopedIdentifierInfo) => void) {
    if (!this.parseResults || !this.parseResults.parsedChunk) {
      return;
    }
    function goThroughBlockLocals(parseNode: ParseNode): ParseNodeVisitResult {
      if (!parseNode.loc.containsPos(offset)) {
        return ParseNodeVisitResult.SkipNode;
      }
      // we're interested in going through the block
      if (parseNode.type === "Block") {
        let block = parseNode as Block;
        // since block is processed before its children, we need to visit the children first (as the innermost block takes precendence)
        block.visitChildren(goThroughBlockLocals);

        // now go through block's scope identifiers
        for (let identifierInfo of block.scopeIdentifierInfos) {
          // ignoring identifiers that don't exist at provided offset
          if (identifierInfo.identifier && identifierInfo.identifier.loc.rangeStart > offset) {
            continue;
          }
          callbackFunc(identifierInfo);
        }
        // since we've processed the children, we should skip processing them again so skip this block
        return ParseNodeVisitResult.SkipNode;
      }
      return ParseNodeVisitResult.Continue;
    }
    this.parseResults.parsedChunk.visitChildren(goThroughBlockLocals);
  }

  getTokenIndexAtOffset(offset: number) : number {
    return getTokenIndexAtOffset(this.tokens, offset);
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

  private extractFunctionDeclarationIdentifier(identifier: ParseNode|undefined): string {
    if (!identifier || !(identifier instanceof Identifier)) {
      return "";
    }
    return identifier.name;
  }

  functionDeclarationToLuaFunctionCompletion(functionDeclaration: FunctionDeclaration): LuaFunctionCompletionInfo|undefined {
    let funcCompletionInfo = new LuaFunctionCompletionInfo();
    funcCompletionInfo.name = this.extractFunctionDeclarationIdentifier(functionDeclaration.identifier);
    for (let param of functionDeclaration.parameters) {
      let paramCompletionInfo = new LuaFunctionParamCompletionInfo();
      if (param instanceof Identifier) {
        paramCompletionInfo.name = param.name;
      } else if (param instanceof VarargLiteral) {
        paramCompletionInfo.name = param.rawValue;
      }
      funcCompletionInfo.params.push(paramCompletionInfo);
    }
    let commentTokenBefore = this.getCommentTokenBeforeInitParseNode(functionDeclaration);
    if (commentTokenBefore) {
      funcCompletionInfo.desc = (commentTokenBefore.value as string).trim();
    }
    return funcCompletionInfo;
  }

  // Tries to find a function call of a known function at given offset. Returns the function info and the current parameter index if function is found.
  getFunctionCallInfoAtOffset(offset: number):
    [MacroFuncCompletionInfo|CvarFunctionCompletionInfo|LuaFunctionCompletionInfo, number]|undefined
  {
    let parseResults = this.parseResults;
    if (!parseResults || !parseResults.parsedChunk) {
      return undefined;
    }
    // we need to find the innermost function call parse node that contains provided offset
    let callExpression: CallExpression|undefined;
    let iParameterInsideCallExpression: number;
    function findFunctionCallAtOffsetVisitor(parseNode: ParseNode): ParseNodeVisitResult {
      if (!parseNode.loc.containsPos(offset)) {
        return ParseNodeVisitResult.SkipNode;
      }
      if (parseNode instanceof CallExpression) {
        // offset must be after the base (what is called) to be inside the parameter list (but before the end)
        if (offset > parseNode.base.loc.rangeEnd && offset < parseNode.loc.rangeEnd) {
          // find the parameter the offset is in
          let iParam = 0;
          for (let arg of parseNode.args) {
            if (arg.loc.containsPos(offset)) {
              break;
            }
            if (arg.loc.rangeStart > offset) {
              break;
            }
            iParam++;
          }
          if (iParam > 0 && iParam > parseNode.args.length - 1) {
            iParam = parseNode.args.length - 1;
          }
          iParameterInsideCallExpression = iParam;
          callExpression = parseNode;
        }
      }
      return ParseNodeVisitResult.Continue;
    }

    parseResults.parsedChunk.visitChildren(findFunctionCallAtOffsetVisitor);

    if (!callExpression) {
      return undefined;
    }
    iParameterInsideCallExpression = iParameterInsideCallExpression!;
    let baseExpressionValue = this.resolveMemberExpressionRecursive(callExpression.base);
    if (baseExpressionValue instanceof MacroFuncCompletionInfo
      || baseExpressionValue instanceof CvarFunctionCompletionInfo
      || baseExpressionValue instanceof LuaFunctionCompletionInfo) {
      return [baseExpressionValue, iParameterInsideCallExpression];
    } else if (baseExpressionValue instanceof ScopedIdentifierInfo) {
      let identifierInfo: ScopedIdentifierInfo = baseExpressionValue;
      if (!identifierInfo.initializeParseNode || !(identifierInfo.initializeParseNode instanceof FunctionDeclaration)) {
        return undefined;
      }
      let luaFuncCompletionInfo = this.functionDeclarationToLuaFunctionCompletion(identifierInfo.initializeParseNode);
      if (luaFuncCompletionInfo) {
        return [luaFuncCompletionInfo, iParameterInsideCallExpression];
      } else {
        return undefined;
      }
    } else {
      return undefined;
    }
  }
    
  resolveMemberExpressionRecursive(memberExpressionOrIdentifier: ParseNode|undefined):
    MacroFuncCompletionInfo | CvarFunctionCompletionInfo | MacroClassCompletionInfo | LuaObjectCompletionInfo | LuaFunctionCompletionInfo | MacroClassEvent | undefined
  {
    if (memberExpressionOrIdentifier instanceof Identifier) {
      let identifier: Identifier = memberExpressionOrIdentifier;
      let identifierInfo = this.getLocalIdentifierInfoAtOffset(identifier.loc.rangeStart + 1, identifier.name);
      // if this identifier is a function (initialized in a function declaration as its identifier, not as a param or something else!)
      if (identifierInfo && identifierInfo.initializeParseNode && identifierInfo.initializeParseNode instanceof FunctionDeclaration
          && identifierInfo.identifier === identifierInfo.initializeParseNode.identifier) {
        return this.functionDeclarationToLuaFunctionCompletion(identifierInfo.initializeParseNode);
      }
      let identifierType = this.getIdentifierTypeForIdentifierInfo(identifierInfo, identifier.name);
      if (identifierType !== undefined) {
        return identifierType !== "" ? helpCompletionInfo.findMacroClassInfo(identifierType) : undefined;
      }
      return helpCompletionInfo.findMacroFuncInfo(identifier.name)
        || helpCompletionInfo.findCvarFuncInfo(identifier.name) || helpCompletionInfo.findLuaCompletionInfo(identifier.name);
    } else if (!(memberExpressionOrIdentifier instanceof MemberExpression)) {
      return undefined;
    }
    let memberExpression: MemberExpression = memberExpressionOrIdentifier;
    let baseExpressionValue = this.resolveMemberExpressionRecursive(memberExpression.base);
    if (!baseExpressionValue) {
      return undefined;
    }
    if (baseExpressionValue instanceof MacroClassCompletionInfo) {
      if (memberExpressionOrIdentifier.indexer === ".") {
        return helpCompletionInfo.findMacroClassEvent(baseExpressionValue, memberExpressionOrIdentifier.identifier.name);
      } else if (memberExpressionOrIdentifier.indexer === ":") {
        return helpCompletionInfo.findMacroClassFunction(baseExpressionValue, memberExpressionOrIdentifier.identifier.name);
      } else {
        return undefined;
      }
    } else if (baseExpressionValue instanceof LuaObjectCompletionInfo) {
      return baseExpressionValue.findCompletionInfoByName(memberExpressionOrIdentifier.identifier.name);
    } else {
      return undefined;
    }
  }

  resolveMemberExpressionAtOffset(offset: number):
  VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|LuaObjectCompletionInfo|LuaFunctionCompletionInfo|MacroClassEvent|undefined
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
        // continue, although we have found a member expression, as we might still find a member expression within member expression
        return ParseNodeVisitResult.Continue;
      } else if (parseNode.type === "Identifier") {
        let identifier = parseNode as Identifier;
        let existingMemberExpression = identifierOrMemberExpression && identifierOrMemberExpression.type === "MemberExpression" ? identifierOrMemberExpression as MemberExpression : undefined;
        // identifier may not override already found member expression it is a part of (in that case we need to return the member expression)
        if (!existingMemberExpression || existingMemberExpression.identifier !== identifier) {
          identifierOrMemberExpression = identifier;
        }
        return ParseNodeVisitResult.Stop;
      }
      return ParseNodeVisitResult.Continue;
    }

    this.parseResults.parsedChunk.visitChildren(findIdentifierOrMemberExpressionVisitor);
    let documentCompletionInfo = this;

    if (identifierOrMemberExpression) {
      return this.resolveMemberExpressionRecursive(identifierOrMemberExpression);
    }

    return undefined;
  }

  resolveIndexingExpressionAtToken(iStartingToken: number):
    MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|string|LuaFunctionCompletionInfo|LuaObjectCompletionInfo|ScopedIdentifierInfo|undefined
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
    let lastInfo: MacroClassCompletionInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|LuaFunctionCompletionInfo|LuaObjectCompletionInfo|ScopedIdentifierInfo|string|undefined;
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
          lastInfo = this.getLocalIdentifierInfoAtOffset(token.rangeStart + 1, token.rawValue);
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
    let result = new DocumentCompletionInfo(documentText, documentSoftPath);
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
              result.hintedVariables.set(varName, new VariableInfo(varType));
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
    try {
      let parseResults = parseLuaSource(documentText);
      result.parseResults = parseResults;
      result.tokens = parseResults.tokens;
      processTokens(result.tokens);
      processScopedIdentifiers(result);

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
    this.currentCompletionInfo = result;
  }
  private currentCompletionInfo: DocumentCompletionInfo|undefined = undefined;
}

export function isMemberIndexingChar(char: string) {return char === '.' || char === ':';}

export function isMemberIndexingToken(token: LuaToken) {
  return token.type === LuaTokenType.Punctuator && isMemberIndexingChar(token.rawValue);
}

function processScopedIdentifiers(completionInfo: DocumentCompletionInfo) {
  let parseResults = completionInfo.parseResults!;
  if (!parseResults.parsedChunk) {
    return;
  }

  function getHintedType(identifier: Identifier): string|undefined {
     // check if identifier is followed by a comment token that contains a ":<Typename>"
     let iToken = getTokenIndexAtOffset(parseResults.tokens, identifier.loc.rangeStart + 1);
     let tokenAfter = parseResults.tokens[iToken + 1];
     let hintedType: string|undefined;
     function parsingErrorrRangeFromToken(token: LuaToken) {
       return [token.startLine - 1, token.startCol - 1, token.endLine - 1, token.endCol - 1];
     }
     if (tokenAfter && tokenAfter.type === LuaTokenType.Comment) {
       let matchResults = (tokenAfter.value as string).match(/^\s*: *(\w+)\s*$/);
       if (matchResults && matchResults[1]) {
         hintedType = matchResults[1];
         if (!helpCompletionInfo.findMacroClassInfo(hintedType)) {
           completionInfo.warnings = completionInfo.warnings || [];
           completionInfo.warnings.push(new DocumentParsingError(parsingErrorrRangeFromToken(tokenAfter), `unrecognized type '${hintedType}'`));
         }
       }
     }
     return hintedType;
  }
  // we will go through all scoped identifiers, caching their type
  function goThroughBlockLocals(parseNode: ParseNode): ParseNodeVisitResult {
    // we're interested in going through the block
    if (parseNode.type === "Block") {
      let block = parseNode as Block;
      // now go through block's scope identifiers
      for (let identifierInfo of block.scopeIdentifierInfos) {
        if (!identifierInfo.identifier) {
          continue;
        }
        identifierInfo.type = getHintedType(identifierInfo.identifier);
        if (identifierInfo.type) {
          identifierInfo.typeHinted = true;
        } else {
          identifierInfo.type = resolveIdentifierTypeFromInitialization(identifierInfo, completionInfo);
        }
      }
    }
    return ParseNodeVisitResult.Continue;
  }
  parseResults.parsedChunk.visitChildren(goThroughBlockLocals); 
}

function getTokenIndexAtOffset(tokens: Array<LuaToken>, offset: number): number {
  for (let i = 0; i < tokens.length; i++) {
    let token = tokens[i];
    if (token.rangeStart <= offset && offset <= token.rangeEnd) {
      return i;
    }
    if (token.rangeEnd >= offset) {
      return i - 1;
    }
  }
  return tokens.length - 1;
}

function resolveIdentifierTypeFromInitialization(identifierInfo: ScopedIdentifierInfo, completionInfo: DocumentCompletionInfo) {
  if (!identifierInfo.initializeParseNode) {
    return undefined;
  }
  if (identifierInfo.initializeParseNode instanceof LocalStatement) {
    let localStatement = identifierInfo.initializeParseNode;
    if (!localStatement.init) {
      return undefined;
    }
    let identifierVarIndex = localStatement.variables.findIndex((value:ParseNode) => value === identifierInfo.identifier);
    if (identifierVarIndex !== -1) {
      let identifierInit = localStatement.init[identifierVarIndex];
      if (!identifierInit) {
        return undefined;
      }
      let expressionType = resolveExpressionType(identifierInit, completionInfo);
      return expressionType;
    }
  }
}

function resolveExpressionType(expression: Expression, completionInfo: DocumentCompletionInfo) {
  function resolveType(inType: VariableInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|MacroClassCompletionInfo|LuaObjectCompletionInfo|LuaFunctionCompletionInfo|MacroClassEvent|undefined): string|undefined
  {
    function extractCppType(cppType: string) {
      {
        let matched = cppType.match(/\s*void\s*/);
        if (matched) {
          return undefined;
        }
      }
      {
        let matched = cppType.match(/Handle<\s*(\w+)\s*>/);
        if (matched) {
          return matched[1];
        }
      }
      {
        let matched = cppType.match(/\s*(\w+)\s*\*/);
        if (matched) {
          return matched[1];
        }
      }
      return undefined;
    }
    if (inType instanceof VariableInfo) {
      return inType.type;
    } else if (inType instanceof MacroFuncCompletionInfo) {
      return extractCppType(inType.returnType);
    } else if (inType instanceof CvarFunctionCompletionInfo) {
      return extractCppType(inType.returnType);
    } else if (inType instanceof MacroClassCompletionInfo) {
      return inType.name;
    } else if (inType instanceof LuaObjectCompletionInfo || inType instanceof LuaFunctionCompletionInfo
        || inType instanceof MacroClassEvent) {
      return undefined;
    } else {
      return inType;
    }
  }

  if (expression instanceof CallExpression) {
    let callExpression = expression;
    return resolveType(completionInfo.resolveMemberExpressionRecursive(callExpression.base));
  }
  return undefined;
}
