import * as vscode from 'vscode';
import { WorldScriptInfo, worldScriptsStorage } from './worldScripts';
import * as path from 'path';
import { softPathToUri } from './sefilesystem';
import { performance } from 'perf_hooks';
import { config } from './configuration';

let lastOpenUri : vscode.Uri|undefined;
let lastOpenTime: number|undefined;

function openUri(uri: vscode.Uri, worldScriptInfo: WorldScriptInfo) {
  let doubleClick = false;
  if (uri === lastOpenUri) {
    let now = performance.now();
    if (lastOpenTime && (now - lastOpenTime) < 500) {
      doubleClick = true;
    }
    lastOpenTime = now;
  } else {
    lastOpenUri = uri;
    lastOpenTime = performance.now();
  }
  // on second open we will open the document instead of previewing it (best we can since we don't know how to determine if item was double clicked)
  //let alreadyOpenEditor = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.path === uri.path);
  let openOptions: vscode.TextDocumentShowOptions = {
    preview: !doubleClick
  };
  vscode.commands.executeCommand('vscode.open', uri, openOptions);
}

class WorldScriptsTreeItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label);
  }
  getChildren(): WorldScriptsTreeItem[] {
    return [];
  }
  onOpenWorldScript() {
  }
  getParent(): WorldScriptsTreeItem|undefined {
    return undefined;
  }
}

class ScriptVariableTreeItem extends WorldScriptsTreeItem {
  constructor(parent: ScriptInstanceTreeItem, varName: string, varType?: string) {
    let label = `${varName} : ${varType}`;
    super(label);
    this.parent = parent;
  }
  getParent() {
    return this.parent;
  }
  private parent: ScriptInstanceTreeItem;
}

class ScriptInstanceTreeItem extends WorldScriptsTreeItem {
  constructor(parent: ScriptTreeItem, worldScriptInfo: WorldScriptInfo) {
    let worldFilename = path.basename(worldScriptInfo.world);
    let label;
    if (worldScriptInfo.stale) {
      label = `[${worldScriptInfo.entityId}] [STALE] ${worldFilename}`;
    } else {
      label = `[${worldScriptInfo.entityId}] ${worldFilename}`;
    }
    super(label);
    this.description = worldFilename;
    this.tooltip = `[ScriptEntityId=${worldScriptInfo.entityId}] ${worldFilename}\n${worldScriptInfo.world}`;
    if (worldScriptInfo.stale) {
      this.tooltip += staleWorldDescription;
    }
    this.worldScriptInfo = worldScriptInfo;
    this.iconPath = worldScriptInfo.stale ? vscode.ThemeIcon.Folder : vscode.ThemeIcon.File;
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

    this.parent = parent;

    this.command = {
      command: 'extension.openWorldScript',
      title: '',
      arguments: [this]
    };
  }
  getChildren() {
    let children = new Array<WorldScriptsTreeItem>();
    this.worldScriptInfo.variables.forEach((variableInfo, variableName) => {
      children.push(new ScriptVariableTreeItem(this, variableName, variableInfo.type));
    });
    return children;
  }
  onOpenWorldScript() {
    if (this.parent.resourceUri) {
      openUri(this.parent.resourceUri, this.worldScriptInfo);
    }
  }
  getParent() {
    return this.parent;
  }
  readonly command: vscode.Command;
  private worldScriptInfo: WorldScriptInfo;
  private parent: ScriptTreeItem;
}

const staleWorldDescription = `\n[STALE]\nThe world was changed in the meantime so script variables may not be up to date\nOpen the world in editor to refresh the script variables.`;

class ScriptTreeItem extends WorldScriptsTreeItem {
  constructor(worldScriptPath: string, worldScriptInfos: Array<WorldScriptInfo>) {
    let filename = path.basename(worldScriptPath);
    super(filename);
    this.description = worldScriptPath;
    let instancesDescription: string;
    let stale = false;
    for (let scriptInfo of worldScriptInfos) {
      if (scriptInfo.stale) {
        stale = true;
        break;
      }
    }
    if (stale) {
      this.label = `[STALE] ${filename}`;
    }
    if (worldScriptInfos.length === 1) {
      let worldScriptInfo = worldScriptInfos[0];
      let worldFilename = path.basename(worldScriptInfo.world);
      instancesDescription = `1 instance: [${worldScriptInfo.entityId}] ${worldFilename}`;
    } else {
      instancesDescription = `${worldScriptInfos.length} instances`;
    }
    this.tooltip = `${this.description}\n${instancesDescription}`;
    if (stale) {
      this.tooltip += staleWorldDescription;
    }

    this.iconPath =vscode.ThemeIcon.File;
    this.resourceUri = softPathToUri(worldScriptPath);
    this.worldScriptInfos = worldScriptInfos;    

    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

    this.command = {
      command: 'extension.openWorldScript',
      title: '',
      arguments: [this]
    };
  }

  getChildren() {
    let children = new Array<WorldScriptsTreeItem>();
     // collect only script instances belonging to last world opened in editor if such option is used and available
     if (config.viewOnlyCurrentWorldScripts && worldScriptsStorage.lastWorldOpenedInEditor) {
      for (let worldScriptInfo of this.worldScriptInfos) {
        if (worldScriptInfo.world === worldScriptsStorage.lastWorldOpenedInEditor) {
          children.push(new ScriptInstanceTreeItem(this, worldScriptInfo));
        }
      }
     } else {
      for (let worldScriptInfo of this.worldScriptInfos) {
        children.push(new ScriptInstanceTreeItem(this, worldScriptInfo));
      }
    }
    return children;
  }

  onOpenWorldScript() {
    if (this.resourceUri && this.worldScriptInfos.length > 0) {
      openUri(this.resourceUri, this.worldScriptInfos[0]);
    }
  }

  private worldScriptInfos: Array<WorldScriptInfo>;
}

class DummyTreeItem extends WorldScriptsTreeItem {
  constructor() {
    super("");
    this.description = "No world scripts loaded";
  }
}


class WorldScriptsViewProvider implements vscode.TreeDataProvider<WorldScriptsTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<WorldScriptsTreeItem|undefined> = new vscode.EventEmitter<WorldScriptsTreeItem|undefined>();
	readonly onDidChangeTreeData: vscode.Event<WorldScriptsTreeItem|undefined> = this._onDidChangeTreeData.event;

  getTreeItem(element: WorldScriptsTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem>
  {
    return element;
  }
  
  getChildren(element?: WorldScriptsTreeItem): vscode.ProviderResult<WorldScriptsTreeItem[]>
  {
    if (element) {
      return element.getChildren();
    }

    let children = new Array<WorldScriptsTreeItem>();
    // collect only scripts belonging to last world opened in editor if such option is used and available
    if (config.viewOnlyCurrentWorldScripts && worldScriptsStorage.lastWorldOpenedInEditor) {
      worldScriptsStorage.worldScripts.forEach((worldScriptInfos: WorldScriptInfo[], scriptPath) => {
        let isScriptInCurrentWorld = worldScriptInfos.findIndex((worldScriptInfo) => worldScriptInfo.world === worldScriptsStorage.lastWorldOpenedInEditor) !== -1;
        if (isScriptInCurrentWorld) {
          children.push(new ScriptTreeItem(scriptPath, worldScriptInfos));
        }
      });
    // otherwise add all the scrits
    } else {
      worldScriptsStorage.worldScripts.forEach((worldScriptInfos: WorldScriptInfo[], scriptPath) => {
        children.push(new ScriptTreeItem(scriptPath, worldScriptInfos));
      });
    }
    if (children.length === 0) {
      children.push(new DummyTreeItem());
    }
    return children;
  }

  getParent?(element: WorldScriptsTreeItem): vscode.ProviderResult<WorldScriptsTreeItem> {
    return element.getParent();
  }


  refresh() {
    this._onDidChangeTreeData.fire();
  }
}

export class WorldScriptsView {
  constructor(context: vscode.ExtensionContext) {
    let treeDataProvider = new WorldScriptsViewProvider();
		this.scriptsTreeView = vscode.window.createTreeView('worldScripts', { treeDataProvider });
    this.treeDataProvider = treeDataProvider;

    vscode.commands.registerCommand('extension.openWorldScript', (treeItem: WorldScriptsTreeItem) => {
      treeItem.onOpenWorldScript();
    });
  }

  refresh() {
    this.treeDataProvider.refresh();
  }

  private treeDataProvider: WorldScriptsViewProvider;
  private scriptsTreeView: vscode.TreeView<WorldScriptsTreeItem>;
}