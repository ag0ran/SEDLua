import { log } from './log';
import * as seFilesystem from './sefilesystem';
import fs = require('fs');
import {Uri} from 'vscode';
import { VariableInfo } from './documentCompletionHandler';
import * as path from 'path';
import { config } from './configuration';

let processedWorldScripts = new Map<Uri, Date>();

interface VarAndType {
  name: string;
  type: string;
}

interface ScriptInList {
  script: string;
  entityId: number;
  variables: Array<VarAndType>;
}

interface WorldScriptsList {
  world: string;
  worldModifiedTimeMS?: number;
  worldScriptsStale?: boolean;
  scripts: Array<ScriptInList>;
}


export class WorldScriptInfo {
  constructor(world: string, entityId: number, stale: boolean) {
    this.world = world;
    this.entityId = entityId;
    this.stale = stale;
  }
  world: string;
  entityId: number;
  variables: Map<string, VariableInfo> = new Map<string, VariableInfo>();
  stale: boolean;
}

export class WorldScriptsStorage {
  worldScripts = new Map<string, Array<WorldScriptInfo>>();
  lastScriptOpenedInEditor: string|undefined;
  lastWorldOpenedInEditor: string|undefined;
  lastScriptOpenedInEditorModificationTime: number|undefined;
  getScriptInfo(scriptPath: string, worldPath?: string, entityId?: number): WorldScriptInfo|undefined {
    let worldScriptInfos = this.worldScripts.get(scriptPath);
    if (!worldScriptInfos) {
      return undefined;
    }
    if (!worldPath || !entityId) {
      return worldScriptInfos[0];
    }
    return worldScriptInfos.find((worldScriptInfo) => worldScriptInfo.world === worldPath && worldScriptInfo.entityId === entityId);
  }
  getVarInfosForScript(scriptPath: string, worldPath?: string, entityId?: number) : Map<string, VariableInfo>|undefined {
    let worldScriptInfo = this.getScriptInfo(scriptPath, worldPath, entityId);
    if (worldScriptInfo) {
      return worldScriptInfo.variables;
    }
    return undefined;
  }
}

function getOrCreateScriptInfos(script: string) {
  let worldScriptInfos = worldScriptsStorage.worldScripts.get(script);
  if (!worldScriptInfos) {
    worldScriptInfos = new Array<WorldScriptInfo>();
    worldScriptsStorage.worldScripts.set(script, worldScriptInfos);
  }
  return worldScriptInfos;
}

export let worldScriptsStorage = new WorldScriptsStorage();

// Deletes all world script dump files that are stale
export async function removeStaleWorldScripts()
{
  let forEachFileOptions: seFilesystem.ForEachFileOptions = {
    startingDirUri: seFilesystem.softPathToUri("Temp/WorldScripts"),
    forFileFunc: async (fileUri: Uri) => {
      try {
        let worldScriptDumpString = seFilesystem.readFileUtf8(fileUri.fsPath);
        let worldScriptsList = JSON.parse(worldScriptDumpString);
        if (isStaleWorldScriptsList(worldScriptsList)) {
          fs.unlinkSync(fileUri.fsPath);
        }
      } catch (err) {
        log.printLine("Error reading world script from " + fileUri.fsPath + ": " + err.message);
      }
    },
    fileFilter: new Set([".json"]),
  };
  await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
}

function isStaleWorldScriptsList(worldScriptsList : WorldScriptsList) {
  let world = worldScriptsList.world;
  let worldModifiedTimeMS = worldScriptsList.worldModifiedTimeMS;
  let worldHardPath = seFilesystem.softPathToHardPath(world);
  try {
    let fileStats = fs.statSync(worldHardPath);
    let currentWorldModifiedTimeMS = Math.trunc(fileStats.mtimeMs);
    return currentWorldModifiedTimeMS !== worldModifiedTimeMS;
  } catch(err) {
    log.printLine(`Error getting file stats for ${worldHardPath}: ${err.message}`);
    return true;
  }
}

function addWorldScriptsList(worldScriptsList : WorldScriptsList)
{
  let world = worldScriptsList.world;
  worldScriptsList.worldScriptsStale = isStaleWorldScriptsList(worldScriptsList);
  for (const script of worldScriptsList.scripts) {
    let worldScriptInfos = getOrCreateScriptInfos(script.script);
    let scriptInfo = worldScriptInfos.find((scriptInfo) => (scriptInfo.world === world && scriptInfo.entityId === script.entityId));
    if (!scriptInfo) {
      scriptInfo = new WorldScriptInfo(world, script.entityId, worldScriptsList.worldScriptsStale);
      worldScriptInfos.push(scriptInfo);
    } else {
      scriptInfo.stale =  worldScriptsList.worldScriptsStale;
    }
    for (let v of script.variables) {
      scriptInfo.variables.set(v.name, new VariableInfo(v.type));
    }
  }
}

// Refreshes world scripts from file. Returns whether anything had changed.
export async function refreshWorldScripts(): Promise<boolean>
{
  let anythingChanged = false;
  // we will track all world scripts we have found so we can remove those that no longer exist
  let foundWorldScripts = new Set<string>();
  function removeNotFoundWorldScriptsLists() {
    let somethingDeleted = false;
    worldScriptsStorage.worldScripts.forEach((worldScriptInfos, scriptPath) => {
      for (let i = worldScriptInfos.length - 1; i >= 0; i--) {
        if (!foundWorldScripts.has(worldScriptInfos[i].world)) {
          if (i === worldScriptInfos.length - 1) {
            worldScriptInfos.pop();
          } else {
            worldScriptInfos.splice(i);
          }
          somethingDeleted = true;
        }
      }
      if (worldScriptInfos.length === 0) {
        worldScriptsStorage.worldScripts.delete(scriptPath);
      }
    });
    return somethingDeleted;
  }
  // check world dumped world scripts
  let forEachFileOptions: seFilesystem.ForEachFileOptions = {
    startingDirUri: seFilesystem.softPathToUri("Temp/WorldScripts"),
    forFileFunc: async (fileUri: Uri) => {
      try {
        let fileStats = fs.statSync(fileUri.fsPath);
        let fileExt = path.extname(fileUri.fsPath);
        // the rest is just for json scripts
        if (fileExt !== ".json") {
          let mtimeMS = fileStats.mtime.getMilliseconds();
          let pathBasename = path.basename(fileUri.fsPath);
          if (pathBasename === "LastScriptOpenedInEditor.txt") {
            let lastmtimeMS = worldScriptsStorage.lastScriptOpenedInEditorModificationTime;
            if (!lastmtimeMS || mtimeMS !== lastmtimeMS) {
              worldScriptsStorage.lastScriptOpenedInEditor = seFilesystem.readFileUtf8(fileUri.fsPath);
              worldScriptsStorage.lastScriptOpenedInEditorModificationTime = mtimeMS;
            }
          } else if (pathBasename === "LastWorldOpenedInEditor.txt") {
            let lastWorldOpenedInEditor = seFilesystem.readFileUtf8(fileUri.fsPath);
            if (worldScriptsStorage.lastWorldOpenedInEditor !== lastWorldOpenedInEditor) {
              worldScriptsStorage.lastWorldOpenedInEditor = lastWorldOpenedInEditor;
              if (config.viewOnlyCurrentWorldScripts) {
                anythingChanged = true;
              }
            }
          }
          return;
        }
        let lastModificationTime = processedWorldScripts.get(fileUri);
        if (fileStats.mtime === lastModificationTime) {
          return;
        }
        anythingChanged = true;
        processedWorldScripts.set(fileUri, fileStats.mtime);
        let worldScriptDumpString = seFilesystem.readFileUtf8(fileUri.fsPath);
        let worldScriptsList = JSON.parse(worldScriptDumpString);
        foundWorldScripts.add(worldScriptsList.world);
        addWorldScriptsList(worldScriptsList);
      } catch (err) {
        log.printLine("Error reading world script from " + fileUri.fsPath + ": " + err.message);
      }
    },
    fileFilter: new Set([".json", ".txt"]),
  };
  await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
  
  if (removeNotFoundWorldScriptsLists()) {
    anythingChanged = true;
  }
  

  return anythingChanged;
}