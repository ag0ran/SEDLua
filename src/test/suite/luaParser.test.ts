import * as assert from 'assert';
import {LuaSyntaxError, LuaTokenType, LuaToken} from "../../luaLexer";
import { parseLuaSource } from '../../luaParser';
import fs = require('fs');
import { softPathToUri } from '../../sefilesystem';

function readTestFile(filePath: string): string {
  let fileUri = softPathToUri(filePath);
  return fs.readFileSync(fileUri.fsPath, "utf8");
}

interface ExpectedError {
  line: number;
  column: number;
  message?: string;
  endLine?: number;
  endColumn?: number;
}

function expectError(errror: LuaSyntaxError, expected: ExpectedError)
{
  assert(errror.line === expected.line);
  assert(errror.column === expected.column);

  assert(expected.message === undefined || errror.message === expected.message);
  assert(errror.endLine === expected.endLine || expected.line);
  assert(expected.endColumn === undefined || errror.endColumn === expected.endColumn);
}

function testParserErrors() {
  test('Error in local statement', function() {
    let testFileString = readTestFile("Content/ParsingErrors_UnfinishedLocal.lua");
    let parseResults = parseLuaSource(testFileString);
    assert(parseResults.errors.length === 1);
    expectError(parseResults.errors[0], {line: 3, column: 1, endColumn: 6, message: "<name> expected near 'local'"});
  });
}

suite('luaParser', () => {
  testParserErrors();
});