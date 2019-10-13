// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as seFilesystem from './sefilesystem';
import {DocumentCompletionHandler, DocumentCompletionInfo, TokenInfo} from './documentCompletionHandler';
import {HelpCompletionInfo, MacroFuncCompletionInfo} from './seHelp';

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
    let variableInfo = completionInfo.variables.get(word);
    if (variableInfo && variableInfo.type) {
      let hover = new vscode.Hover(`${word} : ${variableInfo.type}`);
      hover.range = wordRange;
      return hover;
    }
    return new vscode.Hover(word);
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
      classCompletionItem.documentation = new vscode.MarkdownString(
        `class \`${macroClass.name}\`\n\n${macroClass.briefComment}`);
      // (adding a space after the ':' if not there already)
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
        return this.provideCommentCompletionItems(document, position, token, context);
      } else {
        let indexedVarToken: TokenInfo|undefined;
        let indexingChar: string|undefined;
        function isIndexingChar(char: string) {return char === '.' || char === ':';}
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
      funcCompletionItem.insertText = func + "()";
      funcCompletionItem.documentation = "This is the " + func + " function. Documentation coming soon";
      funcAndVarCompletionItems.push(funcCompletionItem);
    }

    for (let cvar of this.helpCompletionInfo.cvars) {
      const varCompletionItem = new vscode.CompletionItem(cvar.name);
      varCompletionItem.kind = vscode.CompletionItemKind.Variable;
      varCompletionItem.detail = cvar.attributes + " cvar " + cvar.type;
      varCompletionItem.documentation = cvar.briefComment || cvar.detailComment;
      funcAndVarCompletionItems.push(varCompletionItem);
    }

    for (let cvarFunc of this.helpCompletionInfo.cvarFunctions) {
      const varCompletionItem = new vscode.CompletionItem(cvarFunc.name);
      varCompletionItem.kind = vscode.CompletionItemKind.Function;
      varCompletionItem.detail = cvarFunc.attributes + " cvar " + cvarFunc.returnType + " " + cvarFunc.name + "(" + cvarFunc.params + ") ";
      varCompletionItem.documentation = cvarFunc.briefComment || cvarFunc.detailComment;
      varCompletionItem.insertText = cvarFunc.name + "()";
      funcAndVarCompletionItems.push(varCompletionItem);
    }

    for (let macroFunc of this.helpCompletionInfo.macroFunctions) {
      const varCompletionItem = createMacroFuncCompletionItem(macroFunc);
      funcAndVarCompletionItems.push(varCompletionItem);
    }

    return funcAndVarCompletionItems;
  }
}

function createMacroFuncCompletionItem(macroFunc: MacroFuncCompletionInfo) {
  const varCompletionItem = new vscode.CompletionItem(macroFunc.name);
  varCompletionItem.kind = vscode.CompletionItemKind.Function;
  varCompletionItem.detail = macroFunc.returnType + " " + macroFunc.name + "(" + macroFunc.params + ") ";
  varCompletionItem.documentation = macroFunc.briefComment || macroFunc.detailComment;
  varCompletionItem.insertText = macroFunc.name + "()";
  return varCompletionItem;
}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
