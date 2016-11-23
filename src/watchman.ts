import 'reflect-metadata';

import { inject, injectable } from 'inversify';

import { Config, SubConfig, WatchmanExpression } from './config';
import { Sync } from './sync';
import { Terminal } from './terminal';

export interface WatchmanSync {
  /**
   * Get this party started!  This is the start of everything.
   * This is what communicates directly with fb-watchman and then passes data to sync/terminal.
   *
   * @memberOf Watchman
   */
  start(): void;
}

@injectable()
export default class WatchmanSyncImpl implements WatchmanSync {
  private config: Config;
  private client: WatchmanClient;
  private terminal: Terminal;
  private sync: Sync;

  constructor(
    @inject('Config') config: Config,
    @inject('WatchmanClient') watchmanClient: WatchmanClient,
    @inject('Terminal') terminal: Terminal,
    @inject('Sync') sync: Sync,
  ) {
    this.config = config;
    this.client = watchmanClient;
    this.terminal = terminal;
    this.sync = sync;
  }

  public start(): void {
    const capabilities = {
      optional: [] as string[],
      required: ['relative_root'] as string[],
    };
    const onCapabilityCheck = this.onCapabilityCheck.bind(this);

    this.terminal.start();
    this.client.capabilityCheck(capabilities, onCapabilityCheck);
  }

  private onCapabilityCheck(error?: string | Error): void {
    const terminal = this.terminal;
    if (error) {
      terminal.error(error);
      return;
    }
    terminal.render();

    const client = this.client;
    const onSubscription = this.onSubscription.bind(this);
    const promises: Array<Promise<string | void>> = [];
    const subscriptions = Object.keys(this.config.subscriptions);
    const length = subscriptions.length;

    for (let name of subscriptions) {
      let sub = this.config.subscriptions[name];
      let ignores = sub.ignoreFolders;
      let expression = sub.watchExpression || ['allof', ['type', 'f']];

      for (let ignore of ignores) {
        expression.push(['not', ['dirname', ignore]]);
      }

      promises.push(this.subscribe(sub.source, name, expression));
    }
    Promise.all(promises).then(this.terminal.render);

    // subscription is fired regardless of which subscriber fired it
    client.on('subscription', onSubscription);
  }

  private syncFiles(subConfig: SubConfig, files: SubscriptionResponseFile[]) {
    const terminal = this.terminal;
    terminal.setState(subConfig, 'running');

    const fileNames = (files || []).map(file => file.name);
    this.sync.syncFiles(subConfig, fileNames)
      .then(() => {
        terminal.setState(subConfig, 'good');
      })
      .catch(() => {
        terminal.setState(subConfig, 'error');
      });
  }

  private onSubscription(resp: SubscriptionResponse): void {
    const config = this.config;
    const subscription = resp && resp.subscription;
    const files = resp.files;

    const subConfig = config.subscriptions[subscription];
    this.syncFiles(subConfig, files);
  }

  private subscribe(folder: string, name: string, expression: WatchmanExpression): Promise<string | void> {
    const terminal = this.terminal;
    const client = this.client;
    const sub = {
      expression,
      fields: ['name', 'exists'],
      relative_root: '',
    };

    terminal.debug(`starting: ${name} expression: ${JSON.stringify(expression)}`);
    return new Promise<string | void>((resolve, reject) => {
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
