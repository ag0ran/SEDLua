import * as vscode from 'vscode';

export class Log {
  constructor(name: string) {
    this.outputChannel = vscode.window.createOutputChannel(name);
  }
  
  print(text: string) {
    this.outputChannel.append(text);
  }
  
  printLine(text: string) {
    this.outputChannel.appendLine(text);
  }

  showLog() {
    this.outputChannel.show();
  }

  private outputChannel: vscode.OutputChannel;
}

export let log = new Log("SEDLua");
