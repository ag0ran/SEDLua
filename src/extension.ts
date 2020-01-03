// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as seFilesystem from './sefilesystem';
import {getDocumentCompletionInfo, DocumentCompletionInfo, isMemberIndexingToken, isMemberIndexingChar} from './documentCompletionHandler';
import {helpCompletionInfo, loadHelpCompletionInfo, HelpCompletionInfo, MacroFuncCompletionInfo, CvarFunctionCompletionInfo,
  CvarCompletionInfo, MacroClassCompletionInfo, LuaFunctionCompletionInfo, LuaObjectCompletionInfo, extractLuaParamByIndex, extractMacroParamByIndex, MacroClassEvent} from './seHelp';
import {log} from "./log";
import fs = require('fs');
import { performance } from 'perf_hooks';
import { worldScriptsStorage, refreshWorldScripts, removeStaleWorldScripts } from './worldScripts';
import { WorldScriptsView } from './worldScriptsView';
import { config, loadConfig} from './configuration';
import { LuaTokenType, LuaToken } from './luaLexer';
import { ScopedIdentifierInfo, ParseNodeLocation } from './luaParser';
const util = require('util');
const exec = util.promisify(require('child_process').exec);

class SEDLua implements vscode.CompletionItemProvider, vscode.DefinitionProvider {
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

    this.worldScriptsView = new WorldScriptsView(context);

    loadConfig();
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(loadConfig));

    this.initWorkspace();

    // registering as completion provider
    context.subscriptions.push(
      vscode.languages.registerCompletionItemProvider('lua', this, '.', ':', '\"', '\''));

    // registering as hover provider
    context.subscriptions.push(
      vscode.languages.registerHoverProvider("lua", this));

    context.subscriptions.push(
      vscode.languages.registerSignatureHelpProvider("lua", this, "("));

    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider("lua", this));
    

    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument(doc => this.diagnosticsCollection.delete(doc.uri))
    );

    context.subscriptions.push(vscode.commands.registerCommand("sedlua.p4CheckOut", this.p4CheckOut));
    context.subscriptions.push(vscode.commands.registerCommand("sedlua.removeStaleWorldScripts", removeStaleWorldScripts));
  }

  // Performs check out on current document
  async p4CheckOut(document?: vscode.TextDocument)
  {
    if (!document) {
      if (!vscode.window.activeTextEditor) {
        return false;
      }
      document = vscode.window.activeTextEditor.document;
      if (!document) {
        return false;
      }
    }
    let checkOutError = "";
    try {
      const { stdout, stderr } = await exec(`p4 edit ${document.fileName}`);
      if (!stderr || stderr === "") {
        log.printLine("Result of perforce command:\n" + stdout);
        return true;
      } else {
        checkOutError = "Error checking out file: " + stderr;
      }
    } catch (err) {
      checkOutError = "Error checking out file: " + err.message;
    }
    if (checkOutError) {
      log.printLine(checkOutError);
      vscode.window.showErrorMessage(checkOutError, {modal: true});
    }
    return false;
  }

  provideSignatureHelp(document: vscode.TextDocument, position: vscode.Position,
    token: vscode.CancellationToken, context: vscode.SignatureHelpContext): vscode.ProviderResult<vscode.SignatureHelp>
  {
    let completionInfo = getDocumentCompletionInfo(document);

    let offset = document.offsetAt(position);
    let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(offset);
    if (!functionCallInfo) {
      return undefined;
    }
    let [funcInfo, iParam] = functionCallInfo;

    let funcSignatureString: string|undefined;
    let language;
    let comment;
    let paramString;
    let paramDesc = ' ';
    if (funcInfo instanceof MacroFuncCompletionInfo) {
      funcSignatureString = getMacroFuncSignatureString(funcInfo);
      language = "c++";
      comment = funcInfo.briefComment || funcInfo.detailComment;
      paramString = extractMacroParamByIndex(funcInfo.params, iParam);
    } else if (funcInfo instanceof CvarFunctionCompletionInfo) {
      funcSignatureString = getCvarFuncSignatureString(funcInfo);
      language = "c++";
      comment = funcInfo.briefComment || funcInfo.detailComment;
      paramString = extractMacroParamByIndex(funcInfo.params, iParam);
    } else if (funcInfo instanceof LuaFunctionCompletionInfo) {
      funcSignatureString = getLuaFuncSignatureString(funcInfo);
      language = "lua";
      comment = funcInfo.desc;
      let paramInfo = extractLuaParamByIndex(funcInfo, iParam);
      if (paramInfo) {
        paramString = paramInfo.name;
        paramDesc = paramInfo.desc;
      }
    } else {
      return undefined;
    }
    let signatureHelp = new vscode.SignatureHelp();
    let signatureInformation = new vscode.SignatureInformation(funcSignatureString);
    signatureInformation.label = funcSignatureString;
    signatureInformation.documentation = createCodeMarkdownWithComment(language, funcSignatureString, comment, '***');
    signatureHelp.signatures.push(signatureInformation);

    if (paramString) {
      let param1 = new vscode.ParameterInformation(paramString);
      param1.documentation = createCodeMarkdownWithComment(language, paramString, paramDesc);
      signatureInformation.parameters.push(param1);
    }
    signatureHelp.activeSignature = 0;
    signatureHelp.activeParameter = 0;
    return signatureHelp;
  }

  provideDefinition(document: vscode.TextDocument, position: vscode.Position, cancellationToken: vscode.CancellationToken): vscode.ProviderResult<vscode.Definition | vscode.DefinitionLink[]> {
    let completionInfo = getDocumentCompletionInfo(document);
    let wordRangeAtPosition = document.getWordRangeAtPosition(position);
    if (!wordRangeAtPosition) {
      return undefined;
    }
    let offset = document.offsetAt(position);
    let iToken = completionInfo.getTokenIndexAtOffset(offset);
    if (iToken === -1) {
      return undefined;
    }
    
    let token = completionInfo.getTokenByIndex(iToken);
    // string literals might be links to other files
    if (token.type === LuaTokenType.StringLiteral) {
      let possibleSoftPath = token.value as string;
      if (seFilesystem.fileExists(possibleSoftPath)) {
        let def = new vscode.Location(seFilesystem.softPathToUri(possibleSoftPath), new vscode.Position(0, 0));
        return def;
      }
      return undefined;
    }

    // find identifier info at offset
    let identifierInfo: ScopedIdentifierInfo|undefined;
    let expressionInfo = completionInfo.resolveMemberExpressionAtOffset(offset, true);
    if (expressionInfo instanceof ScopedIdentifierInfo) {
      identifierInfo = expressionInfo;
    } else if (expressionInfo instanceof LuaObjectCompletionInfo) {
      identifierInfo = expressionInfo.identifierInfo;
    } else if (expressionInfo instanceof LuaFunctionCompletionInfo) {
      identifierInfo = expressionInfo.identifierInfo;
    }
    if (!identifierInfo || !identifierInfo.identifier) {
      return undefined;
    }

    let locationUri;
    if (identifierInfo.definedScriptPath) {
      locationUri = seFilesystem.softPathToUri(identifierInfo.definedScriptPath);
    } else {
      locationUri = document.uri;
    }

    let def = new vscode.Location(locationUri, getParseNodeStartPosition(identifierInfo.identifier.loc));
    return def;
  }
  
  provideHover(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Hover> {
    let completionInfo = getDocumentCompletionInfo(document);
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
    let expressionInfo = completionInfo.resolveMemberExpressionAtOffset(offset);

    function createMacroClassHover(varName: string, macroClassCompletionInfo: MacroClassCompletionInfo) {
      return new vscode.Hover(`${varName} : ${macroClassCompletionInfo.name}`);
    }

    let hover: vscode.Hover|undefined;
    if (expressionInfo instanceof MacroClassCompletionInfo) {
      hover = createMacroClassHover(word, expressionInfo);
    } else if (expressionInfo instanceof MacroFuncCompletionInfo) {
      hover = new vscode.Hover(createCppMarkdownWithComment(getMacroFuncSignatureString(expressionInfo),
        expressionInfo.briefComment || expressionInfo.detailComment));
    } else if (expressionInfo instanceof CvarFunctionCompletionInfo) {
      hover = new vscode.Hover(createCppMarkdownWithComment(getCvarFuncSignatureString(expressionInfo),
        expressionInfo.briefComment || expressionInfo.detailComment));
    } else if (expressionInfo instanceof LuaFunctionCompletionInfo) {
      hover = new vscode.Hover(createLuaMarkdownWithComment(getLuaFuncSignatureString(expressionInfo), expressionInfo.desc));
    } else if (expressionInfo instanceof LuaObjectCompletionInfo) {
      if (expressionInfo.identifierInfo && expressionInfo.identifierInfo.type) {
        let macroClassCompletionInfo = helpCompletionInfo.findMacroClassInfo(expressionInfo.identifierInfo.type);
        if (macroClassCompletionInfo) {
          hover = createMacroClassHover(getLuaObjectDescriptionString(expressionInfo), macroClassCompletionInfo);
        }
      }
      if (!hover) {
        hover = new vscode.Hover(createLuaMarkdownWithComment(getLuaObjectDescriptionString(expressionInfo), expressionInfo.desc));
      }
      if (hover && expressionInfo.identifierInfo) {
        let identifierDefinitionString = completionInfo.getIdentifierDefinitionString(expressionInfo.identifierInfo);
        if (identifierDefinitionString) {
          hover.contents.push(createLuaMarkdownWithComment(identifierDefinitionString));
        }
      }
    } else if (expressionInfo instanceof MacroClassEvent) {
      hover = new vscode.Hover(new vscode.MarkdownString(`(event) ${expressionInfo.macroClass}.${expressionInfo.name}`));
    } else {
      let tokenAtOffset = completionInfo.getTokenByIndex(iTokenAtOffset);
      if (tokenAtOffset.isIdentifier()) {
        // try to find a matching local var
        let localIdentifierInfo = completionInfo.getIdentifierInfoAtOffset(offset, tokenAtOffset.rawValue);
        if (localIdentifierInfo) {
          let identifierMarkdown = new Array<vscode.MarkdownString>();
          if (localIdentifierInfo.type) {
            identifierMarkdown.push(createLuaMarkdownWithComment(`local ${localIdentifierInfo.name} : ${localIdentifierInfo.type}`));
          }
          let defString = completionInfo.getIdentifierDefinitionString(localIdentifierInfo);
          if (defString) {
            identifierMarkdown.push(createLuaMarkdownWithComment(defString));
          }
          if (identifierMarkdown.length > 0) {
            hover = new vscode.Hover(identifierMarkdown);
          }
        }
      }
      
      if (!hover) {
        return undefined;
      }
    }
    hover.range = wordRange;
    return hover;
  }

  private workspaceCheckTimeoutId: NodeJS.Timeout|undefined;
  private worldScriptsView: WorldScriptsView;

  private async workspaceCheckTimeoutCallback() {
    let worldScriptsChanged = await refreshWorldScripts();
    if (worldScriptsChanged) {
      this.worldScriptsView.refresh();
    }
    // if we should auto open last script opened in editor and some script was opened in editor
    if (config.autoOpenLastScriptFromEditor && worldScriptsStorage.lastScriptOpenedInEditor) {
      // we should open it
      let lastScriptUri = seFilesystem.softPathToUri(worldScriptsStorage.lastScriptOpenedInEditor);
      // (clearing so it is not perpetually opened)
      worldScriptsStorage.lastScriptOpenedInEditor = undefined;
      if (fs.existsSync(lastScriptUri.fsPath)) {
        vscode.commands.executeCommand('vscode.open', lastScriptUri);
      }
    }
  }

  private async initWorkspace() {
    if (this.workspaceCheckTimeoutId) {
     clearTimeout(this.workspaceCheckTimeoutId);
    }

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

    await SEDLua.collectHelpFiles();

    this.workspaceCheckTimeoutId = setInterval(this.workspaceCheckTimeoutCallback.bind(this), 1000);
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
            helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
          }
        }
      });
  }

  private isDocumentSupported(document: vscode.TextDocument): boolean
  {
    return document.languageId === "lua";
  }

  private onDidOpenTextDocument(document: vscode.TextDocument) {
    if (!this.isDocumentSupported(document)) {
      return;
    }
    getDocumentCompletionInfo(document);
  }

  private async onDidChangeTextDocument(e: vscode.TextDocumentChangeEvent) {
    if (!this.isDocumentSupported(e.document)) {
      return;
    }

    if (e.contentChanges.length > 0 && config.editReadOnlyFiles !== "allow edits" && e.document.isDirty && isReadOnly(e.document)) {
      let allowEdit = false;
      if (config.editReadOnlyFiles === "disable edits and ask to check out") {
        const checkOutOption = "Check out";
        let option = await vscode.window.showErrorMessage(`${e.document.fileName} is read only.`, {modal: true}, checkOutOption);
        if (option === checkOutOption) {
          allowEdit = await this.p4CheckOut();
        }
      }
      if (!allowEdit) {
        await vscode.commands.executeCommand('workbench.action.files.revert');
      }
    }
    let documentCompletionInfo = await getDocumentCompletionInfo(e.document);
    // update diagnostics (to error or empty)
    let diagnostics: Array<vscode.Diagnostic> = [];
    if (documentCompletionInfo.error) {
      let errorRange = documentCompletionInfo.error.range;
      let diagnosticRange = new vscode.Range(errorRange[0], errorRange[1], errorRange[2], errorRange[3]);
      let diagnostic = new vscode.Diagnostic(diagnosticRange,
        documentCompletionInfo.error.message, vscode.DiagnosticSeverity.Error);
      diagnostics.push(diagnostic);
    }
    
    if (documentCompletionInfo.errors) {
      for (const err of documentCompletionInfo.errors) {
        let errorRange = err.range;
        let diagnosticRange = new vscode.Range(errorRange[0], errorRange[1], errorRange[2], errorRange[3]);
        let diagnostic = new vscode.Diagnostic(diagnosticRange,
          err.message, vscode.DiagnosticSeverity.Error);
        diagnostics.push(diagnostic);
      }
    }

    if (documentCompletionInfo.warnings) {
      for (const err of documentCompletionInfo.warnings) {
        let errorRange = err.range;
        let diagnosticRange = new vscode.Range(errorRange[0], errorRange[1], errorRange[2], errorRange[3]);
        let diagnostic = new vscode.Diagnostic(diagnosticRange,
          err.message, vscode.DiagnosticSeverity.Warning);
        diagnostics.push(diagnostic);
      }
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
  private static async collectHelpFiles() {
    let startTime = performance.now();
    log.printLine("Collecting help files...");
    await loadHelpCompletionInfo();
    let durationSeconds = (performance.now() - startTime)/1000;
    log.printLine("Processed " + helpCompletionInfo.processedFiles.size + " help files in " + durationSeconds.toFixed(1) + " seconds.");
    log.printLine("  Found " + helpCompletionInfo.cvars.length + " cvars, " + helpCompletionInfo.cvarFunctions.length + " cvar functions.");
    log.printLine("  Found " + helpCompletionInfo.macroClasses.length + " macro classes, " + helpCompletionInfo.macroFunctions.length + " macro functions.");
  }

  private onDidChangeWorkspaceFolders(onDidChangeWorkspaceFolders: vscode.WorkspaceFoldersChangeEvent) {
    this.initWorkspace();
  }

  private provideCommentCompletionItems(document: vscode.TextDocument, completionInfo: DocumentCompletionInfo,
    commentToken: LuaToken, position: vscode.Position, cancellationToken: vscode.CancellationToken, context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList>
  {
    // if token is the first token
    if (commentToken === completionInfo.tokens[0]) {
      let commentValue = commentToken.value as string;
      let trimmedCommentValue = commentValue.trim().toUpperCase();
      // if empty comment or part of HINT_MODE
      const hintModePrefix = "HINT_MODE!";
      if (trimmedCommentValue === '' || trimmedCommentValue.length <= hintModePrefix.length
          && trimmedCommentValue.startsWith(hintModePrefix.substr(0, trimmedCommentValue.length))) {
        // complete all possible values of hint mode
        let completionItems = new Array<vscode.CompletionItem>();
        function addHintModeCompletion(hintMode: string) {
          let completionItem = new vscode.CompletionItem(hintMode);
          completionItem.kind = vscode.CompletionItemKind.Value;
          completionItems.push(completionItem);
        }
        addHintModeCompletion('HINT_MODE!cvar!');
        addHintModeCompletion('HINT_MODE!macro!');
        addHintModeCompletion('HINT_MODE!cvar!macro!');
        return completionItems;
      }
    }
    let currentLine = document.lineAt(position.line);
    if (!currentLine) {
      return undefined;
    }
    let currentLineUpToPosition = currentLine.text.substring(0, position.character);
    // match the type hint start in the current line up to current position (the last one up to current position)
    let typeHintMatch = currentLineUpToPosition.match(/\w+\s*:\s*/g);
    if (!typeHintMatch) {
      let commentValue = commentToken.value as string;
      typeHintMatch = commentValue.match(/^\s*:\s*$/);
      if (!typeHintMatch) {
        return undefined;
      }
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
    for (const macroClass of helpCompletionInfo.macroClasses) {
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

    let completionInfo = getDocumentCompletionInfo(document);

    // try to find a token at current offset
    let currentOffset = document.offsetAt(position);
    let currentParseInfo = completionInfo.getParseInfoAroundOffset(currentOffset);
    if (currentParseInfo) {
      // in comment we can auto complete a type definition (<identifier> : <macro class name>)
      let commentToken;
      if (currentParseInfo.token0 && currentParseInfo.token0.type === LuaTokenType.Comment) {
        commentToken = currentParseInfo.token0;
      } else if (currentParseInfo.token1Before && currentParseInfo.token1Before.type === LuaTokenType.Comment
          && currentOffset >= currentParseInfo.token1Before.rangeStart && currentOffset <= currentParseInfo.token1Before.rangeEnd + 1
          && position.line === currentParseInfo.token1Before.endLine) {
        commentToken = currentParseInfo.token1Before;
      }
      if (commentToken) {
        let commentCompletionItems = this.provideCommentCompletionItems(document, completionInfo, commentToken, position, token, context);
        // we only provide comment completion items inside comments
        return commentCompletionItems;
      } else {
        let indexedVarToken: LuaToken|undefined;
        let indexingChar: string|undefined;
        function isMemberIndexingToken_Safe(token: LuaToken|undefined) {return token !== undefined && isMemberIndexingToken(token);}
        if (context.triggerCharacter && isMemberIndexingChar(context.triggerCharacter)) {
          indexingChar = context.triggerCharacter;
          indexedVarToken = currentParseInfo.token1Before;
        } else if (isMemberIndexingToken_Safe(currentParseInfo.token0)) {
          indexingChar = currentParseInfo.token0!.rawValue;
          indexedVarToken = currentParseInfo.token1Before;
        } else if (isMemberIndexingToken_Safe(currentParseInfo.token1Before)) {
          indexingChar = currentParseInfo.token1Before!.rawValue;
          indexedVarToken = currentParseInfo.token2Before;
        }

        if (indexingChar && indexedVarToken) {
          let expressionInfo = completionInfo.resolveMemberExpressionAtOffset(indexedVarToken.rangeEnd - 1);
         
          if (expressionInfo) {
            let classCompletionItems = new Array<vscode.CompletionItem>();
            function addMacroClassCompletionItems(macroClassInfo: MacroClassCompletionInfo) {
              if (indexingChar === ":") {
                helpCompletionInfo.forEachMacroClassFunction(macroClassInfo, (funcInfo) => {
                  let funcCompletionItem = createMacroFuncCompletionItem(funcInfo);
                  classCompletionItems.push(funcCompletionItem);
                });
              } else {
                helpCompletionInfo.forEachMacroClassEvent(macroClassInfo, (event) => {
                  let eventCompletionItem = new vscode.CompletionItem(event);
                  eventCompletionItem.kind = vscode.CompletionItemKind.Event;
                  classCompletionItems.push(eventCompletionItem);
                });
              }
            }
            if (expressionInfo instanceof MacroClassCompletionInfo) {
              addMacroClassCompletionItems(expressionInfo);
            } else if (expressionInfo instanceof LuaObjectCompletionInfo) {
              let luaObjectCompletionInfo : LuaObjectCompletionInfo = expressionInfo;
              if (luaObjectCompletionInfo.identifierInfo && luaObjectCompletionInfo.identifierInfo.type) {
                let macroClassCompletionInfo = helpCompletionInfo.findMacroClassInfo(luaObjectCompletionInfo.identifierInfo.type);
                if (macroClassCompletionInfo) {
                  addMacroClassCompletionItems(macroClassCompletionInfo);
                }
              }
              // when indexing with ':' only functions marked as taking self argument are displayed
              let onlySelf = indexingChar === ':';
              if (!onlySelf) {
                for (let objInfo of luaObjectCompletionInfo.objects) {
                  let objCompletionItem = createLuaObjectCompletionItem(completionInfo, objInfo);
                  classCompletionItems.push(objCompletionItem);
                }
              }
              for (let funcInfo of luaObjectCompletionInfo.functions) {
                let funcCompletionItem = createLuaFuncCompletionItem(funcInfo);
                if (onlySelf !== !!funcInfo.self) {
                  continue;
                }
                classCompletionItems.push(funcCompletionItem);
              }
            }
            return classCompletionItems;
          }
          // if something is indexed but information is not available, the we cannot return globals and locals!
          return undefined;
        }
      }
    }

    // handle completion of function param strings that correspond to parameters that expect a script filename
    if (currentParseInfo && currentParseInfo.token0 && currentParseInfo.token0.type === LuaTokenType.StringLiteral) {
      let funcCallParamAtOffset = completionInfo.getFunctionCallParamInfoAtOffset(currentOffset);
      if (funcCallParamAtOffset && isScriptFilenameParam(funcCallParamAtOffset.name)) {
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
      // no other way for autocompleting string literals for now
      return undefined;
    }

    let funcAndVarCompletionItems = new Array<vscode.CompletionItem>();

    let foundLocals = new Set<string>();
    // collect all locals available at current scope
    completionInfo.forEachLocalAtOffset(currentOffset, (identifierInfo: ScopedIdentifierInfo) => {
      // ignoring locals masked in the innermost scope
      if (foundLocals.has(identifierInfo.name)) {
        return;
      }
      foundLocals.add(identifierInfo.name);
      let completionItem = new vscode.CompletionItem(identifierInfo.name);
      if (identifierInfo.initializeParseNode && identifierInfo.initializeParseNode.type === "FunctionDeclaration") {
        completionItem.kind = vscode.CompletionItemKind.Function;
      } else {
        completionItem.kind = vscode.CompletionItemKind.Variable;
      }
      completionItem.documentation = createIdentifierInfoDocumentation(completionInfo!, identifierInfo.name, "", identifierInfo);
      funcAndVarCompletionItems.push(completionItem);
    });

    // adding only global variable: globals
    {
      let completionItem = new vscode.CompletionItem("globals");
      completionItem.kind = vscode.CompletionItemKind.Variable;
      completionItem.documentation = "Globals table";
      funcAndVarCompletionItems.push(completionItem);
    }
    // adding world script vars
    let mapVarInfos = worldScriptsStorage.getVarInfosForScript(completionInfo.documentSoftPath);
    if (mapVarInfos) {
      mapVarInfos.forEach((varInfo, varName) => {
        let completionItem = new vscode.CompletionItem(varName);
        completionItem.kind = vscode.CompletionItemKind.Variable;
        completionItem.documentation = varInfo.type;
        funcAndVarCompletionItems.push(completionItem);
      });
    }

    // global lua completion
    {
      let luaCompletion = helpCompletionInfo.luaCompletion;
      for (const func of luaCompletion.functions) {
        funcAndVarCompletionItems.push(createLuaFuncCompletionItem(func));
      }
      for (const obj of luaCompletion.objects) {
        funcAndVarCompletionItems.push(createLuaObjectCompletionItem(completionInfo, obj));
      }
    }

    // add cvar completion in cvar hint mode
    if (completionInfo.cvarHintMode) {
      for (let cvar of helpCompletionInfo.cvars) {
        funcAndVarCompletionItems.push(createCvarCompletionItem(cvar));
      }
      for (let cvarFunc of helpCompletionInfo.cvarFunctions) {
        funcAndVarCompletionItems.push(createCvarFuncCompletionItem(cvarFunc));
      }
    }

    // add macro completion in macro hint mode
    if (completionInfo.macroHintMode) {
      for (let macroFunc of helpCompletionInfo.macroFunctions) {
        funcAndVarCompletionItems.push(createMacroFuncCompletionItem(macroFunc));
      }
    }

    return funcAndVarCompletionItems;
  }

  private diagnosticsCollection = vscode.languages.createDiagnosticCollection("SEDLua");
}

function createLuaMarkdownWithComment(luaCode: string, comment?: string) {
  return createCodeMarkdownWithComment("lua", luaCode, comment);
}

function getLuaFuncSignatureString(luaFuncInfo: LuaFunctionCompletionInfo) {
  let baseString = '';
  for (let base = luaFuncInfo.base; base; base = base.base) {
    baseString += `${base.name}.`;
  }
  let paramsString = '';
  for (let param of luaFuncInfo.params) {
    if (paramsString !== '') {
      paramsString += `, ${param.name}`;
    } else {
      paramsString += param.name;
    }
  }
  return `function ${baseString}${luaFuncInfo.name}(${paramsString})`;
}

function createLuaFuncCompletionItem(luaFuncInfo: LuaFunctionCompletionInfo) {
  const completionItem = new vscode.CompletionItem(luaFuncInfo.name);
  completionItem.kind = vscode.CompletionItemKind.Function;
  completionItem.documentation =  completionItem.documentation = createLuaMarkdownWithComment(
    getLuaFuncSignatureString(luaFuncInfo), luaFuncInfo.desc);
  return completionItem;
}

function getLuaObjectDescriptionString(objInfo: LuaObjectCompletionInfo) {
  let result = objInfo.name;
  for (let base = objInfo.base; base; base = base.base) {
    result = `${base.name}.` + result;
  }
  return result;
}

function createIdentifierInfoDocumentation(completionInfo: DocumentCompletionInfo, objName: string, objDesc: string, identifierInfo?: ScopedIdentifierInfo): vscode.MarkdownString {
  let typeDesc = "";
  let desc: string = objDesc;
  if (identifierInfo) {
    if (identifierInfo.type) {
      typeDesc = " : " + identifierInfo.type;
    }
    if (!desc) {
      let identifierDefinitionString = completionInfo.getIdentifierDefinitionString(identifierInfo);
      if (identifierDefinitionString) {
        desc = identifierDefinitionString;
      }
    }
  }
  return createLuaMarkdownWithComment(objName + typeDesc, desc);
}

function createLuaObjectCompletionItem(completionInfo: DocumentCompletionInfo, objInfo: LuaObjectCompletionInfo) {
  const completionItem = new vscode.CompletionItem(objInfo.name);
  completionItem.kind = vscode.CompletionItemKind.Variable;
  completionItem.documentation = createIdentifierInfoDocumentation(completionInfo, getLuaObjectDescriptionString(objInfo), objInfo.desc, objInfo.identifierInfo);
  return completionItem;
}

function createCodeMarkdownWithComment(language: string, code: string, comment?: string, prependMarkdown?: string) {
  let md = new vscode.MarkdownString();
  if (prependMarkdown) {
    md.appendMarkdown(prependMarkdown);
  }
  md.appendCodeblock(code, language);
  if (comment && comment !== "") {
    md.appendMarkdown("***");
    md.appendText("\n" + comment);
  }
  return md;
}

function createCppMarkdownWithComment(cppCode: string, comment?: string) {
  return createCodeMarkdownWithComment("c++", cppCode, comment);
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
  let macroClassPrefix = macroFunc.macroClass ? `${macroFunc.macroClass.name}::` : "";
  return macroFunc.returnType + " " + macroClassPrefix + macroFunc.name + "(" + macroFunc.params + ")";
}

function isReadOnly(document: vscode.TextDocument) {
  try {
    fs.accessSync(document.fileName, fs.constants.W_OK);
    return false;
  } catch (error) {
    // if not accessible, it is read only only if it exists
    return fs.existsSync(document.fileName);
  }
}

function isScriptFilenameParam(name: string) {
  // param name should have 'script' and 'file' or 'path' in it
  return name.match(/script/i) !== null && (name.match(/file/i) !== null || name.match(/path/i) !== null);

}

// Returns start position from parse node location.
function getParseNodeStartPosition(loc: ParseNodeLocation) : vscode.Position {
  // parse node indices are 1 based, while Position is 0 based!
  return new vscode.Position(loc.startLine - 1, loc.startCol - 1);
}

// Called when extension is first activated.
export function activate(context: vscode.ExtensionContext) {
  let sedlua = new SEDLua(context);
}

// Called when extension is deactivated.
export function deactivate() {}
