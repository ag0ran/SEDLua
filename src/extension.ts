// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as seFilesystem from './sefilesystem';
import {DocumentCompletionHandler, DocumentCompletionInfo, TokenInfo, VariableInfo} from './documentCompletionHandler';
import {HelpCompletionInfo, MacroFuncCompletionInfo, CvarFunctionCompletionInfo,
  CvarCompletionInfo, MacroClassCompletionInfo} from './seHelp';
import { stringify } from 'querystring';

class SEDLua implements vscode.CompletionItemProvider {
  constructor(context: vscode.ExtensionContext) {
    // handler for text document open
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this));
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(this.onDidOChangeTextDocument, this));
    context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(this.onDidChangeWorkspaceFolders, this));

    context.subscriptions.push(
      vscode.commands.registerCommand("extension.showDocumentation", this.showDocumentation, this));

    context.subscriptions.push(
      vscode.commands.registerCommand("extension.loadDocumentation", this.loadDocumentation, this));


    this.initWorkspace();

    // registering as completion provider
    vscode.languages.registerCompletionItemProvider('lua', this, '.', ':', '\"', '\'');

    // registering as hover provider
    vscode.languages.registerHoverProvider("lua", this);

    vscode.languages.registerSignatureHelpProvider("lua", this, "(");
  }

  provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp>
  {
    if (false) {
      let signatureHelp = new vscode.SignatureHelp();
      let signatureInformation = new vscode.SignatureInformation("GenerateRandomFloorPoints(param1, param2)");
      signatureInformation.label = "GenerateRandomFloorPoints(INDEX param1, INDEX param2)";
      signatureInformation.documentation = createCppMarkdownWithComment("BOOL GenerateRandomFloorPoints(param1, param2)", "Generates random points");
      {
        let param1 = new vscode.ParameterInformation("INDEX param1");
        param1.documentation = createCppMarkdownWithComment("INDEX param1", "First parameter");
        signatureInformation.parameters.push(param1);  
      }
      {
        let param2 = new vscode.ParameterInformation("INDEX param2");
        param2.documentation = createCppMarkdownWithComment("INDEX param2", "Second parameter");
        signatureInformation.parameters.push(param2);  
      }
      signatureHelp.signatures.push(signatureInformation);
      signatureHelp.activeSignature = 0;
      signatureHelp.activeParameter = 0;
      return signatureHelp;
    } else {
      return undefined;
    }
  }
  
  provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
    let completionHandler = this.getOrCreateDocumentCompletionHandler(document);
    if (!completionHandler) {
      return undefined;
    }
    let completionInfo = completionHandler.getCompletionInfo();
    if (!completionInfo) {
      return undefined;
    }
    let wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    let word = document.getText(wordRange);
    if (word === "") {
      return undefined;
    }

    let offset = document.offsetAt(position);
    let tokenIndexAtOffset = completionInfo.getTokenIndexAtOffset(offset);
    if (tokenIndexAtOffset === -1) {
      return undefined;
    }
    let tokenAtOffset = completionInfo.getTokenByIndex(tokenIndexAtOffset);
    if (tokenAtOffset.type !== "Identifier") {
      return undefined;
    }
    let tokenChain = [tokenAtOffset];
    let lastTokenIndexing = false;
    for (let tokenIndex = tokenIndexAtOffset - 1; tokenIndex >= 0; tokenIndex--) {
      let token = completionInfo.getTokenByIndex(tokenIndex);
      if (!lastTokenIndexing) {
        if (isIndexingChar(token.value)) {
          lastTokenIndexing = true;
        } else {
          break;
        }
      } else {
        if (token.type !== "Identifier") {
          break;
        }
        lastTokenIndexing = true;
      }
      tokenChain.push(token);
    }

    // going through the token chain in reverse and trying to index the chain up to current token
    let lastInfo: MacroClassCompletionInfo|MacroFuncCompletionInfo|CvarFunctionCompletionInfo|string|undefined;
    let indexWhat: string|undefined;
    while (tokenChain.length > 0) {
      let token = tokenChain.pop();
      if (!lastInfo) {
        let variableInfo = completionInfo.variables.get(token!.value);
        if (variableInfo && variableInfo.type) {
          lastInfo = this.helpCompletionInfo.findMacroClassInfo(variableInfo.type);
        }
        if (!lastInfo) {
          lastInfo = this.helpCompletionInfo.findCvarFuncInfo(token!.value);
          if (!lastInfo) {
            lastInfo = this.helpCompletionInfo.findMacroFuncInfo(token!.value);
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
          if (token!.type !== "Identifier") {
            return undefined;
          }
          if (indexWhat === "Event") {
            let eventName = token!.value;
            if (!this.helpCompletionInfo.findMacroClassEvent(lastInfo, eventName)) {
              return undefined;
            } else {
                lastInfo = `Event ${lastInfo.name}.${eventName}`;
              break;
            }
          } else if (indexWhat === "Function") {
            let functionName = token!.value;
            let funcInfo = this.helpCompletionInfo.findMacroClassFunction(lastInfo, functionName);
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

    let hover: vscode.Hover|undefined;
    if (lastInfo instanceof MacroClassCompletionInfo) {
      hover = new vscode.Hover(`${word} : ${lastInfo.name}`);
    } else if (lastInfo instanceof MacroFuncCompletionInfo) {
      hover = new vscode.Hover(createCppMarkdownWithComment(getMacroFuncSignatureString(lastInfo),
        lastInfo.briefComment || lastInfo.detailComment));
    } else if (typeof(lastInfo) === "string") {
      hover = new vscode.Hover(lastInfo);
      return hover;
    } else if (lastInfo instanceof CvarFunctionCompletionInfo) {
      hover = new vscode.Hover(createCppMarkdownWithComment(getCvarFuncSignatureString(lastInfo),
        lastInfo.briefComment || lastInfo.detailComment));
    } else {
      return undefined;
    }
    hover.range = wordRange;
    return hover;
  }

  private async initWorkspace() {
    let filesystemInitialized = false;
    if (vscode.workspace.workspaceFolders) {
      for (let workspaceFolder of vscode.workspace.workspaceFolders) {
        filesystemInitialized = await seFilesystem.initFilesystem(workspaceFolder.uri);
        if (filesystemInitialized) {
          break;
        }
      }
    }
    if (!filesystemInitialized) {
      return;
    }
    
    this.workspaceScripts = new Set<string>();
    SEDLua.collectWorkspaceScripts(this.workspaceScripts);

    this.helpCompletionInfo = new HelpCompletionInfo();
    SEDLua.collectHelpFiles(this.helpCompletionInfo);
  }

  private getOrCreateDocumentCompletionHandler(document: vscode.TextDocument): DocumentCompletionHandler|undefined {
    if (document.fileName && document.fileName !== "") {
      let completionHandler = this.documentCompletionHandlers.get(document.fileName);
      if (!completionHandler) {
        completionHandler = new DocumentCompletionHandler(document);
        this.documentCompletionHandlers.set(document.fileName, completionHandler);
      }
      return completionHandler;
    } else {
      return undefined;
    }
  }

  private showDocumentation() {
    let webviewPanel = vscode.window.createWebviewPanel("landingPage",
    "SEDLua documentation", vscode.ViewColumn.One,
    {
      retainContextWhenHidden: true,
      enableScripts: true
    });
    webviewPanel.webview.html = "Documentation goes here...";
  }

  private loadDocumentation() {
    let openOptions: vscode.OpenDialogOptions = {filters: {
      'XML files': ['xml'],
      }};
    let docPath = vscode.window.showOpenDialog(openOptions)
      .then(fileUris => {
        if (fileUris) {
          for (let fileUri of fileUris) {
            this.helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
          }
        }
      });
  }

  private onDidOpenTextDocument(document: vscode.TextDocument) {
    if (document.languageId !== "lua") {
      return;
    }
    this.getOrCreateDocumentCompletionHandler(document);
  }

  private onDidOChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    let documentCompletionHandler = this.getOrCreateDocumentCompletionHandler(e.document);
    if (documentCompletionHandler) {
      documentCompletionHandler.onDocumentChanged(e.document);
    }
  }

  private extractContentSoftPath(hardPath: string): string {
    let softPath = hardPath.replace(/\\/g, '/');
    if (softPath.startsWith("Content/")) {
      return softPath;
    }
    let startOfSoftPath = softPath.indexOf("/Content/");
    if (startOfSoftPath !== -1) {
      softPath = softPath.substr(startOfSoftPath + 1);
      return softPath;
    }
    return "";
  }

  // holds completion handlers per document path
  private documentCompletionHandlers: Map<string, DocumentCompletionHandler> = new Map<string, DocumentCompletionHandler>();
  private helpCompletionInfo = new HelpCompletionInfo();

  private workspaceScripts : Set<string> = new Set<string>();

  private static collectWorkspaceScripts(workspaceScripts: Set<string>)
  {
    if (vscode.workspace.workspaceFolders) {
      let forFileFunc = (fileUri: vscode.Uri) => {
        workspaceScripts.add(seFilesystem.uriToSoftpath(fileUri));
      };
      let fileFilter = new Set([".lua"]);
      for (let workspaceFolder of vscode.workspace.workspaceFolders) {
        let forEachFileOptions: seFilesystem.ForEachFileOptions = {
          startingDirUri: workspaceFolder.uri,
          forFileFunc: forFileFunc,
          fileFilter: fileFilter,
        };
        seFilesystem.forEachFileRecursive(forEachFileOptions);
      }
    }
  }

  // Collects information from all xml help files (cvars and macros).
  private static collectHelpFiles(helpCompletionInfo: HelpCompletionInfo) {
    let forEachFileOptions: seFilesystem.ForEachFileOptions = {
      startingDirUri: seFilesystem.softPathToUri("Help/"),
      fileFilter: new Set([".xml"]),
      forFileFunc: (fileUri: vscode.Uri) => {
        helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
      }
    };
    seFilesystem.forEachFileRecursive(forEachFileOptions);
  }

  private onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders: vscode.WorkspaceFoldersChangeEvent) {
    this.initWorkspace();
  }

  private provideCommentCompletionItems(document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList>
  {
    let currentLine = document.lineAt(position.line);
    if (!currentLine) {
      return undefined;
    }
    let currentLineUpToPosition = currentLine.text.substring(0, position.character);
    // match the type hint start in the current line up to current position (the last one up to current position)
    let typeHintMatch = currentLineUpToPosition.match(/\w+\s*:\s*/g);
    if (!typeHintMatch) {
      return undefined;
    }
    let lastMatchString = typeHintMatch[typeHintMatch.length - 1];
    let lastHintStart = currentLineUpToPosition.lastIndexOf(lastMatchString);
    // check if there's a whitespace between the type hint end and the current character
    // (in that case, we're no longer in the type hint)
    let remainingLineUpToPosition = currentLineUpToPosition.substring(lastHintStart + lastMatchString.length);
    if (remainingLineUpToPosition.match(/\s/)) {
      return;
    }
    let classCompletionItems = new Array<vscode.CompletionItem>();
    for (const macroClass of this.helpCompletionInfo.macroClasses) {
      let classCompletionItem = new vscode.CompletionItem(macroClass.name);
      classCompletionItem.kind = vscode.CompletionItemKind.Class;
      classCompletionItem.documentation = createCppMarkdownWithComment(`class ${macroClass.name}`, macroClass.briefComment);
      // (space will be inserted after the ':' if not there already)
      classCompletionItem.insertText = lastMatchString[lastMatchString.length - 1] === ':' ? " " + macroClass.name : macroClass.name;
      classCompletionItems.push(classCompletionItem);
    }
    return classCompletionItems;
  }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,
      token: vscode.CancellationToken, context: vscode.CompletionContext
      ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {

    let completionHandler = this.getOrCreateDocumentCompletionHandler(document);
    if (!completionHandler) {
      return;
    }
    let completionInfo = completionHandler.getCompletionInfo();
    if (!completionInfo) {
      return null;
    }

    // try to find a token at current offset
    let currentOffset = document.offsetAt(position);
    let currentParseInfo = completionInfo.getParseInfoAroundOffset(currentOffset);
    if (currentParseInfo) {
      // in comment we can auto complete a type definition (<identifier> : <macro class name>)
      if (currentParseInfo.token0 && currentParseInfo.token0.type === "Comment"
          || currentParseInfo.token1Before && currentParseInfo.token1Before.type === "Comment") {
        let commentCompletionItems = this.provideCommentCompletionItems(document, position, token, context);
        if (commentCompletionItems) {
          return commentCompletionItems;
        }
      } else {
        let indexedVarToken: TokenInfo|undefined;
        let indexingChar: string|undefined;
        function isIndexingToken(token: TokenInfo|undefined) {return token && isIndexingChar(token.value);}
        if (context.triggerCharacter && isIndexingChar(context.triggerCharacter)) {
          indexingChar = context.triggerCharacter;
          indexedVarToken = currentParseInfo.token1Before;
        } else if (isIndexingToken(currentParseInfo.token0)) {
          indexingChar = currentParseInfo.token0!.value;
          indexedVarToken = currentParseInfo.token1Before;
        } else if (isIndexingToken(currentParseInfo.token1Before)) {
          indexingChar = currentParseInfo.token1Before!.value;
          indexedVarToken = currentParseInfo.token2Before;
        }

        if (indexedVarToken && indexedVarToken.type === "Identifier") {
          let classCompletionItems = new Array<vscode.CompletionItem>();
          let varInfo = completionInfo.variables.get(indexedVarToken.value);
          if (varInfo && varInfo.type) {
            let macroClassInfo = this.helpCompletionInfo.findMacroClassInfo(varInfo.type);
            if (macroClassInfo) {
              if (indexingChar === ":") {
                this.helpCompletionInfo.forEachMacroClassFunction(macroClassInfo, (funcInfo) => {
                  let funcCompletionItem = createMacroFuncCompletionItem(funcInfo);
                  classCompletionItems.push(funcCompletionItem);
                });
              } else {
                this.helpCompletionInfo.forEachMacroClassEvent(macroClassInfo, (event) => {
                  let eventCompletionItem = new vscode.CompletionItem(event);
                  eventCompletionItem.kind = vscode.CompletionItemKind.Event;
                  classCompletionItems.push(eventCompletionItem);
                });
              }
            }
          }
          return classCompletionItems;
        }
      }
    }

    if (context.triggerCharacter === '"' || context.triggerCharacter === '\'') {
      let scriptCompletionItems: Array<vscode.CompletionItem> = new Array<vscode.CompletionItem>();
      function addScriptCompletionItem(softPath: string) {
        let completionItem = new vscode.CompletionItem(softPath);
        completionItem.kind = vscode.CompletionItemKind.File;
        completionItem.documentation = path.basename(softPath) + '\nin '+ path.dirname(softPath);
        scriptCompletionItems.push(completionItem);
      }
      for (const doc of vscode.workspace.textDocuments) {
        if (!doc.fileName.endsWith(".lua") || doc === document) {
          continue;
        }
        let docSoftPath = this.extractContentSoftPath(doc.fileName);
        if (docSoftPath === "") {
          continue;
        }
        addScriptCompletionItem(docSoftPath);
      }

      for (const scriptSoftPath of this.workspaceScripts) {
        addScriptCompletionItem(scriptSoftPath);
      }
      return scriptCompletionItems;
    }

    let funcAndVarCompletionItems = new Array<vscode.CompletionItem>();


    completionInfo.variables.forEach((variableInfo, variableName) => {
      const varCompletionItem = new vscode.CompletionItem(variableName);
      varCompletionItem.kind = vscode.CompletionItemKind.Variable;
      if (variableInfo.type !== undefined) {
        varCompletionItem.detail = variableInfo.type;
      }
      funcAndVarCompletionItems.push(varCompletionItem);
    });
    for (const func of completionInfo.functions) {
      const funcCompletionItem = new vscode.CompletionItem(func);
      funcCompletionItem.kind = vscode.CompletionItemKind.Function;
      funcCompletionItem.documentation = "This is the " + func + " function. Documentation coming soon";
      funcAndVarCompletionItems.push(funcCompletionItem);
    }

    for (let cvar of this.helpCompletionInfo.cvars) {
      funcAndVarCompletionItems.push(createCvarCompletionItem(cvar));
    }

    for (let cvarFunc of this.helpCompletionInfo.cvarFunctions) {
      funcAndVarCompletionItems.push(createCvarFuncCompletionItem(cvarFunc));
    }

    for (let macroFunc of this.helpCompletionInfo.macroFunctions) {
      funcAndVarCompletionItems.push(createMacroFuncCompletionItem(macroFunc));
    }

    return funcAndVarCompletionItems;
  }
}

function createCppMarkdownWithComment(cppCode: string, comment?: string) {
  let md = new vscode.MarkdownString();
  md.appendCodeblock(cppCode, "c++");
  if (comment && comment !== "") {
    md.appendMarkdown("***");
    md.appendText("\n" + comment);
  }
  return md;
}

function createCvarCompletionItem(cvar: CvarCompletionInfo) {
  const completionItem = new vscode.CompletionItem(cvar.name);
  completionItem.kind = vscode.CompletionItemKind.Function;
  completionItem.documentation = createCppMarkdownWithComment(
    cvar.attributes + " cvar " + cvar.type + " " + cvar.name, cvar.briefComment || cvar.detailComment);
  return completionItem;
}

function createCvarFuncCompletionItem(cvarFunc: CvarFunctionCompletionInfo) {
  const completionItem = new vscode.CompletionItem(cvarFunc.name);
  completionItem.kind = vscode.CompletionItemKind.Function;
  completionItem.documentation = createCppMarkdownWithComment(
    getCvarFuncSignatureString(cvarFunc),
    cvarFunc.briefComment || cvarFunc.detailComment);
  return completionItem;
}

function createMacroFuncCompletionItem(macroFunc: MacroFuncCompletionInfo) {
  const completionItem = new vscode.CompletionItem(macroFunc.name);
  completionItem.kind = vscode.CompletionItemKind.Function;
  completionItem.documentation =  completionItem.documentation = createCppMarkdownWithComment(
    getMacroFuncSignatureString(macroFunc),
    macroFunc.briefComment || macroFunc.detailComment);
  return completionItem;
}

function getCvarFuncSignatureString(cvarFunc: CvarFunctionCompletionInfo) {
  return cvarFunc.attributes + " cvar " + cvarFunc.returnType + " " + cvarFunc.name + "(" + cvarFunc.params + ") ";
}

function getMacroFuncSignatureString(macroFunc: MacroFuncCompletionInfo) {
  return macroFunc.returnType + " " + macroFunc.name + "(" + macroFunc.params + ")";
}

function isIndexingChar(char: string) {return char === '.' || char === ':';}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
