// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as seFilesystem from './sefilesystem';
import {DocumentCompletionHandler, DocumentCompletionInfo, TokenInfo, VariableInfo, DocumentParsingError} from './documentCompletionHandler';
import {HelpCompletionInfo, MacroFuncCompletionInfo, CvarFunctionCompletionInfo,
  CvarCompletionInfo, MacroClassCompletionInfo} from './seHelp';
import {log} from "./log";
import { stringify } from 'querystring';
import { performance } from 'perf_hooks';
import { start } from 'repl';

class SEDLua implements vscode.CompletionItemProvider {
  constructor(context: vscode.ExtensionContext) {
    // handler for text document open
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(this.onDidOpenTextDocument, this));
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(this.onDidChangeTextDocument, this));
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

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(doc => this.diagnosticsCollection.delete(doc.uri))
    );
  }

  provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp>
  {
    let completionInfo = this.getDocumentCompletionInfo(document);
    if (!completionInfo) {
      return undefined;
    }

    let offset = document.offsetAt(position);
    let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(offset, this.helpCompletionInfo);
    if (!functionCallInfo) {
      return undefined;
    }
    let [funcInfo, iParam] = functionCallInfo;

    let signatureHelp = new vscode.SignatureHelp();
    let funcSignatureString: string|undefined;
    if (funcInfo instanceof MacroFuncCompletionInfo) {
      funcSignatureString = getMacroFuncSignatureString(funcInfo);
    } else if (funcInfo instanceof CvarFunctionCompletionInfo) {
      funcSignatureString = getCvarFuncSignatureString(funcInfo);
    } else {
      return undefined;
    }
    let signatureInformation = new vscode.SignatureInformation(funcSignatureString);
    signatureInformation.label = funcSignatureString;
    signatureInformation.documentation = createCppMarkdownWithComment(funcSignatureString, funcInfo.briefComment || funcInfo.detailComment);
    signatureHelp.signatures.push(signatureInformation);

    let paramString = extractParamByIndex(funcInfo.params, iParam);
    if (paramString) {
      let param1 = new vscode.ParameterInformation(paramString);
      param1.documentation = createCppMarkdownWithComment(paramString);
      signatureInformation.parameters.push(param1);  
    }
    signatureHelp.activeSignature = 0;
    signatureHelp.activeParameter = 0;
    return signatureHelp;
  }
  
  provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
    let completionInfo = this.getDocumentCompletionInfo(document);
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
    let iTokenAtOffset = completionInfo.getTokenIndexAtOffset(offset);
    if (iTokenAtOffset === -1) {
      return undefined;
    }
    let lastInfo = completionInfo.resolveIndexingExpressionAtToken(iTokenAtOffset, this.helpCompletionInfo);

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
    await SEDLua.collectWorkspaceScripts(this.workspaceScripts);

    this.helpCompletionInfo = new HelpCompletionInfo();
    await SEDLua.collectHelpFiles(this.helpCompletionInfo);
  }

  private getDocumentCompletionInfo(document: vscode.TextDocument): DocumentCompletionInfo|undefined {
    let documentCompletionHandler = this.getOrCreateDocumentCompletionHandler(document);
    if (documentCompletionHandler) {
      return documentCompletionHandler.getCompletionInfo();
    }
    return undefined;
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

  private async onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    let documentCompletionHandler = this.getOrCreateDocumentCompletionHandler(e.document);
    if (!documentCompletionHandler) {
      return;
    }
    documentCompletionHandler.onDocumentChanged(e.document);
    let documentCompletionInfo = await documentCompletionHandler.getCompletionInfoNow();
    if (!documentCompletionInfo) {
      return;
    }
    // update diagnostics (to error or empty)
    let diagnostics: Array<vscode.Diagnostic> = [];
    if (documentCompletionInfo.error) {
      let errorRange = documentCompletionInfo.error.range;
      let diagnosticRange = new vscode.Range(errorRange[0], errorRange[1], errorRange[2], errorRange[3]);
      let diagnostic = new vscode.Diagnostic(diagnosticRange,
      documentCompletionInfo.error.message, vscode.DiagnosticSeverity.Error);
      diagnostics = [diagnostic];
    }
    this.diagnosticsCollection.set(e.document.uri, diagnostics);
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

  private static async collectWorkspaceScripts(workspaceScripts: Set<string>)
  {
    log.printLine("Collecting workspace scripts...");
    let startTime = performance.now();
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
        await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
      }
    }
    let durationSeconds = (performance.now() - startTime)/1000;
    log.printLine("Collected " + workspaceScripts.size + " workspace scripts in " + durationSeconds.toFixed(1) + " seconds.");
  }

  // Collects information from all xml help files (cvars and macros).
  private static async collectHelpFiles(helpCompletionInfo: HelpCompletionInfo) {
    let startTime = performance.now();
    log.printLine("Collecting help files...");
    let forEachFileOptions: seFilesystem.ForEachFileOptions = {
      startingDirUri: seFilesystem.softPathToUri("Help/"),
      fileFilter: new Set([".xml"]),
      forFileFunc: (fileUri: vscode.Uri) => {
        helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
      }
    };
    await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
    let durationSeconds = (performance.now() - startTime)/1000;
    log.printLine("Processed " + helpCompletionInfo.processedFiles.size + " help files in " + durationSeconds.toFixed(1) + " seconds.");
    log.printLine("  Found " + helpCompletionInfo.cvars.length + " cvars, " + helpCompletionInfo.cvarFunctions.length + " cvar functions.");
    log.printLine("  Found " + helpCompletionInfo.macroClasses.length + " macro classes, " + helpCompletionInfo.macroFunctions.length + " macro functions.");
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

    let completionInfo = this.getDocumentCompletionInfo(document);
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

  private diagnosticsCollection = vscode.languages.createDiagnosticCollection("SEDLua");
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

function extractParamByIndex(params: string, iParam: number): string|undefined {
  let allParams = params.split(",");
  if (allParams.length === 0 || iParam >= allParams.length || iParam < 0) {
    return undefined;
  }
  let param = allParams[iParam].trim();
  if (param === "void") {
    return undefined;
  }
  return param;
}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
