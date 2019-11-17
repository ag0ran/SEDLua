import * as assert from 'assert';
import { parseLuaSource } from '../../luaParser';
import {readTestFile, expectError} from './luaParserTesting';
import { Uri } from 'vscode';
import * as seFilesystem from '../../sefilesystem';
import fs = require('fs');
const spawn = require('child_process').spawn;

function testParserErrors() {
  test('Error in local statement', function() {
    let testFileString = readTestFile("Content/ParsingErrors_UnfinishedLocal.lua");
    let parseResults = parseLuaSource(testFileString);
    assert(parseResults.errors.length === 1);
    expectError(parseResults.errors[0], {line: 3, column: 1, endColumn: 6, message: "<name> expected near 'local'"});
  });
}

function testParserSuccess() {
  test('No parse errors', function() {
    let testFileString = readTestFile("Content/AllFeaturesNoErrors.lua");
    let parseResults = parseLuaSource(testFileString);
    assert(parseResults.errors.length === 0);
  });

  test('Parsing empty script', function() {
      let testFileString = readTestFile("Content/Empty.lua");
      let parseResults = parseLuaSource(testFileString);
      assert(parseResults.errors.length === 0);
  });

  test('Parsing comments only script', function() {
      let testFileString = readTestFile("Content/CommentsOnly.lua");
      let parseResults = parseLuaSource(testFileString);
      assert(parseResults.errors.length === 0);
  });
}

function extensiveParserTests() {
  // run only if enabled in the environment
  if (process.env.runExtensiveTests !== "1") {
    return;
  }
  let workspaceRoot = "d:\\work\\main";
  let scriptsRoot = workspaceRoot + '\\Content';
  let luacPath = workspaceRoot + "\\Tools\\Windows\\lua\\luac5.1.exe";

  async function compileWithLuac(scriptSource: string): Promise<string|undefined> {
    let child = spawn(luacPath, [ '-']);
    return new Promise<string|undefined>((resolve, reject) => {
      let stdErr = "";
      child.stderr.on('data', (data: Uint8Array) => {
        stdErr += `${data}`;
      });
      child.on('close', (code: number) => {
        let result: string|undefined;
        if (stdErr !== "" && stdErr.indexOf('stdin:') === -1) {
          result = undefined;
        } else {
          result = stdErr;
        }
        if (code === 0) {
          result = "";
        }
        resolve(result);
      });
      child.stdin.write(scriptSource);
      child.stdin.end();
    });
  }

  test('Extensive tests', async function() {
    this.timeout(1e10);
    let numberOfFilesWithErrors = 0;
    let numberOfFilesTested = 0;
    async function parseFileAndCheckForErrors(fileUri: Uri) {
      try {
        numberOfFilesTested++;
        let scriptSource = fs.readFileSync(fileUri.fsPath, "utf8");
        // remove BOM character as lua compiler cannot handle it
        if (scriptSource.charCodeAt(0) === 65279) {
          scriptSource = scriptSource.slice(1);
        }
        let parseResults = parseLuaSource(scriptSource);
        let luacResult = await compileWithLuac(scriptSource);
        if (luacResult !== undefined && (parseResults.errors.length === 0) === (luacResult.length > 0)) {
          numberOfFilesWithErrors++;
          if (parseResults.errors.length > 0) {
            console.error(`Found ${parseResults.errors.length} errors in ${fileUri.fsPath} not reported by luac:`);
            for (let error of parseResults.errors) {
              console.warn(`  [${error.line}, ${error.column}]: ${error.message}`);
            }
          } else {
            console.error(`luaParser found no errors in ${fileUri.fsPath}, but luac reported an error:`);
              console.warn(`  ${luacResult}`);
          }
        }
        
      } catch(err) {
        numberOfFilesWithErrors++;
        console.error(`Exception while parsing: ${fileUri.fsPath}\n  ${err.message}`);
      }
    }
    let fileFilter = new Set([".lua"]);
    let forEachFileOptions: seFilesystem.ForEachFileOptions = {
      startingDirUri: Uri.file(scriptsRoot),
      forFileFunc: parseFileAndCheckForErrors,
      fileFilter: fileFilter,
    };
    await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
    
    let resultString = `Extensive tests results: ${numberOfFilesWithErrors} errors in ${numberOfFilesTested} tested files`;
    (numberOfFilesWithErrors > 0 ? console.error : console.log)(resultString);
    assert(numberOfFilesWithErrors === 0);
    assert(numberOfFilesTested > 0);
  });
}

suite('luaParser', () => {
  testParserErrors();
  testParserSuccess();
  extensiveParserTests();
});