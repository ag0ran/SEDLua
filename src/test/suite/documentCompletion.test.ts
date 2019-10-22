import * as assert from 'assert';

import * as vscode from 'vscode';
import {DocumentCompletionHandler, DocumentCompletionInfo, TokenInfo} from '../../documentCompletionHandler';
import {HelpCompletionInfo, MacroFuncCompletionInfo} from '../../seHelp';
import fs = require('fs');

function replaceOutWithSrc(inPath: string)
{
  let outPathStart = inPath.lastIndexOf("/out/");
  let slashSymbol = "/";
  if (outPathStart === -1) {
    outPathStart = inPath.lastIndexOf("\\out\\");
    if (outPathStart === -1) {
      return inPath;
    }
    slashSymbol = "\\";
  }

  return inPath.substring(0, outPathStart) + slashSymbol + "src" + slashSymbol + inPath.substring(outPathStart + 5) + slashSymbol;
}

async function testDocumentParsing() {
  try {
    test('Opening document', async function() {
      let baseTestPath = replaceOutWithSrc(__dirname);
      let sampleScriptPath = baseTestPath + "sampleScripts/SignatureTestScript.lua";
      let sampleScriptUri = vscode.Uri.file(sampleScriptPath);
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let documentCompletionHandler = new DocumentCompletionHandler(textDocument);
      let completionInfo = await documentCompletionHandler.getCompletionInfoNow();
      assert(completionInfo, "Error getting completion info");
      completionInfo = completionInfo!;
      {
        let tokenIndexAt_ln2_col16 = completionInfo.getTokenIndexAtOffset(textDocument.offsetAt(new vscode.Position(1, 15)));
        let tokenAt_ln2_col16 = completionInfo.getTokenByIndex(tokenIndexAt_ln2_col16);
        assert(tokenAt_ln2_col16.type === "Identifier");
        assert(tokenAt_ln2_col16.value === "derivedSampleObject");
      }

      let helpCompletionInfo: HelpCompletionInfo = new HelpCompletionInfo();
      helpCompletionInfo.addHelpFromFile(baseTestPath + "sampleHelp/Sample_macros.xml");
      assert(helpCompletionInfo.macroClasses.length === 2);

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(2, 43)), helpCompletionInfo);
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "AcceptLotsOfParams");
          assert(parameter === 1);
        }
      }

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(5, 27)), helpCompletionInfo);
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "tstGetSampleObject");
          assert(parameter === 0);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(6, 31)), helpCompletionInfo);
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "tstGetSampleObject");
          assert(parameter === 0);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(5, 11)), helpCompletionInfo);
        assert(!functionCallInfo);
      }

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(8, 42)), helpCompletionInfo);
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "AcceptLotsOfParams");
          assert(parameter === 1);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(12, 28)), helpCompletionInfo);
        assert(!functionCallInfo);
      }
    });
  } catch (err) {
    assert(false, "Tests failed due to error: " + err.message);
  }
}

async function testWorldScriptsParsing() {
  test('World scripts parsing', async function() {
    try {

    let baseTestPath = replaceOutWithSrc(__dirname);
    let scriptDumpFileName = baseTestPath + "sampleHelp/ScriptDumpTest.wld.json";
    let scriptDumpString = fs.readFileSync(scriptDumpFileName, "utf8");
    scriptDumpString = scriptDumpString.replace(/^\uFEFF/, '');
    let scriptDumpJson = JSON.parse(scriptDumpString);
    assert(scriptDumpJson);
    } catch (err) {
      assert(false, "Tests failed due to error: " + err.message);
    }
  });
}

suite('Document completion', () => {
  testDocumentParsing();
  testWorldScriptsParsing();
});