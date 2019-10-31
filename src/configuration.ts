import * as vscode from 'vscode';

type EditReadOnlyFilesBehavior = "allow edits"|"disable edits"|"disable edits and ask to check out";

export interface Config {
  editReadOnlyFiles: EditReadOnlyFilesBehavior;
}

export let config: Config = {
  editReadOnlyFiles: "allow edits"
};

export function loadConfig() {
  config = Object.assign(config, vscode.workspace.getConfiguration("sedlua"));
}