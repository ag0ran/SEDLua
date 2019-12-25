import xml2js = require('xml2js');
import fs = require('fs');
import * as vscode from 'vscode';
import * as seFilesystem from './sefilesystem';
import { log } from './log';
import { loadConfig } from './configuration';

function normalizeXmlValue(s: string) {
  return s.trim();
}

export class CvarCompletionInfo {
  name: string = "";
  type: string = "";
  briefComment: string = "";
  detailComment: string = "";
  attributes: string = "";
}

export class CvarFunctionCompletionInfo {
  name: string = "";
  returnType: string = "";
  briefComment: string = "";
  detailComment: string = "";
  attributes: string = "";
  params: string = "";
}

class MacroVarCompletionInfo {
  name: string = "";
  type: string = "";
  briefComment: string = "";
  detailComment: string = "";
}

export class MacroFuncCompletionInfo {
  name: string = "";
  returnType: string = "";
  params: string = "";
  briefComment: string = "";
  detailComment: string = "";
  macroClass: MacroClassCompletionInfo|undefined;
}

export class MacroClassCompletionInfo {
  name: string = "";
  baseClass: string = "";
  events: string[] = [];
  memberFunctions : MacroFuncCompletionInfo[] = [];
  briefComment: string = "";
}

export class MacroClassEvent {
  constructor(name: string, macroClass: string) {
    this.name = name;
    this.macroClass = macroClass;
  }
  name: string;
  macroClass: string;
}

export class LuaObjectCompletionInfo {
  name: string = "";
  desc: string = "";
  base?: LuaObjectCompletionInfo;
  objects = new Array<LuaObjectCompletionInfo>();
  functions = new Array<LuaFunctionCompletionInfo>();

  findCompletionInfoByName(name: string, onlySelf = false ): LuaObjectCompletionInfo|LuaFunctionCompletionInfo|undefined {
    if (!onlySelf) {
      for (let objInfo of this.objects) {
        if (objInfo.name === name) {
          return objInfo;
        }
      }
    }
    for (let funcInfo of this.functions) {
      if (onlySelf !== !!funcInfo.self) {
        continue;
      }
      if (funcInfo.name === name) {
        return funcInfo;
      }
    }
  }
}

function cloneLuaObjectCompletionInfo(src: LuaObjectCompletionInfo): LuaObjectCompletionInfo {
  let clone = new LuaObjectCompletionInfo();
  clone.name = src.name;
  clone.desc = src.desc;
  for (let obj of src.objects) {
    let objClone = cloneLuaObjectCompletionInfo(obj);
    objClone.base = clone;
    clone.objects.push(objClone);
  }
  for (let func of src.functions) {
    let funcClone = cloneLuaFunctionCompletionInfo(func);
    funcClone.base = clone;
    clone.functions.push(funcClone);
  }
  return clone;
}

export class LuaFunctionParamCompletionInfo {
  name = "";
  desc = "";
}

export class LuaFunctionCompletionInfo {
  name: string = "";
  desc: string = "";
  // set for functions that have a base and accept the self parameter
  self?: boolean;
  params = new Array<LuaFunctionParamCompletionInfo>();
  base?: LuaObjectCompletionInfo;
}
function cloneLuaFunctionCompletionInfo(src: LuaFunctionCompletionInfo): LuaFunctionCompletionInfo {
  let clone = new LuaFunctionCompletionInfo();
  clone.name = src.name;
  clone.desc = src.desc;
  clone.params = src.params;
  return clone;
}

export class LuaCompletionInfo {
  objects = new Array<LuaObjectCompletionInfo>();
  functions = new Array<LuaFunctionCompletionInfo>();

  // Copies completion info from provided one
  copyFrom(src: LuaCompletionInfo) {
    for (let obj of src.objects) {
      this.objects.push(cloneLuaObjectCompletionInfo(obj));
    }
    for (let func of src.functions) {
      this.functions.push(cloneLuaFunctionCompletionInfo(func));
    }
  }
}


export class HelpCompletionInfo {
  cvars: CvarCompletionInfo[] = [];
  cvarFunctions: CvarFunctionCompletionInfo[] = [];

  macroClasses: MacroClassCompletionInfo[] = [];
  macroClassesMap = new Map<string, number>();
  macroFunctions: MacroFuncCompletionInfo[] = [];

  processedFiles = new Set<string>();

  luaCompletion = new LuaCompletionInfo();

  findMacroClassInfo(className: string): MacroClassCompletionInfo|undefined {
    let macroClassIndex = this.macroClassesMap.get(className);
    if (macroClassIndex === undefined) {
      return undefined;
    }
    return this.macroClasses[macroClassIndex];
  }

  // Calls the callback function for each of the class' functions (including base classes)
  forEachMacroClassFunction(classInfo: MacroClassCompletionInfo|undefined, callbackFunc: (funcInfo: MacroFuncCompletionInfo) => void) {
    if (!classInfo) {
      return;
    }
    for (let funcInfo of classInfo.memberFunctions) {
      callbackFunc(funcInfo);
    }
    if (classInfo.baseClass !== "") {
      this.forEachMacroClassFunction(this.findMacroClassInfo(classInfo.baseClass), callbackFunc);
    }
  }

  findMacroClassFunction(classInfo: MacroClassCompletionInfo|undefined, funcName: string): MacroFuncCompletionInfo|undefined {
    if (!classInfo) {
      return;
    }
    for (let funcInfo of classInfo.memberFunctions) {
      if (funcInfo.name === funcName) {
        return funcInfo;
      }
    }
    if (classInfo.baseClass !== "") {
      return this.findMacroClassFunction(this.findMacroClassInfo(classInfo.baseClass), funcName);
    }
    return undefined;
  }


  // Calls the callback function for each of the class' events (including base classes)
  forEachMacroClassEvent(classInfo: MacroClassCompletionInfo|undefined, callbackFunc: (event: string) => void) {
    if (!classInfo) {
      return;
    }
    for (let event of classInfo.events) {
      callbackFunc(event);
    }
    if (classInfo.baseClass !== "") {
      this.forEachMacroClassEvent(this.findMacroClassInfo(classInfo.baseClass), callbackFunc);
    }
  }

  findMacroClassEvent(classInfo: MacroClassCompletionInfo|undefined, eventName: string): MacroClassEvent|undefined {
    if (!classInfo) {
      return;
    }
    for (let event of classInfo.events) {
      if (event === eventName) {
        return new MacroClassEvent(event, classInfo.name);
      }
    }
    if (classInfo.baseClass !== "") {
      return this.findMacroClassEvent(this.findMacroClassInfo(classInfo.baseClass), eventName);
    }
    return undefined;
  }

  findCvarFuncInfo(funcName: string): CvarFunctionCompletionInfo|undefined {
    return this.cvarFunctions.find((funcInfo) => funcInfo.name === funcName);
  }

  findLuaCompletionInfo(name: string): LuaObjectCompletionInfo|LuaFunctionCompletionInfo|undefined {
    for (let funcInfo of this.luaCompletion.functions) {
      if (funcInfo.name === name) {
        return funcInfo;
      }
    }
    for (let objInfo of this.luaCompletion.objects) {
      if (objInfo.name === name) {
        return objInfo;
      }
    }
    return undefined;
  }

  findMacroFuncInfo(funcName: string): MacroFuncCompletionInfo|undefined {
    return this.macroFunctions.find((funcInfo) => funcInfo.name === funcName);
  }


  addHelpFromFile(filePath: string) {
    // making sure each file is processed only once
    if (this.processedFiles.has(filePath)) {
      return;
    }
    this.processedFiles.add(filePath);

    let xml_string = fs.readFileSync(filePath, "utf8");
    const parser = new xml2js.Parser({explicitArray: false});
    parser.parseString(xml_string, (error: any, result: any) => {
      if (error) {
        vscode.window.showErrorMessage(error);
        return;
      }
      if (result.HELP) {
        if (result.HELP.CVARS && result.HELP.CVARS.CVAR) {
          this.addCvars(result.HELP.CVARS.CVAR);
        } else if (result.HELP.MACROS) {
          this.addMacros(result.HELP.MACROS);
        }
      }
    });
  }

  private addMacroClasses(classes: any) {
    let addClass = (cl: any) => {
      let classInfo = new MacroClassCompletionInfo();
      classInfo.name = cl.NAME;
      classInfo.baseClass = cl.BASE_CLASS;
      classInfo.briefComment = normalizeXmlValue(cl.COMMENT);
      if (cl.FUNCTIONS && cl.FUNCTIONS.FUNCTION) {
        this.addMacroFunctions(cl.FUNCTIONS.FUNCTION, classInfo.memberFunctions, classInfo);
      }
      if (cl.EVENTS && cl.EVENTS.EVENT) {
        if (Array.isArray(cl.EVENTS.EVENT)) {
          for (let eventMarkup of cl.EVENTS.EVENT) {
            classInfo.events.push(normalizeXmlValue(eventMarkup.NAME));
          }
        } else {
          classInfo.events.push(normalizeXmlValue(cl.EVENTS.EVENT.NAME));
        }
      }
      this.macroClassesMap.set(classInfo.name, this.macroClasses.length);
      this.macroClasses.push(classInfo);
    };

    if (Array.isArray(classes)) {
      for (let cl of classes) {
        addClass(cl);
      }
    } else {
      addClass(classes);
    }
  }

  private addMacroFunctions(functions: any, functionsArray: MacroFuncCompletionInfo[], macroClass?: MacroClassCompletionInfo) {
    let addFunc = (func: any) => {
      let funcInfo = new MacroFuncCompletionInfo();
      funcInfo.name = func.NAME;
      funcInfo.returnType = normalizeXmlValue(func.RETURN);
      funcInfo.params = normalizeXmlValue(func.PARAMS);
      funcInfo.briefComment = normalizeXmlValue(func.BRIEF_COMMENT);
      funcInfo.detailComment = normalizeXmlValue(func.DETAIL_COMMENT);
      funcInfo.macroClass = macroClass;
      functionsArray.push(funcInfo);
    };
    
    if (Array.isArray(functions)) {
      for (let func of functions) {
        addFunc(func);
      }
    } else {
      addFunc(functions);
    }
  }

  private addMacros(macros: any) {
    if (macros.CLASSES && macros.CLASSES.CLASS) {
      this.addMacroClasses(macros.CLASSES.CLASS);
    }
    if (macros.FUNCTIONS && macros.FUNCTIONS.FUNCTION) {
      this.addMacroFunctions(macros.FUNCTIONS.FUNCTION, this.macroFunctions);
    }
  }

  private addCvars(cvars: any) {
    let addCvar = (cvar: any) => {
      if (cvar.FUNCTION === "true") {
        let cvarFuncInfo = new CvarFunctionCompletionInfo();
        cvarFuncInfo.name = cvar.NAME;
        cvarFuncInfo.returnType = normalizeXmlValue(cvar.TYPE);
        cvarFuncInfo.briefComment = normalizeXmlValue(cvar.BRIEF_COMMENT);
        cvarFuncInfo.detailComment = normalizeXmlValue(cvar.DETAIL_COMMENT);
        cvarFuncInfo.attributes = cvar.PURITY;
        cvarFuncInfo.params = normalizeXmlValue(cvar.PARAMS);
        this.cvarFunctions.push(cvarFuncInfo);
      } else {
        let cvarInfo = new CvarCompletionInfo();
        cvarInfo.name = cvar.NAME;
        cvarInfo.type = cvar.TYPE;
        cvarInfo.briefComment = normalizeXmlValue(cvar.BRIEF_COMMENT);
        cvarInfo.detailComment = normalizeXmlValue(cvar.DETAIL_COMMENT);
        cvarInfo.attributes = cvar.PURITY;
        if (cvar.SAVED === "true") {
          cvarInfo.attributes += cvarInfo.attributes !== "" ? "saved" : " saved";
        }
        this.cvars.push(cvarInfo);
      }
    };
    if (Array.isArray(cvars)) {
      for (let cvar of cvars) {
        addCvar(cvar);
      }
    } else {
      addCvar(cvars);
    }
  }
}

export let helpCompletionInfo = new HelpCompletionInfo();

export async function loadHelpCompletionInfo() {
  let forEachFileOptions: seFilesystem.ForEachFileOptions = {
    startingDirUri: seFilesystem.softPathToUri("Help/"),
    fileFilter: new Set([".xml"]),
    forFileFunc: (fileUri: vscode.Uri) => {
      helpCompletionInfo.addHelpFromFile(fileUri.fsPath);
    }
  };
  await seFilesystem.forEachFileRecursiveAsync(forEachFileOptions);

  // load lua autocomplete info
  {
    let sedLuaAutocompleteHardPath = seFilesystem.softPathToHardPath("Help/SEDLuaAutocomplete.json");
    try {
      let luaAutoCompleteJsonString = fs.readFileSync(sedLuaAutocompleteHardPath, "utf8");
      let loadedLuaCompletion = JSON.parse(luaAutoCompleteJsonString);
      helpCompletionInfo.luaCompletion.copyFrom(loadedLuaCompletion);
      if (helpCompletionInfo.luaCompletion.functions.length > 0 || helpCompletionInfo.luaCompletion.objects.length > 0) {
        log.printLine(`Read ${sedLuaAutocompleteHardPath}: ${helpCompletionInfo.luaCompletion.objects.length} global objects and ${helpCompletionInfo.luaCompletion.functions.length} global functions`);
      }
    } catch(err) {
      log.printLine(`Error reading ${sedLuaAutocompleteHardPath}: ${err.message}`);
    }
  }
}

export function extractLuaParamByIndex(luaFuncInfo: LuaFunctionCompletionInfo, iParam: number): LuaFunctionParamCompletionInfo|undefined {
  if (iParam >= luaFuncInfo.params.length) {
    // if last parameter is the variable arg designator '...'
    if (luaFuncInfo.params.length > 0 && luaFuncInfo.params[luaFuncInfo.params.length - 1].name === '...') {
      // than all params that follow it, map to it
      return luaFuncInfo.params[luaFuncInfo.params.length - 1];
    }
    return undefined;
  }
  return luaFuncInfo.params[iParam];
}

export function extractMacroParamByIndex(params: string, iParam: number): string|undefined {
  let allParams = params.split(",");
  if (allParams.length === 0 || iParam >= allParams.length || iParam < 0) {
    return undefined;
  }
  let param = allParams[iParam].trim();
  if (param === "void") {
    return undefined;
  }
  return param;
}