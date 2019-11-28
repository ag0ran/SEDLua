import * as vscode from 'vscode';

type EditReadOnlyFilesBehavior = "allow edits"|"disable edits"|"disable edits and ask to check out";

export interface Config {
  editReadOnlyFiles: EditReadOnlyFilesBehavior;
  autoOpenLastScriptFromEditor: boolean;
}

export let config: Config = {
  editReadOnlyFiles: "allow edits",
  autoOpenLastScriptFromEditor: true,
};

export function loadConfig() {
  config = Object.assign(config, vscode.workspace.getConfiguration("sedlua"));
}