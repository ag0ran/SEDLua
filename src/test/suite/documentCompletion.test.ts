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

class LocalsNameFinder {
  locals = new Array<String>();
  forEachLocalCallback(identifierInfo: ScopedIdentifierInfo) {
    // identifiers masked by more local identifiers should be ignored
    if (this.locals.indexOf(identifierInfo.name) === -1) {
      this.locals.push(identifierInfo.name);
    }
  }
}

class LocalsFinder {
  constructor(offset: number, completionInfo: DocumentCompletionInfo) {
    let locals = this.locals;
    function forEachLocalCallback(identifierInfo: ScopedIdentifierInfo) {
      if (!locals.find((value) => value.name === identifierInfo.name)) {
        locals.push(identifierInfo);
      }
    }
    completionInfo.forEachLocalAtOffset(offset, forEachLocalCallback);
  }
  getIdentifierInfo(name: string): ScopedIdentifierInfo|undefined {
    return this.locals.find((value) => value.name === name);
  }
  locals = new Array<ScopedIdentifierInfo>();
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
        let localsFinder = new LocalsNameFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        assert(localsFinder.locals.length === 2);
        assert(localsFinder.locals[0] === "locA");
        assert(localsFinder.locals[1] === "locB");
      }

      {
        // right after locC
        let offset = textDocument.offsetAt(new vscode.Position(11, 0));
        let localsFinder = new LocalsNameFinder();
        completionInfo.forEachLocalAtOffset(offset, localsFinder.forEachLocalCallback.bind(localsFinder));
        assert(localsFinder.locals.length === 3);
        assert(localsFinder.locals[0] === "locA");
        assert(localsFinder.locals[1] === "locB");
        assert(localsFinder.locals[2] === "locC");
      }
      {
        // at the start of newGlobal.func
        let offset = textDocument.offsetAt(new vscode.Position(13, 2));
        let localsFinder = new LocalsNameFinder();
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
        let localsFinder = new LocalsNameFinder();
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

      // getting definition description string 
      {
        let offset = textDocument.offsetAt(new vscode.Position(27, 1));
        let localsFinder = new LocalsFinder(offset, completionInfo);
        assert(localsFinder.locals.length === 5);
        let locFunctionIdentifierInfo = localsFinder.locals[3];
        assert(locFunctionIdentifierInfo.name === "locFunction");
        let locFunctionDefString = completionInfo.getIdentifierDefinitionString(locFunctionIdentifierInfo);
        assert(locFunctionDefString === "-- this is a local function\nlocal function locFunction(a, b, c)");
        let importantHolderIdentifierInfo = localsFinder.locals[4];
        assert(importantHolderIdentifierInfo.name === "importantHolder");
        let importantHolderDefString = completionInfo.getIdentifierDefinitionString(importantHolderIdentifierInfo);
        assert(importantHolderDefString === "-- holds something important\nlocal importantHolder = globals.getImportantStuff()");
      }
    });
  } catch (err) {
    assert(false, "Tests failed due to error: " + err.message);
  }
}

async function testScopedTypes()
{
  test('Scoped types', async function() {
    try {
      let sampleScriptUri = softPathToUri("Content/VarTypes.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let documentCompletionHandler = new DocumentCompletionHandler(textDocument);
      let completionInfo = documentCompletionHandler.getCompletionInfoNow();
      assert(completionInfo, "Error getting completion info");
      completionInfo = completionInfo!;
      assert(completionInfo.parseResults);
      let parseResults = completionInfo.parseResults!;
      // get var types
      {
        let offset = textDocument.offsetAt(new vscode.Position(3, 1));
        let localsFinder = new LocalsFinder(offset, completionInfo);
        {
          let param0Info = localsFinder.getIdentifierInfo("param0");
          assert(param0Info !== undefined);
          param0Info = param0Info!;
          assert(param0Info.identifier !== undefined);
          assert(param0Info.type === "CDerivedSampleClass");
        }
        {
          let subObjectInfo = localsFinder.getIdentifierInfo("subObject");
          assert(subObjectInfo !== undefined);
          subObjectInfo = subObjectInfo!;
          assert(subObjectInfo.identifier !== undefined);
          assert(subObjectInfo.type === "CDerivedSampleClass");
        }
      }
    } catch (err) {
      assert(false, "Tests failed due to error: " + err.message);
    }
  });
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

async function testMemberExpressionWithinMemberExpression()
{
  test('Member expression within member expression', async function() {
    try {
      let sampleScriptUri = softPathToUri("Content/MemberExpressionWithinMemberExpression.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let documentCompletionHandler = new DocumentCompletionHandler(textDocument);
      let completionInfo = documentCompletionHandler.getCompletionInfoNow();
      assert(completionInfo, "Error getting completion info");
      completionInfo = completionInfo!;
      assert(completionInfo.parseResults);

      // testing member function within member expression
      {
        let offset = textDocument.offsetAt(new vscode.Position(3, 10));
        let memberExpressionInfo = completionInfo.resolveMemberExpressionAtOffset(offset);
        assert(memberExpressionInfo !== undefined);
        assert(memberExpressionInfo instanceof MacroFuncCompletionInfo);
        memberExpressionInfo = memberExpressionInfo as MacroFuncCompletionInfo;
        assert(memberExpressionInfo.name === "GetName");
      }
      // testing non-member function within member expression
      {
        let offset = textDocument.offsetAt(new vscode.Position(4, 13));
        let memberExpressionInfo = completionInfo.resolveMemberExpressionAtOffset(offset);
        assert(memberExpressionInfo !== undefined);
        assert(memberExpressionInfo instanceof MacroFuncCompletionInfo);
        memberExpressionInfo = memberExpressionInfo as MacroFuncCompletionInfo;
        assert(memberExpressionInfo.name === "tstGetSampleObject");
      }
    } catch (err) {
      assert(false, "Tests failed due to error: " + err.message);
    }
  });
}

suite('Document completion', async () => {
  await testDocumentParsing();
  await testWorldScriptsParsing();
  await testGlobals();
  await testScopedTypes();
  await testMemberExpressionWithinMemberExpression();
});
