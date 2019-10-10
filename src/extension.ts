// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
let luaparse = require('luaparse');
import xml2js = require('xml2js');
import fs = require('fs');
import { type } from 'os';
import { stringify } from 'querystring';

class DocumentCompletionInfo {
  variables: Set<string> = new Set<string>();
  functions: Set<string> = new Set<string>();
}

class CvarCompletionInfo {
  name: string = "";
  type: string = "";
  briefComment: string = "";
  detailComment: string = "";
  attributes: string = "";
}

class CvarFunctionCompletionInfo {
  name: string = "";
  returnType: string = "";
  briefComment: string = "";
  detailComment: string = "";
  attributes: string = "";
  params: string = "";
}

class HelpCompletionInfo {
  cvars: CvarCompletionInfo[] = [];
  cvarFunctions: CvarFunctionCompletionInfo[] = [];

  processedFiles = new Set<string>();

  addHelpFromFile(filePath: string) {
    // making sure each file is processed only once
    if (this.processedFiles.has(filePath)) {
      return;
    }
    this.processedFiles.add(filePath);

    let xml_string = fs.readFileSync(filePath, "utf8");
    const parser = new xml2js.Parser({explicitArray: false});
    parser.parseString(xml_string, (error: any, result: any) => {
      if (error) {
        vscode.window.showErrorMessage(error);
        return;
      }
      if (result.HELP) {
        if (result.HELP.CVARS && result.HELP.CVARS.CVAR) {
          this.addCvars(result.HELP.CVARS.CVAR);
        }
      }
    });
  }

  private addCvars(cvars: any) {
    let addCvar = (cvar: any) => {
      if (cvar.FUNCTION === "true") {
        let cvarFuncInfo = new CvarFunctionCompletionInfo();
        cvarFuncInfo.name = cvar.NAME;
        cvarFuncInfo.returnType = cvar.TYPE;
        cvarFuncInfo.briefComment = cvar.BRIEF_COMMENT;
        cvarFuncInfo.detailComment = cvar.DETAIL_COMMENT;
        cvarFuncInfo.attributes = cvar.PURITY;
        cvarFuncInfo.params = cvar.PARAMS;
        this.cvarFunctions.push(cvarFuncInfo);
      } else {
        let cvarInfo = new CvarCompletionInfo();
        cvarInfo.name = cvar.NAME;
        cvarInfo.type = cvar.TYPE;
        cvarInfo.briefComment = cvar.BRIEF_COMMENT;
        cvarInfo.detailComment = cvar.DETAIL_COMMENT;
        cvarInfo.attributes = cvar.PURITY;
        if (cvar.SAVED === "true") {
          cvarInfo.attributes += cvarInfo.attributes !== "" ? "saved" : " saved";
        }
        this.cvars.push(cvarInfo);
      }
    };
    if (Array.isArray(cvars)) {
      for (let cvar of cvars) {
        addCvar(cvar);
      }
    } else {
      addCvar(cvars);
    }
  }
}

class DocumentCompletionHandler {
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
          result.variables.add(node.name);
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
    let ast = luaparse.parse(documentText, parseOptions);
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
      

    this.collectWorkspaceScripts();

    // registering as completion provider
    vscode.languages.registerCompletionItemProvider('lua', this, '.', ':', '\"', '\'');
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

  private collectWorkspaceScripts()
  {
    this.workspaceScripts.clear();

    if (!vscode.workspace.workspaceFolders) {
      return;
    }

    this.workspaceScripts = new Set<string>();

    let workspaceScripts = this.workspaceScripts;
    const supportedScriptExtensions = [".lua"];

    try {

      let readDirectoryResultFunc = (parentDirUri: vscode.Uri, result: [string, vscode.FileType][]) => {
        for (const fileResult of result) {
          let [fileName, fileType] = fileResult;
          let fileUri = vscode.Uri.file(parentDirUri.path + "/" + fileName);
          if (fileType === vscode.FileType.File) {
            let fileExt = path.extname(fileName);
            // skip unsupported script extensions
            if (supportedScriptExtensions.findIndex(f => fileExt === f) === -1) {
              continue;
            }
            let hardPath = fileUri.fsPath;
            let softPath = this.extractContentSoftPath(hardPath);
            if (softPath !== "") {
              workspaceScripts.add(softPath);
            }
          } else if (fileType === vscode.FileType.Directory) {
            vscode.workspace.fs.readDirectory(fileUri)
            .then(readDirectoryResultFunc.bind(null, fileUri));
          }
        }
      };

      for (const workspaceFolder of vscode.workspace.workspaceFolders) {
        vscode.workspace.fs.readDirectory(workspaceFolder.uri)
          .then(readDirectoryResultFunc.bind(null, workspaceFolder.uri));
      }
    } catch (err) {
      console.log(err.message);
    }
  }

  private onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders: vscode.WorkspaceFoldersChangeEvent) {
    this.collectWorkspaceScripts();
  }

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,
      token: vscode.CancellationToken, context: vscode.CompletionContext
      ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
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

    let completionHandler = this.getOrCreateDocumentCompletionHandler(document);
    if (completionHandler) {
      let completionInfo = completionHandler.getCompletionInfo();
      if (completionInfo) {
        for (const variable of completionInfo.variables) {
					const varCompletionItem = new vscode.CompletionItem(variable);
					varCompletionItem.kind = vscode.CompletionItemKind.Variable;
          funcAndVarCompletionItems.push(varCompletionItem);
        }
        for (const func of completionInfo.functions) {
					const funcCompletionItem = new vscode.CompletionItem(func);
					funcCompletionItem.kind = vscode.CompletionItemKind.Function;
					funcCompletionItem.insertText = func + "()";
					funcCompletionItem.documentation = "This is the " + func + " function. Documentation coming soon";
          funcAndVarCompletionItems.push(funcCompletionItem);
        }
      }
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

    return funcAndVarCompletionItems;
  }
}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
