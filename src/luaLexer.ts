export enum LuaTokenType {
  Unexpected = -1,
  EOF = 0,
  StringLiteral,
  Keyword,
  Identifier,
  NumericLiteral,
  Punctuator,
  BooleanLiteral,
  NilLiteral,
  VarargLiteral,
  Comment,
}

export let errorStrings = {
  unexpected: 'unexpected %1 \'%2\' near \'%3\'',
  expected: '\'%1\' expected near \'%2\'',
  expectedToken: '%1 expected near \'%2\'', 
  unfinishedString: 'unfinished string near \'%1\'',
  malformedNumber: 'malformed number near \'%1\'', 
  invalidVar: 'invalid left-hand side of assignment near \'%1\'',
  missingLocation: 'Unable to find location near \'%1\'',
};

export class LuaToken {
  constructor(type: LuaTokenType, value: string|number, rawValue: string) {
    this.type = type;
    this.value = value;
    this.rawValue = rawValue;
  }
  type: LuaTokenType = LuaTokenType.Unexpected;
  value: string|number = '';
  rawValue: string = '';
  startLine: number = 0;
  startCol: number = 0;
  endLine: number = 0;
  endCol: number = 0;
  rangeStart: number = 0;
  rangeEnd: number = 0;

  // Checks whether token is a keyword with and optional value.
  isKeyword(rawValue?: string): boolean {
    return this.isOfTypeWithValue(LuaTokenType.Keyword, rawValue);
  }
  // Checks whether token is a punctuator with and optional value.
  isPunctuator(rawValue?: string): boolean {
    return this.isOfTypeWithValue(LuaTokenType.Punctuator, rawValue);
  }
  // Checks whether token is an identifier with optional value.
  isIdentifier(rawValue?: string): boolean {
    return this.isOfTypeWithValue(LuaTokenType.Identifier, rawValue);
  }
  private isOfTypeWithValue(type: LuaTokenType, rawValue?: string) {
    if (this.type !== type) {
      return false;
    }
    return !rawValue ? true : this.rawValue === rawValue;
  }
}

export interface LuaSyntaxError {
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}


export interface LuaLexer {
  getNextToken(): LuaToken;
  raiseError(token: LuaToken, ...args: any[]): void;
  reset(): void;
  readonly errors: Array<LuaSyntaxError>;
}

export function LuaLexer(inputSource: string): LuaLexer {
  let input: string = inputSource;
  let index = 0;
  let line = 1;
  let lineStart = 0;
  let length = input.length;
  let errors = new Array<LuaSyntaxError>();
  let tabChars = 2;

  function countColumnsInRange(rangeStart: number, rangeEnd: number)
  {
    // columns are one-based
    let columns = 1;
    if (rangeEnd > input.length) {
      rangeEnd = input.length;
    }
    for (let i = rangeStart; i < rangeEnd; i++) {
      let charCode = input.charCodeAt(i);
      if (isLineTerminator(charCode)) {
        continue;
      }
      if (charCode === 9) {
        columns += tabChars;
        continue;
      }
      columns++;
    }
    return columns;
  }

  function raiseError(token: LuaToken|undefined, errorFormat: string, ...args: string[]) {
    let message = sprintf(errorFormat, ...args);
    let error = {
      message: sprintf(errorFormat, ...args),
      line: 0,
      column: 0,
      endLine: 0,
      endColumn: 0,
    };
    if (token) {
      error.line = token.startLine;
      error.column = token.startCol;
      error.endLine = token.endLine;
      error.endColumn = token.endCol;
    } else {
      error.column = countColumnsInRange(lineStart, index);
      error.endLine = error.line = line;
      error.endColumn = error.column;
    }
    errors.push(error);
  }

  function CreateToken(type: LuaTokenType, value: string|number, rawValue: string,
      startLine: number, tokenLineStart: number, rangeStart: number, rangeEnd: number) : LuaToken {
    let token = new LuaToken(type, value, rawValue);
    token.startLine = startLine;
    // start column is the number of columns from the start line range at token start until the token range start
    token.startCol = countColumnsInRange(tokenLineStart, rangeStart);
    token.endLine = line;
    // end column is the number of columns from the current line start range until the token range end
    token.endCol = countColumnsInRange(lineStart, rangeEnd);

    token.rangeStart = rangeStart;
    token.rangeEnd = rangeEnd;
    return token;
  }

  // Whitespace has no semantic meaning in lua so simply skip ahead while
  // tracking the encounted newlines. Any kind of eol sequence is counted as a
  // single line.
  function consumeEOL() {
    var charCode = input.charCodeAt(index)
      , peekCharCode = input.charCodeAt(index + 1);

    if (isLineTerminator(charCode)) {
      // Count \n\r and \r\n as one newline.
      if (10 === charCode && 13 === peekCharCode) {
        index++;
      }
      if (13 === charCode && 10 === peekCharCode) {
        index++;
      }
      line++;
      lineStart = ++index;
      return true;
    }
    return false;
  }

  function skipWhiteSpace() {
    while (index < length) {
      var charCode = input.charCodeAt(index);
      if (isWhiteSpace(charCode)) {
        index++;
      } else if (!consumeEOL()) {
        break;
      }
    }
  }

  // Read a multiline string by calculating the depth of `=` characters and
  // then appending until an equal depth is found.
  function readLongString(): string|undefined {
    let level = 0;
    let content = '';
    let terminator = false;
    let character;
    let stringStart;

    index++; // [

    // Calculate the depth of the comment.
    while ('=' === input.charAt(index + level)) {
      level++;
    }
    // Exit, this is not a long string afterall.
    if ('[' !== input.charAt(index + level)) {
      return undefined;
    }

    index += level + 1;

    // If the first character is a newline, ignore it and begin on next line.
    if (isLineTerminator(input.charCodeAt(index))) {
      consumeEOL();
    }

    stringStart = index;
    while (index < length) {
      // To keep track of line numbers run the `consumeEOL()` which increments
      // its counter.
      if (isLineTerminator(input.charCodeAt(index))) {
        consumeEOL();
      }

      character = input.charAt(index++);

      // Once the delimiter is found, iterate through the depth count and see
      // if it matches.
      if (']' === character) {
        terminator = true;
        for (var i = 0; i < level; i++) {
          if ('=' !== input.charAt(index + i)) {
            terminator = false;
          }
        }
        if (']' !== input.charAt(index + level)) {
          terminator = false;
        }
      }

      // We reached the end of the multiline string. Get out now.
      if (terminator) {
        break;
      }
    }
    content += input.slice(stringStart, index - 1);
    index += level + 1;

    return content;
  }

  // Translate escape sequences to the actual characters.
  function readEscapeSequence() {
    var sequenceStart = index;
    switch (input.charAt(index)) {
      // Lua allow the following escape sequences.
      // We don't escape the bell sequence.
      case 'n': index++; return '\n';
      case 'r': index++; return '\r';
      case 't': index++; return '\t';
      case 'v': index++; return '\x0B';
      case 'b': index++; return '\b';
      case 'f': index++; return '\f';
      // Skips the following span of white-space.
      case 'z': index++; skipWhiteSpace(); return '';
      // Byte representation should for now be returned as is.
      case 'x':
        // \xXX, where XX is a sequence of exactly two hexadecimal digits
        if (isHexDigit(input.charCodeAt(index + 1)) &&
          isHexDigit(input.charCodeAt(index + 2))) {
          index += 3;
          // Return it as is, without translating the byte.
          return '\\' + input.slice(sequenceStart, index);
        }
        return '\\' + input.charAt(index++);
      default:
        // \ddd, where ddd is a sequence of up to three decimal digits.
        if (isDecDigit(input.charCodeAt(index))) {
          while (isDecDigit(input.charCodeAt(++index))) {}
          return '\\' + input.slice(sequenceStart, index);
        }
        // Simply return the \ as is, it's not escaping any sequence.
        return input.charAt(index++);
    }
  }

  function scanComment() {
    let tokenStart = index;
    index += 2; // --

    var character = input.charAt(index)
      , content = ''
      , isLong = false
      , commentStart = index
      , lineStartComment = lineStart
      , lineComment = line;

    if ('[' === character) {
      let longString = readLongString();
      // This wasn't a multiline comment after all.
      if (longString === undefined) {
        content = character;
      } else {
        content = longString;
        isLong = true;
      }
    }
    // Scan until next line as long as it's not a multiline comment.
    if (!isLong) {
      while (index < length) {
        if (isLineTerminator(input.charCodeAt(index))) {
          break;
        }
        index++;
      }
      content = input.slice(commentStart, index);
    }
    let rawValue = input.slice(tokenStart, index);
    return CreateToken(LuaTokenType.Comment, content, rawValue, lineComment, lineStart, tokenStart, index);    
  }

  function getNextToken(): LuaToken {
    // Comments begin with -- after which it will be decided if they are
    // multiline comments or not.
    //
    // The multiline functionality works the exact same way as with string
    // literals so we reuse the functionality.
    
    skipWhiteSpace();

    // Skip comments beginning with --
    if (45 === input.charCodeAt(index) && 45 === input.charCodeAt(index + 1)) {
      return scanComment();
    }


    if (index >= length) {
      return CreateToken(LuaTokenType.EOF, '<eof>', '<eof>', line, lineStart, index, index);
    }

    let tokenStart = index;
    function scanIdentifierOrKeyword() {
      let value;
      let type;

      while (isIdentifierPart(input.charCodeAt(++index))) {}
      value = input.slice(tokenStart, index);

      // Decide on the token type and possibly cast the value.
      if (isKeyword(value)) {
        type = LuaTokenType.Keyword;
      } else if ('true' === value || 'false' === value) {
        type = LuaTokenType.BooleanLiteral;
      } else if ('nil' === value) {
        type = LuaTokenType.NilLiteral;
      } else {
        type = LuaTokenType.Identifier;
      }
      return CreateToken(type, value, value, line, lineStart, tokenStart, index);
    }

    function checkCharAndGoToNext(chars: string) {
      let char = input.charAt(index);
      if (char.length === 0) {
        return false;
      }
      if (chars.indexOf(char) >= 0) {
        index++;
        return true;
      }
      return false;
    }

    function scanNumericLiteral() {
      while (true) {
        index++;
        let charCode = input.charCodeAt(index);
        // go through all decimal digits and dots (46)
        if (!isDecDigit(charCode) && charCode !== 46) {
          break;
        }
      }
      // exponent is allowed to be followed by -+
      if (checkCharAndGoToNext("eE")) {
        checkCharAndGoToNext("-+");
      }

      // as we cannot rely on Number() to convert string with underscores
      // we must detect whether there were any underscores at invalid locations (at start, end and next to something that is not a digit)
      let underscoreInInvalidPlace = false;
      let hasUnderscore = false;
      while (true) {
        let charCode = input.charCodeAt(index);
        // go through all alphanumeric characters and underscores
        if (!isAlphaNum(charCode)) {
          if (charCode !== 95) {
            break;
          } else {
            hasUnderscore = true;
            if (!isDecDigit(input.charCodeAt(index - 1)) || !isDecDigit(input.charCodeAt(index + 1))) {
              underscoreInInvalidPlace = true;
            }
          }

        }
        index++;
      }
      let rawValue = input.slice(tokenStart, index);
      let valueWithoutUnderscores = rawValue;
      if (hasUnderscore && !underscoreInInvalidPlace) {
        valueWithoutUnderscores = valueWithoutUnderscores.replace(/_/g, "");
      }
      let value = Number(valueWithoutUnderscores);
      if (Number.isNaN(value)) {
        let token = CreateToken(LuaTokenType.Unexpected, rawValue, rawValue, line, lineStart, tokenStart, index);
        raiseError(token, errorStrings.malformedNumber, rawValue);
        return token;
      }
      return CreateToken(LuaTokenType.NumericLiteral, value, rawValue, line, lineStart, tokenStart, index);
    }
    function scanVarargLiteral() {
      index += 3;
      return CreateToken(LuaTokenType.VarargLiteral, '...', '...', line, lineStart, tokenStart, index);
    }
    function scanPunctuator(value: string) {
      index += value.length;
      return CreateToken(LuaTokenType.Punctuator, value, value, line, lineStart, tokenStart, index);
    }

    // Find the string literal by matching the delimiter marks used.
    function scanStringLiteral() {
      var delimiter = input.charCodeAt(index++)
        , stringStart = index
        , string = ''
        , charCode;

      while (index < length) {
        charCode = input.charCodeAt(index++);
        if (delimiter === charCode) {
          break;
        }
        if (92 === charCode) { // \
          string += input.slice(stringStart, index - 1) + readEscapeSequence();
          stringStart = index;
        }
        // EOF or `\n` terminates a string literal. If we haven't found the
        // ending delimiter by now, raise an exception.
        else if (index >= length || isLineTerminator(charCode)) {
          string += input.slice(stringStart, index - 1);
          let token = CreateToken(LuaTokenType.StringLiteral, string, string, line, lineStart, tokenStart, index);
          raiseError(token, errorStrings.unfinishedString, string);
          return token;
        }
      }
      string += input.slice(stringStart, index - 1);

      return CreateToken(LuaTokenType.StringLiteral, string, string, line, lineStart, tokenStart, index);
    }

    // Expect a multiline string literal and return it as a regular string
    // literal, if it doesn't validate into a valid multiline string, throw an
    // exception.

    function scanLongStringLiteral() {
      var string = readLongString();
      // Fail if it's not a multiline literal.
      if (string === undefined) {
        let token = CreateToken(LuaTokenType.Unexpected, '[[', '[[', line, lineStart, tokenStart, index);
        raiseError(token, errorStrings.expected, '[', '');
        return token;
      }
      return CreateToken(LuaTokenType.StringLiteral, string, string, line, lineStart, tokenStart, index);
    }


    var charCode = input.charCodeAt(index)
      , next = input.charCodeAt(index + 1);



    // Memorize the range index where the token begins.
    tokenStart = index;
    if (isIdentifierStart(charCode)) {
      return scanIdentifierOrKeyword();
    }

    switch (charCode) {
      case 39: case 34: // '"
        return scanStringLiteral();

      // 0-9
      case 48: case 49: case 50: case 51: case 52: case 53:
      case 54: case 55: case 56: case 57:
        return scanNumericLiteral();

      case 46: // .
        // If the dot is followed by a digit it's a float.
        if (isDecDigit(next)) {
          return scanNumericLiteral();
        }
        if (46 === next) {
          if (46 === input.charCodeAt(index + 2)) {
            return scanVarargLiteral();
          }
          return scanPunctuator('..');
        }
        return scanPunctuator('.');

      case 61: // =
        if (61 === next) {
          return scanPunctuator('==');
        }
        return scanPunctuator('=');

      case 62: // >
        if (61 === next) {
          return scanPunctuator('>=');
        }
        // not Lua5.1
        // if (62 === next) {
        //   return scanPunctuator('>>');
        // }
        return scanPunctuator('>');

      case 60: // <
        // not Lua5.1
        // if (60 === next) {
        //   return scanPunctuator('<<');
        // }
        if (61 === next) {
          return scanPunctuator('<=');
        }
        return scanPunctuator('<');

      case 126: // ~
        if (61 === next) {
          return scanPunctuator('~=');
        }
        return scanPunctuator('~');

      case 58: // :
        // not Lua5.1
        // if (58 === next) {
        //   return scanPunctuator('::');
        // }
        return scanPunctuator(':');

      case 91: // [
        // Check for a multiline string, they begin with [= or [[
        if (91 === next || 61 === next) {
          return scanLongStringLiteral();
        }
        return scanPunctuator('[');

      case 47: // /
        // not Lua5.1.
        // Check for integer division op (//)
        // if (47 === next) {
        //   return scanPunctuator('//');
        // }
        return scanPunctuator('/');

      // * ^ % , { } ] ( ) ; # - +
      case 42: case 94: case 37: case 44: case 123: case 125:
      case 93: case 40: case 41: case 59:  case 35: case 45: case 43:
      // not Lua5.1. & |
      // case 38: case 124:
        return scanPunctuator(input.charAt(index));
    }
    let value = input.charAt(index++);
    return CreateToken(LuaTokenType.Unexpected, value, value, line, lineStart, tokenStart, index);
  }

  function reset() {
    index = 0;
    line = 1;
    lineStart = 0;
    length = input.length;
  }
  return { getNextToken: getNextToken, reset: reset, raiseError: raiseError, errors: errors};
}

function isIdentifierStart(charCode: number): boolean {
  return (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122) || 95 === charCode;
}

function isAlpha(charCode: number)
{
  return (charCode >= 65 && charCode <= 90) || (charCode >= 97 && charCode <= 122);
}

function isIdentifierPart(charCode: number): boolean {
  // alpha or underscore or digit
  return isAlpha(charCode) || charCode === 95 || isDecDigit(charCode);
}

function isKeyword(id: string) {
  switch (id.length) {
    case 2:
      return 'do' === id || 'if' === id || 'in' === id || 'or' === id;
    case 3:
      return 'and' === id || 'end' === id || 'for' === id || 'not' === id;
    case 4:
      return 'else' === id || 'goto' === id || 'then' === id;
    case 5:
      return 'break' === id || 'local' === id || 'until' === id || 'while' === id;
    case 6:
      return 'elseif' === id || 'repeat' === id || 'return' === id;
    case 8:
      return 'function' === id;
  }
  return false;
}

function isWhiteSpace(charCode: number) {
  return 9 === charCode || 32 === charCode || 0xB === charCode || 0xC === charCode;
}

function isLineTerminator(charCode: number) {
  return 10 === charCode || 13 === charCode;
}

function isDecDigit(charCode: number) {
  return charCode >= 48 && charCode <= 57;
}

function isAlphaNum(charCode: number) {
  return isDecDigit(charCode) || isAlpha(charCode);
}

function isHexDigit(charCode: number) {
  return (charCode >= 48 && charCode <= 57) || (charCode >= 97 && charCode <= 102) || (charCode >= 65 && charCode <= 70);
}

// A sprintf implementation using %index (beginning at 1) to input
// arguments in the format string.
//
// Example:
//
//     // Unexpected function in token
//     sprintf('Unexpected %2 in %1.', 'token', 'function');
function sprintf(format: string, ...args: any[]) {
  let result = format.replace(/%(\d)/g, function (match, index) {
    return '' + args[index - 1] || '';
  });
  return result;
}

function isCharOneOf(char: string, oneOf0: string, oneOf1: string) {
  return char === oneOf0 || char === oneOf1;
}