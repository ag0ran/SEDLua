import * as assert from 'assert';
import {LuaSyntaxError, LuaLexer, LuaTokenType, LuaToken} from "../../luaLexer";
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

function findTokenAfterIdentifierAssignment(tokens: Array<LuaToken>, identifier: string)
{
  let validLength = tokens.length - 2;
  for (let i = 0; i < validLength; i++) {
    let token = tokens[i];
    if (token.type === LuaTokenType.Identifier && token.value === identifier) {
      let nextToken = tokens[i + 1];
      if (nextToken.type !== LuaTokenType.Punctuator || nextToken.value !== '=') {
        continue;
      }
      return tokens[i + 2];
    }
  }
  return undefined;
}

function testNumericLiteralTokenValue(tokens: Array<LuaToken>, identifier: string, value: number)
{
  let token = findTokenAfterIdentifierAssignment(tokens, identifier);
  assert(token);
  token = token!;
  assert(token.type === LuaTokenType.NumericLiteral);
  assert(token.value === value);
}

function testStringLiteralTokenValue(tokens: Array<LuaToken>, identifier: string, value: string)
{
  let token = findTokenAfterIdentifierAssignment(tokens, identifier);
  assert(token);
  token = token!;
  assert(token.type === LuaTokenType.StringLiteral);
  assert(token.value === value);
}

function testLexerErrors()
{
  test('Error reporting and recovery', function() {
    let testFileString = readTestFile("Content/LuaLexer_Errors_00.lua");
    let luaLexer = LuaLexer(testFileString);
    let tokens = new Array<LuaToken>();
    while (true) {
      let token = luaLexer.getNextToken();
      tokens.push(token);
      if (token.type === LuaTokenType.EOF) {
        break;
      }
    }
    assert(luaLexer.errors.length === 7);
    expectError(luaLexer.errors[0], {line: 1, column: 11,
      endColumn: 18, message: "malformed number near '123fg12'"});
    expectError(luaLexer.errors[1], {line: 3, column: 11,
      endColumn: 14, message: "malformed number near '12e'"});
    expectError(luaLexer.errors[2], {line: 5, column: 11,
      endColumn: 13, message: "malformed number near '0x'"});
    expectError(luaLexer.errors[3], {line: 7, column: 11,
      endColumn: 24, message: "malformed number near '122.22.123.67'"});
    expectError(luaLexer.errors[4], {line: 9, column: 11,
      endColumn: 18, message: "malformed number near '122._22'"});
    expectError(luaLexer.errors[5], {line: 11, column: 11, 
      endColumn: 19, message: "malformed number near '122_000_'"});
    expectError(luaLexer.errors[6], {line: 23, column: 8,
      endColumn: 19, message: "unfinished string near 'Bad string'"});

    // let's check that valid tokens have valid value
    testNumericLiteralTokenValue(tokens, "good_a", 123);
    testNumericLiteralTokenValue(tokens, "good_b", 12e12);
    testNumericLiteralTokenValue(tokens, "good_c", 0xfa12af);
    testNumericLiteralTokenValue(tokens, "good_d", 122.22);
    testNumericLiteralTokenValue(tokens, "good_e", 122.2222);
    testNumericLiteralTokenValue(tokens, "good_f", 122000000);

    testStringLiteralTokenValue(tokens, "goodString", "Good string");
  });
}

suite('luaLexer', () => {
  testLexerErrors();
});