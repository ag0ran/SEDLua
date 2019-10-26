import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';
import { initFilesystem } from '../../sefilesystem';
import * as vscode from 'vscode';
import * as assert from 'assert';

// Since tests are being run from the output directory, we need to find the test directory path.
function extractTestsRoot()
{
	let inPath = __dirname;
	let outPathStart = inPath.lastIndexOf("/out/test/");
	let testRelPath = "/src/test";
  let slashChar = "/";
  if (outPathStart === -1) {
    outPathStart = inPath.lastIndexOf("\\out\\test\\");
    if (outPathStart === -1) {
      return undefined;
		}
		testRelPath = "\\src\\test\\"
    slashChar = "\\";
  }
  return inPath.substring(0, outPathStart) + testRelPath + "SeRoot" + slashChar + "Content";
}

function initSeFileSystem () {
	let testsRoot = extractTestsRoot();
	assert(initFilesystem(vscode.Uri.file(testsRoot!)));
}

export function run(): Promise<void> {
	// Create the mocha test
	const mocha = new Mocha({
		ui: 'tdd',
	});
	mocha.useColors(true);

	// we have to init the Se filesystem before running any tests as it is required by many tests
	initSeFileSystem();

	const testsRoot = path.resolve(__dirname, '..');

	return new Promise((c, e) => {
		glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
			if (err) {
				return e(err);
			}

			// Add files to the test suite
			files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run(failures => {
					if (failures > 0) {
						e(new Error(`${failures} tests failed.`));
					} else {
						c();
					}
				});
			} catch (err) {
				e(err);
			}
		});
	});
}
