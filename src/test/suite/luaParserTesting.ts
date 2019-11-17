import * as assert from 'assert';
import fs = require('fs');
import { softPathToUri } from '../../sefilesystem';
import {LuaSyntaxError, LuaTokenType, LuaToken} from "../../luaLexer";

export function readTestFile(filePath: string): string {
  let fileUri = softPathToUri(filePath);
  return fs.readFileSync(fileUri.fsPath, "utf8");
}

export interface ExpectedError {
  line: number;
  column: number;
  message?: string;
  endLine?: number;
  endColumn?: number;
}

export function expectError(errror: LuaSyntaxError, expected: ExpectedError)
{
  assert(errror.line === expected.line);
  assert(errror.column === expected.column);

  assert(expected.message === undefined || errror.message === expected.message);
  assert(errror.endLine === expected.endLine || expected.line);
  assert(expected.endColumn === undefined || errror.endColumn === expected.endColumn);
}