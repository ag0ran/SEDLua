import * as assert from 'assert';
import { parseLuaSource } from '../../luaParser';
import {readTestFile, expectError} from './luaParserTesting';
import { Uri } from 'vscode';
import * as seFilesystem from '../../sefilesystem';
import fs = require('fs');

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
  // disable extensive tests here
  if (true) {
    return;
  }
  let scriptsRoot = 'd:\\work\\main\\Content';
  test('Extensive tests', async function() {
    this.timeout(1e10);
    let numberOfFilesWithErrors = 0;
    let numberOfFilesTested = 0;
    function parseFileAndCheckForErrors(fileUri: Uri) {
      try {
        numberOfFilesTested++;
        let scriptSource = fs.readFileSync(fileUri.fsPath, "utf8");
        let parseResults = parseLuaSource(scriptSource);
        if (parseResults.errors.length > 0) {
          numberOfFilesWithErrors++;
          console.error(`Found ${parseResults.errors.length} errors in ${fileUri.fsPath}:`);
          for (let error of parseResults.errors) {
            console.warn(`[${error.line}, ${error.column}]: ${error.message}`);
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