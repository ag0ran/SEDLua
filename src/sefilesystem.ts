import {Uri, FileType, workspace} from 'vscode';
import * as path from 'path';

// Serious Engine related filesystem functions.

let filesystemRoot: string = "";

function checkFilesystemInit() {
  if (filesystemRoot === "") {
    throw new Error("SE filesystem uninitialized");
  }
}

export async function initFilesystem(workspaceUri: Uri): Promise<boolean> {
  let dirsInPath = workspaceUri.path.split("/");
  filesystemRoot = "";
  for (let i = 0; i < dirsInPath.length; i++) {
    if (dirsInPath[i] === 'Content') {
      filesystemRoot = dirsInPath.slice(0, i).join("/") + "/";
      break;
    }
  }
  if (filesystemRoot === "") {
    filesystemRoot = workspaceUri.path;
  }
  // valid Serious Engine filesystem root must contain "Help" dir
  let helpDirUri = Uri.file(filesystemRoot + "Help");
  let helpDirFileStat = await workspace.fs.stat(helpDirUri);
  if (!helpDirFileStat || helpDirFileStat.type !== FileType.Directory) {
    filesystemRoot = "";
    return false;
  }
  return true;
}
export function hardPathToSoftpath(hardPath: string) {
  checkFilesystemInit();
  return uriToSoftpath(Uri.file(hardPath));
}
export function uriToSoftpath(uri: Uri) {
  checkFilesystemInit();
  if (!uri.path.startsWith(filesystemRoot)) {
    return uri.path;
  }
  return uri.path.substr(filesystemRoot.length);
}
export function softPathToHardPath(softPath: string) {
  return Uri.file(filesystemRoot + softPath).fsPath;
}


export interface ForEachFileOptions {
  // Uri of the starting dir.
  startingDirUri: Uri;
  // Function called for each found file. Should be used to collect desired files.
  forFileFunc: (fileUri: Uri) => void;
  // Optional file extension filter. Files with extension outside the filter are ignored.
  fileFilter?: Set<string>;
  // Optional function called for each directory. Returns whether to recurse into that directory.
  shouldRecurseIntoDir?: (dirUri: Uri) => boolean;
}

export function forEachFileRecursive(options: ForEachFileOptions) {
  try {
    let readDirectoryResultFunc = (parentDirUri: Uri, result: [string, FileType][]) => {
      for (const fileResult of result) {
        let [fileName, fileType] = fileResult;
        let fileUri = Uri.file(parentDirUri.path + "/" + fileName);
        if (fileType === FileType.File) {
          let fileExt = path.extname(fileName);
          // skip unsupported script extensions
          if (options.fileFilter && !options.fileFilter.has(fileExt)) {
            continue;
          }
          options.forFileFunc(fileUri);
        } else if (fileType === FileType.Directory) {
          // recurse into directory if allowed
          if (!options.shouldRecurseIntoDir || options.shouldRecurseIntoDir(fileUri)) {
            workspace.fs.readDirectory(fileUri)
              .then(readDirectoryResultFunc.bind(null, fileUri));
          }
        }
      }
    };

    workspace.fs.readDirectory(options.startingDirUri)
      .then(readDirectoryResultFunc.bind(null, options.startingDirUri));
  } catch (err) {
    console.log(err.message);
  }
}