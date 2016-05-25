import { Sync } from './sync';
import { Terminal } from './terminal';
import { Config } from '../lib/config';
import { SubscriptionResponse } from '../lib/fb-watchman';

export interface Watchman {
  start(): void;
}

export default class WatchmanImpl implements Watchman {
  private _config: Config;
  private _client: any;
  private _terminal: Terminal;
  private _sync: Sync;
  
  constructor(config: Config, watchmanClient: any, terminal: Terminal, sync: Sync) {
    this._config = config;
    this._client = watchmanClient;
    this._terminal = terminal;
    this._sync = sync;
  }
  
  start(): void {
    const capabilities: any = {
      optional: [], 
      required: ['relative_root']
    };
    const onCapabilityCheck = this._onCapabilityCheck.bind(this);
    
    this._terminal.start();
    this._client.capabilityCheck(capabilities, onCapabilityCheck);
  }
  
  private _onCapabilityCheck(error: string | Error): void {
    var terminal = this._terminal;
    if (error) {
      terminal.error(error);
      return;
    }
    terminal.render();

    const promises: Promise<string | void>[] = [], subscriptions = Object.keys(this._config.subscriptions);
    for (var i = 0; i < subscriptions.length; i++) {
      var name = subscriptions[i],
        subscription = this._config.subscriptions[name];

      promises.push(this._subscribe(subscription.source, name, null, subscription.watchExpression));
    }
    Promise.all(promises).then(this._terminal.render);

    const onSubscription = this._onSubscription.bind(this);
    // subscription is fired regardless of which subscriber fired it
    this._client.on('subscription', onSubscription);
  }
  
  private _onSubscription(resp: SubscriptionResponse): void {
    const config = this._config;
    const terminal = this._terminal;
    const subscription = (resp && resp.subscription) || '';
    const files = resp.files;

    const subConfig = config.subscriptions[subscription];
    terminal.setState(subConfig, 'running');
    if (subConfig) {
      if (subConfig.type === 'rsync') {
        this._sync.syncFiles(subConfig, files)
          .then((output) => {
            terminal.debug(output);
            terminal.setState(subConfig, 'good', output);
          })
          .catch((err) => {
            terminal.debug(err);
            terminal.setState(subConfig, 'error', err);
          });
      }
    }
  }
  
  private _subscribe(folder: string, name: string, relativePath: string, expression: any[]): Promise<void> {
    var terminal = this._terminal;
    var client = this._client;
    if (typeof expression === 'undefined') {
      expression = ['allof', ['type', 'f']];
    }
    var sub = {
      expression: expression,
      fields: ['name', 'exists'],
      relative_root: ''
    };
    if (relativePath) {
      sub.relative_root = relativePath;
    }

    terminal.debug('starting:' + name + ' expression: ' + JSON.stringify(expression));
    return new Promise<string | void>(function (resolve, reject) {
      client.command(['subscribe', folder, name, sub],
        (error: string) => {
          if (error) {
            reject('failed to subscribe: ' + error);
          }
          resolve();
        });
    });
  }
  
}
