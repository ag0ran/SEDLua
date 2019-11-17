import * as assert from 'assert';
import { parseLuaSource } from '../../luaParser';
import {readTestFile, expectError} from './luaParserTesting';

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