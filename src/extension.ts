// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import xml2js = require('xml2js');
import fs = require('fs');
import * as seFilesystem from './sefilesystem';
import {DocumentCompletionHandler, DocumentCompletionInfo} from './documentCompletionHandler';

function unescapeString(s: string)
{
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&apos;/g, "\'");
}

function normalizeXmlValue(s: string) {
  return unescapeString(s).trim();
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

class MacroVarCompletionInfo {
  name: string = "";
  type: string = "";
  briefComment: string = "";
  detailComment: string = "";
}

class MacroFuncCompletionInfo {
  name: string = "";
  returnType: string = "";
  params: string = "";
  briefComment: string = "";
  detailComment: string = "";
}

class MacroClassCompletionInfo {
  name: string = "";
  baseClass: string = "";
  events: string[] = [];
  memberFunctions : MacroFuncCompletionInfo[] = [];
  briefComment: string = "";
}


class HelpCompletionInfo {
  cvars: CvarCompletionInfo[] = [];
  cvarFunctions: CvarFunctionCompletionInfo[] = [];

  macroClasses: MacroClassCompletionInfo[] = [];
  macroFunctions: MacroFuncCompletionInfo[] = [];

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
        } else if (result.HELP.MACROS) {
          this.addMacros(result.HELP.MACROS);
        }
      }
    });
  }

  private addMacroClasses(classes: any) {
    let addClass = (cl: any) => {
      let classInfo = new MacroClassCompletionInfo();
      classInfo.name = cl.NAME;
      classInfo.baseClass = cl.BASE_CLASS;
      classInfo.briefComment = normalizeXmlValue(cl.COMMENT);
      if (cl.FUNCTIONS && cl.FUNCTIONS.FUNCTION) {
        this.addMacroFunctions(cl.FUNCTIONS.FUNCTION, classInfo.memberFunctions);
      }
      this.macroClasses.push(classInfo);
    };

    if (Array.isArray(classes)) {
      for (let cl of classes) {
        addClass(cl);
      }
    } else {
      addClass(classes);
    }
  }

  private addMacroFunctions(functions: any, functionsArray: MacroFuncCompletionInfo[]) {
    let addFunc = (func: any) => {
      let funcInfo = new MacroFuncCompletionInfo();
      funcInfo.name = func.NAME;
      funcInfo.returnType = normalizeXmlValue(func.RETURN);
      funcInfo.params = normalizeXmlValue(func.PARAMS);
      funcInfo.briefComment = normalizeXmlValue(func.BRIEF_COMMENT);
      funcInfo.detailComment = normalizeXmlValue(func.DETAIL_COMMENT);
      functionsArray.push(funcInfo);
    };
    
    if (Array.isArray(functions)) {
      for (let func of functions) {
        addFunc(func);
      }
    } else {
      addFunc(functions);
    }
  }

  private addMacros(macros: any) {
    if (macros.CLASES && macros.CLASSES.CLASS) {
      this.addMacroClasses(macros.CLASSES.CLASS);
    }
    if (macros.FUNCTIONS && macros.FUNCTIONS.FUNCTION) {
      this.addMacroFunctions(macros.FUNCTIONS.FUNCTION, this.macroFunctions);
    }
  }

  private addCvars(cvars: any) {
    let addCvar = (cvar: any) => {
      if (cvar.FUNCTION === "true") {
        let cvarFuncInfo = new CvarFunctionCompletionInfo();
        cvarFuncInfo.name = cvar.NAME;
        cvarFuncInfo.returnType = normalizeXmlValue(cvar.TYPE);
        cvarFuncInfo.briefComment = normalizeXmlValue(cvar.BRIEF_COMMENT);
        cvarFuncInfo.detailComment = normalizeXmlValue(cvar.DETAIL_COMMENT);
        cvarFuncInfo.attributes = cvar.PURITY;
        cvarFuncInfo.params = normalizeXmlValue(cvar.PARAMS);
        this.cvarFunctions.push(cvarFuncInfo);
      } else {
        let cvarInfo = new CvarCompletionInfo();
        cvarInfo.name = cvar.NAME;
        cvarInfo.type = cvar.TYPE;
        cvarInfo.briefComment = normalizeXmlValue(cvar.BRIEF_COMMENT);
        cvarInfo.detailComment = normalizeXmlValue(cvar.DETAIL_COMMENT);
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
    
    this.collectWorkspaceScripts();
    this.collectHelpFiles();
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
    if (vscode.workspace.workspaceFolders) {
      let forFileFunc = (fileUri: vscode.Uri) => {
        this.workspaceScripts.add(seFilesystem.uriToSoftpath(fileUri));
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
  private collectHelpFiles() {
    this.helpCompletionInfo = new HelpCompletionInfo();
    let forEachFileOptions: seFilesystem.ForEachFileOptions = {
      startingDirUri: seFilesystem.softPathToUri("Help/"),
      fileFilter: new Set([".xml"]),
      forFileFunc: (fileUri: vscode.Uri) => {
        this.helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
      }
    };
    seFilesystem.forEachFileRecursive(forEachFileOptions);
  }

  private onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders: vscode.WorkspaceFoldersChangeEvent) {
    this.initWorkspace();
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

    for (let macroFunc of this.helpCompletionInfo.macroFunctions) {
      const varCompletionItem = new vscode.CompletionItem(macroFunc.name);
      varCompletionItem.kind = vscode.CompletionItemKind.Function;
      varCompletionItem.detail = macroFunc.returnType + " " + macroFunc.name + "(" + macroFunc.params + ") ";
      varCompletionItem.documentation = macroFunc.briefComment || macroFunc.detailComment;
      varCompletionItem.insertText = macroFunc.name + "()";
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
