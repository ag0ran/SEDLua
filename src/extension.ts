// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
let luaparse = require('luaparse');

class DocumentCompletionInfo {
  variables : Set<string> = new Set<string>();
  functions : Set<string> = new Set<string>();
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
              funcName = node.base.identifier.name
            } else if (node.base.name) {
              funcName = node.base.name
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
    // registering as completion provider
    vscode.languages.registerCompletionItemProvider('lua', this, '.', ':', '\"', '\'')
  }

  private getOrCreateDocumentCompletionHandler(document: vscode.TextDocument): DocumentCompletionHandler|undefined {
    if (document.fileName && document.fileName != "") {
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

  private onDidOpenTextDocument(document: vscode.TextDocument) {
    if (document.languageId != "lua") {
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
    if (startOfSoftPath != -1) {
      softPath = softPath.substr(startOfSoftPath + 1);
      return softPath;
    }
    return "";
  }

  // holds completion handlers per document path
  private documentCompletionHandlers: Map<string, DocumentCompletionHandler> = new Map<string, DocumentCompletionHandler>();

  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,
      token: vscode.CancellationToken, context: vscode.CompletionContext
      ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    if (context.triggerCharacter == '"' || context.triggerCharacter == '\'') {
      let scriptCompletionItems: Array<vscode.CompletionItem> = new Array<vscode.CompletionItem>();
      for (const doc of vscode.workspace.textDocuments) {
        if (!doc.fileName.endsWith(".lua") || doc == document) {
          continue;
        }
        let docSoftPath = this.extractContentSoftPath(doc.fileName);
        if (docSoftPath == "") {
          continue;
        }
        let completionItem = new vscode.CompletionItem(docSoftPath)
        completionItem.kind = vscode.CompletionItemKind.File;
        completionItem.documentation = path.basename(docSoftPath) + '\nin '+ path.dirname(docSoftPath);
        scriptCompletionItems.push(completionItem)
      }
      return scriptCompletionItems;
    }

    let completionHandler = this.getOrCreateDocumentCompletionHandler(document);
    if (completionHandler) {
      let completionInfo = completionHandler.getCompletionInfo();
      if (completionInfo) {
        let funcAndVarCompletionItems : Array<vscode.CompletionItem> = new Array<vscode.CompletionItem>();
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
        return funcAndVarCompletionItems;
      }
    }
    return [];
  }
}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
