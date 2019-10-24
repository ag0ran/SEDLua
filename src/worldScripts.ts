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
  scripts: Array<ScriptInList>;
}


export class WorldScriptInfo {
  constructor(world: string, entityId: number) {
    this.world = world;
    this.entityId = entityId;
  }
  world: string;
  entityId: number;
  variables: Map<string, VariableInfo> = new Map<string, VariableInfo>();
}

export class WorldScriptsStorage {
  worldScripts = new Map<string, Array<WorldScriptInfo>>();
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
  for (const script of worldScriptsList.scripts) {
    let worldScriptInfos = getOrCreateScriptInfos(script.script);
    let scriptInfo = worldScriptInfos.find((scriptInfo) => (scriptInfo.world === world && scriptInfo.entityId === script.entityId));
    if (!scriptInfo) {
      scriptInfo = new WorldScriptInfo(world, script.entityId);
      worldScriptInfos.push(scriptInfo);
    }
    for (let v of script.variables) {
      scriptInfo.variables.set(v.name, new VariableInfo(v.type));
    }
  }
}


export async function refreshWorldScripts()
{
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
        processedWorldScripts.set(fileUri, fileStats.mtime);
        let worldScriptDumpString = fs.readFileSync(fileUri.fsPath, "utf8");
        // removing BOM
        worldScriptDumpString = worldScriptDumpString.replace(/^\uFEFF/, '');
        let worldScriptsList = JSON.parse(worldScriptDumpString);
        addWorldScriptsList(worldScriptsList);
        log.printLine("Read world scripts from " + fileUri.fsPath);
      } catch (err) {
        log.printLine("Error reading world script from " + fileUri.fsPath + ": " + err.message);
      }
    },
    fileFilter: new Set([".json"]),
  };
  await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);
}