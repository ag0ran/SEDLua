import * as assert from 'assert';

import * as vscode from 'vscode';
import {LuaTokenType} from '../../luaLexer';
import {DocumentCompletionHandler, DocumentCompletionInfo} from '../../documentCompletionHandler';
import {helpCompletionInfo, HelpCompletionInfo, MacroFuncCompletionInfo, loadHelpCompletionInfo} from '../../seHelp';
import fs = require('fs');
import { softPathToUri, softPathToHardPath } from '../../sefilesystem';
import { ScopedIdentifierInfo } from '../../luaParser';

async function testDocumentParsing() {
  try {
    test('Opening document', async function() {
      let sampleScriptUri = softPathToUri("Content/SignatureTestScript.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let documentCompletionHandler = new DocumentCompletionHandler(textDocument);
      let completionInfo = documentCompletionHandler.getCompletionInfoNow();
      assert(completionInfo, "Error getting completion info");
      completionInfo = completionInfo!;
      {
        let tokenIndexAt_ln2_col16 = completionInfo.getTokenIndexAtOffset(textDocument.offsetAt(new vscode.Position(1, 15)));
        let tokenAt_ln2_col16 = completionInfo.getTokenByIndex(tokenIndexAt_ln2_col16);
        assert(tokenAt_ln2_col16.type === LuaTokenType.Identifier);
        assert(tokenAt_ln2_col16.value === "derivedSampleObject");
      }

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(2, 43)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "AcceptLotsOfParams");
          assert(parameter === 1);
        }
      }

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(5, 27)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "tstGetSampleObject");
          assert(parameter === 0);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(6, 31)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "tstGetSampleObject");
          assert(parameter === 0);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(5, 11)));
        assert(!functionCallInfo);
      }

      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(8, 42)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === "AcceptLotsOfParams");
          assert(parameter === 1);
        }
      }
      {
        let functionCallInfo = completionInfo.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(12, 28)));
        assert(!functionCallInfo);
      }
    });
  } catch (err) {
    assert(false, "Tests failed due to error: " + err.message);
  }
}

class LocalsFinder {
  locals = new Array<String>();
  forEachLocalCallback(identifierInfo: ScopedIdentifierInfo) {
    // identifiers masked by more local identifiers should be ignored
    if (this.locals.indexOf(identifierInfo.name) === -1) {
      this.locals.push(identifierInfo.name);
    }
  }
}

async function testGlobals() {
  try {
    test('Globals and locals parsing', async function() {
      let sampleScriptUri = softPathToUri("Content/GlobalsAndLocals.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let documentCompletionHandler = new DocumentCompletionHandler(textDocument);
      let completionInfo = documentCompletionHandler.getCompletionInfoNow();
      assert(completionInfo, "Error getting completion info");
      completionInfo = completionInfo!;
      assert(completionInfo.parseResults);
      let parseResults = completionInfo.parseResults!;
      // there should be 2 globals total
      assert(parseResults.globals.length === 2);
      // testing locals at offset:
      {
        // right before locC
        let offset = textDocument.offsetAt(new vscode.Position(9, 0));
        let localsFinder = new LocalsFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        assert(localsFinder.locals.length === 2);
        assert(localsFinder.locals[0] === "locA");
        assert(localsFinder.locals[1] === "locB");
      }

      {
        // right after locC
        let offset = textDocument.offsetAt(new vscode.Position(11, 0));
        let localsFinder = new LocalsFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        assert(localsFinder.locals.length === 3);
        assert(localsFinder.locals[0] === "locA");
        assert(localsFinder.locals[1] === "locB");
        assert(localsFinder.locals[2] === "locC");
      }
      {
        // at the start of newGlobal.func
        let offset = textDocument.offsetAt(new vscode.Position(13, 2));
        let localsFinder = new LocalsFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        // 3 locals from outer scope + 3 locals from function parameters
        assert(localsFinder.locals.length === 3 + 3);
        assert(localsFinder.locals[0] === "p0");
        assert(localsFinder.locals[1] === "p1");
        assert(localsFinder.locals[2] === "p2");
        assert(localsFinder.locals[3] === "locA");
        assert(localsFinder.locals[4] === "locB");
        assert(localsFinder.locals[5] === "locC");
        
      }

      {
        // at the end of newGlobal.func
        let offset = textDocument.offsetAt(new vscode.Position(16, 2));
        let localsFinder = new LocalsFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        // 1 local from outer scope + 3 locals from function parameters + 2 locals masking ones from outer scope
        assert(localsFinder.locals.length === 1 + 3 + 2);
        assert(localsFinder.locals[0] === "p0");
        assert(localsFinder.locals[1] === "p1");
        assert(localsFinder.locals[2] === "p2");
        assert(localsFinder.locals[3] === "locA");
        assert(localsFinder.locals[4] === "locB");
        assert(localsFinder.locals[5] === "locC");
      }
    });
  } catch (err) {
    assert(false, "Tests failed due to error: " + err.message);
  }
}

async function testWorldScriptsParsing() {
  test('World scripts parsing', async function() {
    try {

    let scriptDumpFileName = softPathToHardPath("Temp/WorldScripts/ScriptDumpTest.wld.json");
    let scriptDumpString = fs.readFileSync(scriptDumpFileName, "utf8");
    scriptDumpString = scriptDumpString.replace(/^\uFEFF/, '');
    let scriptDumpJson = JSON.parse(scriptDumpString);
    assert(scriptDumpJson);
    } catch (err) {
      assert(false, "Tests failed due to error: " + err.message);
    }
  });
}

suite('Document completion', async () => {
  await testDocumentParsing();
  await testWorldScriptsParsing();
  await testGlobals();
});
