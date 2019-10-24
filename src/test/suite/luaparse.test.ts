import * as assert from 'assert';
let luaparse = require('../../luaparse');
import * as vscode from 'vscode';
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

let baseTestPath = replaceOutWithSrc(__dirname);

function readTestFile(filePath: string): string {
  let fileUri =  vscode.Uri.file(baseTestPath + filePath);
  return fs.readFileSync(fileUri.fsPath, "utf8");
}

function expectParseError(parse_error: any, expectedLine: number, expectedCol: number, message?: string)
{
  assert(parse_error.line === expectedLine);
  assert(parse_error.column + 1 === expectedCol);
  if (message) {
    let foundMessage: string = parse_error.message;
    assert(foundMessage.indexOf(message) !== -1);
  }
}

function testParseErrors()
{
  test('Error recovery', function() {
    {
      let parseOptions = {
        wait: false,
        scope: true,
        location: true,
        ranges: true,
        errorsNotExceptions: true,
    };
      let testFileString = readTestFile("sampleScripts/ParsingErrors_00.lua");
      let ast = luaparse.parse(testFileString, parseOptions);
      assert(ast);
      assert(ast.parse_errors);
      assert(ast.parse_errors.length === 2);
      expectParseError(ast.parse_errors[0], 1, 16, "<expression> expected near ','");
      expectParseError(ast.parse_errors[1], 6, 3, "<expression> expected near 'end'");
    }
  });
}

suite('luaparse', () => {
  testParseErrors();
});