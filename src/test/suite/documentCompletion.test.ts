import * as assert from 'assert';

import * as vscode from 'vscode';
import {LuaTokenType} from '../../luaLexer';
import {DocumentCompletionInfo, getDocumentCompletionInfo} from '../../documentCompletionHandler';
import {helpCompletionInfo, HelpCompletionInfo, MacroFuncCompletionInfo, loadHelpCompletionInfo, LuaFunctionCompletionInfo} from '../../seHelp';
import fs = require('fs');
import { softPathToUri, softPathToHardPath } from '../../sefilesystem';
import { ScopedIdentifierInfo } from '../../luaParser';

async function testFunctionCallInfo() {
  try {
    test('Function call info', async function() {
      let sampleScriptUri = softPathToUri("Content/SignatureTestScript.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let completionInfo = getDocumentCompletionInfo(textDocument);

      function expectLuaFuncCompletionInfo(line: number, col: number, funcName: string, expectedParamIndex: number) {
        let functionCallInfo = completionInfo!.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(line, col)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof LuaFunctionCompletionInfo);
          assert(funcInfo.name === funcName);
          assert(parameter === expectedParamIndex);
        }
      }

      function expectMacroFuncCompletionInfo(line: number, col: number, funcName: string, expectedParamIndex: number) {
        let functionCallInfo = completionInfo!.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(line, col)));
        assert(functionCallInfo);
        if (functionCallInfo) {
          let [funcInfo, parameter] = functionCallInfo;
          assert(funcInfo instanceof MacroFuncCompletionInfo);
          assert(funcInfo.name === funcName);
          assert(parameter === expectedParamIndex);
        }
      }
      function expectNoFuncCompletionInfo(line: number, col: number) {
        let functionCallInfo = completionInfo!.getFunctionCallInfoAtOffset(textDocument.offsetAt(new vscode.Position(line, col)));
        assert(!functionCallInfo);
      }

      {
        let tokenIndexAt_ln2_col16 = completionInfo.getTokenIndexAtOffset(textDocument.offsetAt(new vscode.Position(1, 15)));
        let tokenAt_ln2_col16 = completionInfo.getTokenByIndex(tokenIndexAt_ln2_col16);
        assert(tokenAt_ln2_col16.type === LuaTokenType.Identifier);
        assert(tokenAt_ln2_col16.value === "derivedSampleObject");
      }

      expectMacroFuncCompletionInfo(2, 43, "AcceptLotsOfParams", 1);

      expectMacroFuncCompletionInfo(5, 27, "tstGetSampleObject", 0);
      expectMacroFuncCompletionInfo(6, 31, "tstGetSampleObject", 0);

      expectNoFuncCompletionInfo(5, 11);

      expectMacroFuncCompletionInfo(8, 42, "AcceptLotsOfParams", 1);

      expectNoFuncCompletionInfo(12, 27);
      expectMacroFuncCompletionInfo(12, 26, "tstGetSampleObject", 0);
      expectMacroFuncCompletionInfo(12, 19, "tstGetSampleObject", 0);

      // function with table constructor as parameter
      expectMacroFuncCompletionInfo(14, 89, "AcceptLotsOfParams", 2);
      
      // function with table constructor as parameter within another function as a parameter to another function
      expectMacroFuncCompletionInfo(21, 93, "AcceptLotsOfParams", 2);

      // no func completion info before opening parenthesis
      expectNoFuncCompletionInfo(22, 42);
      // function with a lot of missing (erroneous params): param 1
      expectMacroFuncCompletionInfo(22, 45, "AcceptLotsOfParams", 1);
      expectMacroFuncCompletionInfo(22, 46, "AcceptLotsOfParams", 1);
      // function with a lot of missing (erroneous params): param 2
      expectMacroFuncCompletionInfo(22, 47, "AcceptLotsOfParams", 2);
      expectMacroFuncCompletionInfo(22, 49, "AcceptLotsOfParams", 2);
      // function with a lot of missing (erroneous params): param 3
      expectMacroFuncCompletionInfo(22, 50, "AcceptLotsOfParams", 3);
      expectMacroFuncCompletionInfo(22, 51, "AcceptLotsOfParams", 3);
      // function with a lot of missing (erroneous params): param 5
      expectMacroFuncCompletionInfo(22, 54, "AcceptLotsOfParams", 5);
      expectMacroFuncCompletionInfo(22, 56, "AcceptLotsOfParams", 5);
      // function with a lot of missing (erroneous params): param 6
      expectMacroFuncCompletionInfo(22, 57, "AcceptLotsOfParams", 6);
      expectMacroFuncCompletionInfo(22, 58, "AcceptLotsOfParams", 6);
      // no func completion info after closing parenthesis
      expectNoFuncCompletionInfo(22, 59);

      // function with a lot of missing (erroneous params): param 0
      expectMacroFuncCompletionInfo(23, 43, "AcceptLotsOfParams", 0);
      expectMacroFuncCompletionInfo(23, 47, "AcceptLotsOfParams", 0);

      // lua function - no params means parameter 0
      expectLuaFuncCompletionInfo(33, 8, "LocFunc", 0);
      // lua function - no params means parameter 0
      expectLuaFuncCompletionInfo(34, 11, "LocFunc", 1);
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
      let completionInfo = getDocumentCompletionInfo(textDocument);
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
      let completionInfo = getDocumentCompletionInfo(textDocument);
      assert(completionInfo.parseResults);
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
      let completionInfo = getDocumentCompletionInfo(textDocument);
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

async function testMemberAssignments()
{
  test('Member assignments', async function() {
    try {
      let sampleScriptUri = softPathToUri("Content/MemberAssignments.lua");
      let textDocument = await vscode.workspace.openTextDocument(sampleScriptUri);  
      assert(textDocument, "Unable to open document");
      let completionInfo = getDocumentCompletionInfo(textDocument);
      assert(completionInfo.parseResults);

      {
        let offset = textDocument.offsetAt(new vscode.Position(11, 13));
        let localsFinder = new LocalsFinder(offset, completionInfo);
        let tInfo = localsFinder.getIdentifierInfo("t");
        assert(tInfo);
        tInfo = tInfo!;
        assert(tInfo.members);
        assert(tInfo.members!.length === 4);
        {
          let memberA = tInfo.getMemberByName("a")!;
          assert(memberA);
          assert(memberA.name === "a");
          assert(memberA.members);
          assert(memberA.members!.length === 5);
          {
            let memberA_x = memberA.getMemberByName("x")!;
            assert(memberA_x);
            assert(memberA_x.name === 'x');
          }
          {
            let memberA_y = memberA.getMemberByName("y")!;
            assert(memberA_y);
            assert(memberA_y.name === 'y');
          }
          {
            let memberA_zee = memberA.getMemberByName("zee")!;
            assert(memberA_zee);
            assert(memberA_zee.name === 'zee');
            assert(memberA_zee.type === "CSampleClass");
            assert(!memberA_zee.typeHinted);
          }
          {
            let memberA_wee = memberA.getMemberByName("wee")!;
            assert(memberA_wee);
            assert(memberA_wee.name === 'wee');
            assert(memberA_wee.type === "CDerivedSampleClass");
            assert(!memberA_wee.typeHinted);
          }
          {
            let memberA_u = memberA.getMemberByName("u")!;
            assert(memberA_u);
            assert(memberA_u.name === 'u');
            assert(memberA_u.type === "CDerivedSampleClass");
            assert(!memberA_u.typeHinted);
          }
        }
        {
          let memberBee = tInfo.getMemberByName("bee")!;
          assert(memberBee);
          assert(memberBee.name === "bee");
          assert(!memberBee.members);
          assert(memberBee.type === "CSampleClass");
          assert(!memberBee.typeHinted);
        }
        {
          let memberCee = tInfo.getMemberByName("cee")!;
          assert(memberCee);
          assert(memberCee.name === "cee");
          assert(!memberCee.members);
          assert(memberCee.type === "CDerivedSampleClass");
          assert(memberCee.typeHinted);
        }
        {
          let memberFunc = tInfo.getMemberByName("func")!;
          assert(memberFunc);
          assert(memberFunc.name === "func");
          assert(!memberFunc.members);
          assert(!memberFunc.type);
          assert(!memberFunc.typeHinted);
        }
        assert(!tInfo.getMemberByName("nonExistant"));
      }
      
    } catch (err) {
      assert(false, "Tests failed due to error: " + err.message);
    }
  });
}

suite('Document completion', async () => {
  await testFunctionCallInfo();
  await testWorldScriptsParsing();
  await testGlobals();
  await testScopedTypes();
  await testMemberExpressionWithinMemberExpression();
  await testMemberAssignments();
});
