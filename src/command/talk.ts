import * as readline from 'readline';
import { driver, EconetEvent, RxBroadcastEvent, RxTransmitEvent } from '@jprayner/piconet-nodejs';
import { sleepMs } from '../common';
import {
  TALK_PORT,
  TALK_REPLY_PORT,
  TALK_CTRL_DISCOVER,
  TALK_CHANNEL_DEFAULT,
  createTalkEventQueue,
  parseBroadcast,
  parseTransmit,
  parseTalkMessage,
  parseServerReply,
  sendTalkFind,
  sendTalkReply,
  sendServerReply,
  sendTalkMessage,
} from '../protocol/talk';

const PING_INTERVAL_MS = 500;
const MAX_PING_COUNT = 5;
const POLL_INTERVAL_MS = 50;

type TalkUser = {
  station: number;
  network: number;
  name: string;
};

const HELP = `
Commands (prefix with *):
  *A <[net.]stn>  Add a station to the default list
  *C <num>        Change channel number
  *H              This help
  *Q              Quit
  *R <index>      Remove user from default list (use *U to see indices)
  *U              List users on default

Sending messages:
  <message>              Sends to all stations on the default list
  :<name> <message>      Sends directly to a named user
`;

export const commandTalk = async (myName: string, localStation: number) => {
  const users: TalkUser[] = [];
  let channel = TALK_CHANNEL_DEFAULT;
  let pingCount = MAX_PING_COUNT;
  let lastPingMs = 0;

  const findUser = (station: number, network: number) =>
    users.findIndex(u => u.station === station && u.network === network);

  const addUser = (station: number, network: number, name?: string): number => {
    const idx = findUser(station, network);
    if (idx >= 0) {
      if (name) users[idx].name = name;
      return idx;
    }
    const newIdx = users.length;
    users.push({
      station,
      network,
      name: name ?? (network > 0 ? `${network}.${station}` : `${station}`),
    });
    return newIdx;
  };

  const formatStation = (station: number, network: number) =>
    network > 0 ? `${network}.${station}` : `${station}`;

  console.log('\nEconet Network Conferencer');
  console.log(`Channel: ${channel ^ 0x80}`);
  console.log(`Your name: ${myName}`);
  console.log('Type *H for help\n');

  const queue = createTalkEventQueue();
  driver.setDebugEnabled(false);

  // Trigger first ping immediately rather than waiting PING_INTERVAL_MS
  lastPingMs = Date.now() - PING_INTERVAL_MS;

  return new Promise<void>(resolve => {
    let closing = false;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    const displayMessage = (msg: string) => {
      process.stdout.write(`\r\x1b[K${msg}\n`);
      (rl as any)._refreshLine();
    };

    const processCommand = async (input: string) => {
      const trimmed = input.trim();
      if (trimmed.length === 0) return;

      if (trimmed[0] === '*') {
        const cmd = trimmed[1]?.toUpperCase();
        const arg = trimmed.slice(2).trim();

        switch (cmd) {
          case 'A': {
            const parts = arg.split('.');
            let station: number, network: number;
            if (parts.length === 2) {
              network = parseInt(parts[0]);
              station = parseInt(parts[1]);
            } else {
              network = 0;
              station = parseInt(arg);
            }
            if (!isNaN(station) && station > 0) {
              addUser(station, network);
              console.log(`Added station ${formatStation(station, network)}`);
            } else {
              console.log('Usage: *A <[net.]station>');
            }
            break;
          }

          case 'C': {
            const ch = parseInt(arg);
            if (!isNaN(ch) && ch > 0) {
              await sendToAll('>', 'Changing channel');
              channel = (ch | 0x80) & 0xff;
              await sendToAll('>', 'Has arrived');
              console.log(`Channel changed to ${channel ^ 0x80}`);
            } else {
              console.log('Usage: *C <channel>');
            }
            break;
          }

          case 'H':
            console.log(HELP);
            break;

          case 'Q':
            void sendToAll('>', 'Logging off');
            closing = true;
            console.log('Logging off...');
            rl.close();
            break;

          case 'R': {
            const idx = parseInt(arg);
            if (!isNaN(idx) && idx >= 0 && idx < users.length) {
              console.log(`Removed ${users[idx].name}`);
              users.splice(idx, 1);
            } else {
              console.log(`Usage: *R <index>  (use *U to list users)`);
            }
            break;
          }

          case 'U':
            if (users.length === 0) {
              console.log('Nobody on the default list yet.');
            } else {
              console.log('\nPeople on default:');
              users.forEach((u, i) =>
                console.log(`  ${i}: ${u.name} (${formatStation(u.station, u.network)})`),
              );
              console.log('');
            }
            break;

          default:
            console.log(`Unknown command. Type *H for help.`);
        }
        return;
      }

      // Direct message: :name message
      if (trimmed[0] === ':') {
        const space = trimmed.indexOf(' ', 1);
        if (space < 0) {
          console.log('Usage: :<name> <message>');
          return;
        }
        const targetName = trimmed.slice(1, space);
        const message = trimmed.slice(space + 1);

        // Find by name first, then try as station number
        let target = users.find(u => u.name.toLowerCase() === targetName.toLowerCase());
        if (!target) {
          const parts = targetName.split('.');
          let stn: number, net: number;
          if (parts.length === 2) {
            net = parseInt(parts[0]);
            stn = parseInt(parts[1]);
          } else {
            net = 0;
            stn = parseInt(targetName);
          }
          if (!isNaN(stn)) {
            target = { station: stn, network: net, name: targetName };
          }
        }

        if (target) {
          try {
            dbg('TX', 'MSG', fmtStn(target.station, target.network), me, channel, TALK_PORT, buildMsgPayload(']', myName, message));
            const result = await sendTalkMessage(target.station, target.network, ']', myName, message, channel);
            if (!result.success) {
              displayMessage(`[${targetName}: ${result.description}]`);
            }
          } catch (e) {
            displayMessage(`[${targetName}: ${e instanceof Error ? e.message : String(e)}]`);
          }
        } else {
          console.log(`User not found: ${targetName}`);
        }
        return;
      }

      // Broadcast to all
      if (users.length === 0) {
        console.log('Nobody has responded yet.');
        return;
      }
      const errors = await sendToAll(':', trimmed);
      for (const { user, error } of errors) {
        displayMessage(`[${user.name}: ${error}]`);
      }
    };

    const fmtStn = (station: number, network: number) =>
      `${network.toString().padStart(3, '0')}.${station.toString().padStart(3, '0')}`;
    const fmtPayload = (buf: Buffer) => {
      const hex = buf.toString('hex').replace(/../g, '$& ').trim();
      const ascii = buf.toString('ascii').replace(/[^\x20-\x7e]/g, '.');
      return `${hex}  "${ascii}"`;
    };
    const buildMsgPayload = (flag: string, name: string, message: string) => {
      const parts: number[] = [flag.charCodeAt(0), 0x00];
      if (flag !== ';') {
        for (const ch of name) parts.push(ch === ' ' ? 0x80 : ch.charCodeAt(0));
        parts.push(0x0d);
      }
      for (const ch of message) parts.push(ch.charCodeAt(0));
      parts.push(0x0d);
      return Buffer.from(parts);
    };
    const me = fmtStn(localStation, 0);
    const dbg = (direction: 'RX' | 'TX', type: 'BCAST' | 'MSG', dst: string, src: string, ctrl: number, port: number, payload: Buffer) => {
      const c = ctrl.toString(16).padStart(2, '0');
      const p = port.toString(16).padStart(2, '0');
      displayMessage(`[${direction} ${type.padEnd(5)} ${dst}<-${src} ctrl=${c} port=${p}] ${fmtPayload(payload)}`);
    };

    const debugEvent = (event: EconetEvent) => {
      if (event instanceof RxBroadcastEvent) {
        const f = event.econetFrame;
        dbg('RX', 'BCAST', fmtStn(f[0], f[1]), fmtStn(f[2], f[3]), f[4], f[5], f.slice(6));
      } else if (event instanceof RxTransmitEvent) {
        const s = event.scoutFrame;
        dbg('RX', 'MSG', fmtStn(s[0], s[1]), fmtStn(s[2], s[3]), s[4], s[5], event.dataFrame.slice(4));
      }
    };

    const sendToAll = async (flag: string, message: string): Promise<Array<{ user: TalkUser; error: string }>> => {
      const errors: Array<{ user: TalkUser; error: string }> = [];
      for (const user of users) {
        try {
          dbg('TX', 'MSG', fmtStn(user.station, user.network), me, channel, TALK_PORT, buildMsgPayload(flag, myName, message));
          const result = await sendTalkMessage(user.station, user.network, flag, myName, message, channel);
          if (!result.success) {
            errors.push({ user, error: result.description });
          }
          await sleepMs(10);
        } catch (e) {
          errors.push({ user, error: e instanceof Error ? e.message : String(e) });
        }
      }
      lastPingMs = Date.now();
      return errors;
    };

    // Incoming packet handler
    const handleEvent = async (event: EconetEvent) => {
      debugEvent(event);
      if (event instanceof RxBroadcastEvent) {
        const { srcStation, srcNetwork, data } = parseBroadcast(event);

        // ServerFind (8 spaces) — reply with our name
        if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from('        '))) {
          try {
            await sendServerReply(srcStation, srcNetwork, myName);
          } catch {
            // ignore
          }
          return;
        }

        // TalkFind ("TALK    ") — reply to acknowledge
        if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from('TALK    '))) {
          try {
            dbg('TX', 'MSG', fmtStn(srcStation, srcNetwork), me, TALK_CTRL_DISCOVER, TALK_PORT, Buffer.from('TALK_RPL'));
            await sendTalkReply(srcStation, srcNetwork);
          } catch {
            // ignore
          }
          return;
        }

        // TalkReply ("TALK_RPL") received as broadcast data
        if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from('TALK_RPL'))) {
          const wasNew = findUser(srcStation, srcNetwork) < 0;
          addUser(srcStation, srcNetwork);
          if (wasNew) {
            displayMessage(`[Station ${formatStation(srcStation, srcNetwork)} acknowledged]`);
            try {
              dbg('TX', 'MSG', fmtStn(srcStation, srcNetwork), me, channel, TALK_PORT, buildMsgPayload('>', myName, 'Logging on'));
              await sendTalkMessage(srcStation, srcNetwork, '>', myName, 'Logging on', channel);
            } catch {
              // ignore
            }
          }
        }
      } else if (event instanceof RxTransmitEvent) {
        const { srcStation, srcNetwork, ctrl, port, data } = parseTransmit(event);

        // ServerReply (port 0xB1, ctrl 0x80) — extract name
        if (port === TALK_REPLY_PORT && ctrl === TALK_CTRL_DISCOVER) {
          const name = parseServerReply(data);
          if (name) {
            const wasNew = findUser(srcStation, srcNetwork) < 0;
            addUser(srcStation, srcNetwork, name);
            if (wasNew) {
              displayMessage(`[Station ${formatStation(srcStation, srcNetwork)} (${name}) joined]`);
              try {
                dbg('TX', 'MSG', fmtStn(srcStation, srcNetwork), me, channel, TALK_PORT, buildMsgPayload('>', myName, 'Logging on'));
                await sendTalkMessage(srcStation, srcNetwork, '>', myName, 'Logging on', channel);
              } catch {
                // ignore
              }
            }
          }
          return;
        }

        if (port !== TALK_PORT) return;

        // TalkReply ("TALK_RPL") as a directed transmit
        if (ctrl === TALK_CTRL_DISCOVER) {
          if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from('TALK_RPL'))) {
            const wasNew = findUser(srcStation, srcNetwork) < 0;
            addUser(srcStation, srcNetwork);
            if (wasNew) {
              displayMessage(`[Station ${formatStation(srcStation, srcNetwork)} acknowledged]`);
              try {
                dbg('TX', 'MSG', fmtStn(srcStation, srcNetwork), me, channel, TALK_PORT, buildMsgPayload('>', myName, 'Logging on'));
                await sendTalkMessage(srcStation, srcNetwork, '>', myName, 'Logging on', channel);
              } catch {
                // ignore
              }
            }
          } else if (data.length >= 8 && data.slice(0, 8).equals(Buffer.from('TALK    '))) {
            // TalkFind received as unicast (bridge converts broadcast→unicast) — reply with TALKRPL
            try {
              dbg('TX', 'MSG', fmtStn(srcStation, srcNetwork), me, TALK_CTRL_DISCOVER, TALK_PORT, Buffer.from('TALK_RPL'));
              await sendTalkReply(srcStation, srcNetwork);
            } catch {
              // ignore
            }
          }
          return;
        }

        // Talk message (ctrl matches channel)
        if (ctrl === channel) {
          const parsed = parseTalkMessage(data);
          if (parsed) {
            const { flag, senderName, message } = parsed;
            if (senderName) addUser(srcStation, srcNetwork, senderName);
            const prefix = senderName ? `${senderName}${flag} ` : '';
            displayMessage(`${prefix}${message}`);
          }
        }
      }
    };

    // Network polling interval — chained so only one poll runs at a time,
    // preventing concurrent broadcasts from confusing the board.
    let currentPoll: Promise<void> = Promise.resolve();

    const pollInterval = setInterval(() => {
      currentPoll = currentPoll
        .then(async () => {
          if (closing) return;

          // Drain and handle all queued events
          let event: EconetEvent | undefined;
          while ((event = driver.eventQueueShift(queue)) !== undefined) {
            await handleEvent(event);
          }

          // Periodic presence broadcasts
          if (!closing) {
            const now = Date.now();
            if (pingCount > 0 && now - lastPingMs >= PING_INTERVAL_MS) {
              try {
                dbg('TX', 'BCAST', '255.255', me, TALK_CTRL_DISCOVER, TALK_PORT, Buffer.from('TALK    '));
                await sendTalkFind();
                lastPingMs = now;
                pingCount--;
              } catch {
                // ignore
              }
            }
          }
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);

    rl.prompt();

    rl.on('line', async (line: string) => {
      rl.pause();
      await processCommand(line);
      if (!closing) {
        rl.resume();
        rl.prompt();
      }
    });

    rl.on('close', () => {
      clearInterval(pollInterval);
      // Wait for any in-flight poll (e.g. a broadcast) to finish before
      // cleanup, so we never race driver.setMode('STOP') against a pending
      // BCAST command which leaves the board in a bad state.
      void currentPoll.then(() => {
        driver.eventQueueDestroy(queue);
        console.log('');
        resolve();
      });
    });
  });
};
