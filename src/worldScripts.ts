import { log } from './log';
import * as seFilesystem from './sefilesystem';
import fs = require('fs');
import {Uri} from 'vscode';
import { VariableInfo } from './documentCompletionHandler';

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
  getScriptInfo(scriptPath: string, worldPath?: string, entityId?: number): WorldScriptInfo|undefined {
    let worldScriptInfos = this.worldScripts.get(scriptPath);
    if (!worldScriptInfos) {
      return undefined;
    }
    if (!worldPath || !entityId) {
      if (worldScriptInfos.length !== 1) {
        return undefined;
      }
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

function addWorldScriptsList(worldScriptsList : WorldScriptsList)
{
  let world = worldScriptsList.world;
  let worldModifiedTimeMS = worldScriptsList.worldModifiedTimeMS;
  worldScriptsList.worldScriptsStale = false;
  if (worldModifiedTimeMS && worldModifiedTimeMS !== -1) {
    let worldHardPath = seFilesystem.softPathToHardPath(world);
    try {
      let fileStats = fs.statSync(worldHardPath);
      let currentWorldModifiedTimeMS = Math.trunc(fileStats.mtimeMs);
      worldScriptsList.worldScriptsStale = currentWorldModifiedTimeMS !== worldModifiedTimeMS;
    } catch(err) {
      log.printLine(`Error getting file stats for ${worldHardPath}: ${err.message}`);
      worldScriptsList.worldScriptsStale = true;
    }
  }
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
  // check world dumped world scripts
  let forEachFileOptions: seFilesystem.ForEachFileOptions = {
    startingDirUri: seFilesystem.softPathToUri("Temp/WorldScripts"),
    forFileFunc: async (fileUri: Uri) => {
      try {
        let lastModificationTime = processedWorldScripts.get(fileUri);
        let fileStats = fs.statSync(fileUri.fsPath);
        if (fileStats.mtime === lastModificationTime) {
          return;
        }
        anythingChanged = true;
        processedWorldScripts.set(fileUri, fileStats.mtime);
        let worldScriptDumpString = fs.readFileSync(fileUri.fsPath, "utf8");
        // removing BOM
        worldScriptDumpString = worldScriptDumpString.replace(/^\uFEFF/, '');
        let worldScriptsList = JSON.parse(worldScriptDumpString);
        addWorldScriptsList(worldScriptsList);
      } catch (err) {
        log.printLine("Error reading world script from " + fileUri.fsPath + ": " + err.message);
      }
    },
    fileFilter: new Set([".json"]),
  };
  await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
  return anythingChanged;
}