import { Terminal } from './terminal';
import { SubConfig, Config } from '../lib/config';
import { SubscriptionResponseFile } from '../lib/fb-watchman';

export interface Sync {
  syncFiles(subConfig: SubConfig, files: SubscriptionResponseFile[]): Promise<string>;
}

export default class SyncImpl implements Sync {
  private terminal: Terminal;
  private exec: (command: string, options?: any, callback?: (error: string, stdout: string, stderr: string) => void) => void;
  private rsyncCmd: string;
  private maxFileLength: number;
  
  constructor(config: Config, 
              terminal: Terminal, 
              exec: (command: string, options?: any, callback?: (error: string, stdout: string, stderr: string) => void) => void) {
    
    this.terminal = terminal;
    this.exec = exec; 
    this.rsyncCmd = config && config.rsyncCmd || 'rsync';
    this.maxFileLength = config && config.maxFileLength || 100;
  }
  
  syncFiles(subConfig: SubConfig, fbFiles: SubscriptionResponseFile[] = []): Promise<string> {
    const files: string[] = fbFiles.map(function(file) {
      return file.name;
    }).filter(function(file) {
      return file.indexOf('.sass-cache/') === -1 &&
        file.indexOf('.git/') === -1 &&
        file.indexOf('.idea/') === -1;
    });

    // if there are too many files, it might just be better to let rsync figure out what
    // needs to be synced
    if (files.length > 0 && files.length < this.maxFileLength) {
      return this._syncSpecificFiles(subConfig, files);
    } else {
      return this._syncAllFiles(subConfig);
    }
  }
  
  private _syncAllFiles(subConfig: SubConfig): Promise<string> {
    const terminal = this.terminal;
    const rsyncCmd = this.rsyncCmd;
    const exec = this.exec;
    const excludes = ' --exclude \'.idea\' --exclude \'.git\' --exclude \'.sass-cache\'';
    const src = subConfig.source;
    const dest = subConfig.destination;

    return new Promise<string>((resolve, reject) => {
      var cmd = [rsyncCmd, '-avz --stats --delete', src, dest, excludes].join(' ');
      terminal.debug(cmd);
      exec(cmd, null, getExecCallback(resolve, reject));
    });
  }
  
  private _syncSpecificFiles(subConfig: SubConfig, files: string[]): Promise<string> {
    const terminal = this.terminal;
    const rsyncCmd = this.rsyncCmd;
    const exec = this.exec;
    const excludes = '--exclude \'*\'';
    const src = subConfig.source;
    const dest = subConfig.destination;

    files =  getUniqueFileFolders(files).concat(files);

    const includes = ' --include \'' + files.join('\' --include \'') + '\'';

    return new Promise<string>((resolve, reject) => {
      var cmd = [rsyncCmd, '-avz --stats --delete', includes, excludes, src, dest].join(' ');
      terminal.debug(cmd);
      exec(cmd, null, getExecCallback(resolve, reject));
    });
  }
}

function getUniqueFileFolders(files: string[]) {
  const folders: string[] = [];
  const length: number = files.length;
  for (let i = 0, folderParts: string[], folderPartsSum: string, file: string; i < length; i++) {
    file = files[i];
    folderParts = file.split('/');
    folderPartsSum = '';
    for (let j = 0; j < folderParts.length - 1; j++) {
      if (folderPartsSum.length > 0) {
        folderPartsSum += '/';
      }
      folderPartsSum += folderParts[j];
      folders.push(folderPartsSum);
    }
  }
  return unique(folders);
}

function unique(arr: string[]) {
  const seen: any = {};
  return arr.filter((item: string) => {
    return seen.hasOwnProperty(item) ? false : (seen[item] = true);
  });
}

function getExecCallback(resolve: (out: string) => void, reject: (err: string | Error) => void) {
  return (err: string | Error, stdOut: string, stdErr: string) => {
    if (err || stdErr) {
      reject(err || stdErr);
    } else {
      resolve(stdOut);
    }
  };
}