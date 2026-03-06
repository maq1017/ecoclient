import * as readline from 'readline';
import { driver, RxTransmitEvent } from '@jprayner/piconet-nodejs';
import { EconetAddress, parseEconetAddress } from '../common';
import { commandAccess } from './access';
import { commandBye } from './bye';
import { commandCat } from './cat';
import { commandCdir } from './cdir';
import { commandDelete } from './delete';
import { commandDir } from './dir';
import { commandGet } from './get';
import { commandIAm } from './iAm';
import { commandLoad } from './load';
import { commandNewUser } from './newUser';
import { commandNotify } from './notify';
import { getLocalStationNum } from '../config';
import { commandPass } from './pass';
import { commandPriv } from './priv';
import { commandPut } from './put';
import { commandRemUser } from './remUser';
import { commandSave } from './save';
import { commandSetFileserver } from './setFileserver';
import { commandFslist } from './fslist';
import {
  createNotifyListenerQueue,
  extractNotifyChar,
  notifySenderStation,
} from '../protocol/notify';

const HELP = `
Commands:
  i-am [net].[stn] <user> [pass]  Login to fileserver (use ":" as pass to prompt securely)
  bye                                Logout from fileserver
  cat [dir]                          List directory contents
  dir [path]                         Change current directory
  get <path> [-r] [-f]               Get file(s) from fileserver
  put <path> [-r] [-f]               Put file(s) to fileserver
  load <filename>                    Load and detokenise BASIC file
  save <localPath> [destPath]        Save tokenised BASIC file to fileserver
  cdir <dir>                         Create directory on fileserver
  access <path> <access>             Set file access permissions
  delete <path> [-r] [-f]            Delete file(s) from fileserver
  notify [net.]<station> <message>   Send notification to a station
  newuser <username>                 Create a new user account
  remuser <username>                 Remove a user account
  pass <old> <new>                   Change password
  priv <user> [S|N]                  Set user privilege level
  fslist                             List file servers on the network
  help                               Show this help
  exit                               Exit interactive mode
`;

const NOTIFY_IDLE_FLUSH_MS = 300;

type NotifyBuffer = {
  chars: string;
  lastReceivedMs: number;
};

const parseFlags = (args: string[]) => {
  const recurse = args.includes('-r') || args.includes('--recurse');
  const force = args.includes('-f') || args.includes('--force');
  const positional = args.filter(a => !a.startsWith('-'));
  return { recurse, force, positional };
};

const isStationAddress = (s: string) => /^\d+(\.\d+)?$/.test(s);

export const commandInteractive = async (initialServerStation: EconetAddress) => {
  let serverStation = initialServerStation;
  const localStation = await getLocalStationNum();
  console.log(`Entering interactive mode for Station ${localStation ?? 'unknown'}`);
  console.log('Type "help" for commands, "exit" to quit.');

  return new Promise<void>(resolve => {
    let closing = false;
    let passwordResolve: ((s: string) => void) | null = null;
    let isBusy = false;
    const pendingNotifications: string[] = [];
    const notifyBuffers = new Map<string, NotifyBuffer>();
    const notifyQueue = createNotifyListenerQueue();

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'ecoclient> ',
    });

    const displayNotification = (msg: string) => {
      const currentLine = (rl as any).line as string || '';
      process.stdout.write(`\r\x1b[K${msg}\n`);
      process.stdout.write(`ecoclient> ${currentLine}`);
    };

    const flushPendingNotifications = () => {
      while (pendingNotifications.length > 0) {
        console.log(pendingNotifications.shift()!);
      }
    };

    const notifyPollInterval = setInterval(() => {
      // Drain all available notify events into per-sender buffers
      while (true) {
        const event = driver.eventQueueShift(notifyQueue);
        if (!event) break;
        if (!(event instanceof RxTransmitEvent)) continue;

        const char = extractNotifyChar(event);
        if (!char) continue;

        const sender = notifySenderStation(event);
        const existing = notifyBuffers.get(sender);
        if (existing) {
          existing.chars += char;
          existing.lastReceivedMs = Date.now();
        } else {
          notifyBuffers.set(sender, { chars: char, lastReceivedMs: Date.now() });
        }
      }

      // Flush any sender buffers that have been idle long enough
      const now = Date.now();
      for (const [sender, buffer] of notifyBuffers.entries()) {
        if (now - buffer.lastReceivedMs >= NOTIFY_IDLE_FLUSH_MS) {
          notifyBuffers.delete(sender);
          const msg = buffer.chars;
          if (isBusy) {
            pendingNotifications.push(msg);
          } else {
            displayNotification(msg);
          }
        }
      }
    }, 50);

    const readPassword = (prompt: string): Promise<string> => {
      return new Promise(res => {
        const originalWrite = process.stdout.write.bind(process.stdout);
        let muted = false;
        (process.stdout as any).write = function (chunk: any, encodingOrCb?: any, cb?: any) {
          if (!muted) return originalWrite(chunk, encodingOrCb, cb);
          const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb;
          if (callback) callback();
          return true;
        };
        originalWrite(prompt);
        muted = true;
        passwordResolve = (pw: string) => {
          muted = false;
          process.stdout.write = originalWrite as typeof process.stdout.write;
          originalWrite('\n');
          res(pw);
        };
        rl.resume();
      });
    };

    rl.prompt();

    const processLine = async (line: string) => {
      const tokens = line
        .trim()
        .split(/\s+/)
        .filter(t => t.length > 0);
      if (tokens.length === 0) return;

      let command = tokens[0].toLowerCase();
      let args = tokens.slice(1);

      // Allow "i am" as alias for "i-am"
      if (command === 'i' && args[0]?.toLowerCase() === 'am') {
        command = 'i-am';
        args = args.slice(1);
      }

      try {
        switch (command) {
          case 'i-am': {
            if (args.length < 1) throw new Error('Usage: i-am [station] <username> [password]');
            if (args.length >= 2 && isStationAddress(args[0])) {
              // i-am <station> <user> [pass]
              await commandSetFileserver(args[0]);
              serverStation = parseEconetAddress(args[0]);
              const pass = args[2] === ':' ? await readPassword('Password: ') : (args[2] || '');
              await commandIAm(serverStation, args[1], pass);
            } else {
              const pass = args[1] === ':' ? await readPassword('Password: ') : (args[1] || '');
              await commandIAm(serverStation, args[0], pass);
            }
            break;
          }
          case 'bye':
            await commandBye(serverStation);
            break;
          case 'cat':
            await commandCat(serverStation, args[0] || '');
            break;
          case 'dir':
            await commandDir(serverStation, args[0] || '');
            break;
          case 'get': {
            const { recurse, force, positional } = parseFlags(args);
            if (positional.length < 1) throw new Error('Usage: get <path> [-r] [-f]');
            await commandGet(serverStation, positional[0], recurse, force);
            break;
          }
          case 'put': {
            const { recurse, force, positional } = parseFlags(args);
            if (positional.length < 1) throw new Error('Usage: put <path> [-r] [-f]');
            await commandPut(serverStation, positional[0], recurse, force);
            break;
          }
          case 'load':
            if (args.length < 1) throw new Error('Usage: load <filename>');
            await commandLoad(serverStation, args[0]);
            break;
          case 'save':
            if (args.length < 1) throw new Error('Usage: save <localPath> [destPath]');
            await commandSave(serverStation, args[0], args[1]);
            break;
          case 'cdir':
            if (args.length < 1) throw new Error('Usage: cdir <dir>');
            await commandCdir(serverStation, args[0]);
            break;
          case 'access':
            if (args.length < 2) throw new Error('Usage: access <path> <accessString>');
            await commandAccess(serverStation, args[0], args[1]);
            break;
          case 'delete': {
            const { recurse, force, positional } = parseFlags(args);
            if (positional.length < 1) throw new Error('Usage: delete <path> [-r] [-f]');
            await commandDelete(serverStation, positional[0], recurse, force);
            break;
          }
          case 'notify': {
            if (args.length < 2) throw new Error('Usage: notify <station> <message>');
            const localStation = await getLocalStationNum();
            if (localStation === undefined) {
              throw new Error('Local station number not set - please run set-station first');
            }
            const notifyMsg = `-- ${localStation}: ${args.slice(1).join(' ')} --`;
            await commandNotify(args[0], notifyMsg);
            break;
          }
          case 'newuser':
            if (args.length < 1) throw new Error('Usage: newuser <username>');
            await commandNewUser(serverStation, args[0]);
            break;
          case 'remuser':
            if (args.length < 1) throw new Error('Usage: remuser <username>');
            await commandRemUser(serverStation, args[0]);
            break;
          case 'pass':
            if (args.length < 2) throw new Error('Usage: pass <oldPassword> <newPassword>');
            await commandPass(serverStation, args[0], args[1]);
            break;
          case 'priv':
            if (args.length < 1) throw new Error('Usage: priv <username> [S|N]');
            await commandPriv(serverStation, args[0], (args[1] || 'N').toUpperCase());
            break;
          case 'fslist':
            await commandFslist();
            break;
          case 'help':
            console.log(HELP);
            break;
          case 'exit':
          case 'quit':
            closing = true;
            rl.close();
            return;
          default:
            console.error(`Unknown command: ${command}. Type "help" for available commands.`);
        }
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
      }
    };

    rl.on('line', async (line: string) => {
      if (passwordResolve) {
        const resolver = passwordResolve;
        passwordResolve = null;
        resolver(line);
        return;
      }
      rl.pause();
      isBusy = true;
      await processLine(line);
      isBusy = false;
      if (!closing) {
        flushPendingNotifications();
        rl.resume();
        rl.prompt();
      }
    });

    rl.on('close', () => {
      clearInterval(notifyPollInterval);
      driver.eventQueueDestroy(notifyQueue);
      console.log('');
      resolve();
    });
  });
};
