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
  sendServerFind,
  sendTalkReply,
  sendServerReply,
  sendTalkMessage,
} from '../protocol/talk';

const PING_INTERVAL_MS = 3000;
const MAX_PING_COUNT = 30;
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

export const commandTalk = async (myName: string) => {
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

  const sendToAll = async (flag: string, message: string) => {
    for (const user of users) {
      try {
        await sendTalkMessage(user.station, user.network, flag, myName, message, channel);
        await sleepMs(10);
      } catch {
        // ignore individual send errors
      }
    }
    lastPingMs = Date.now();
  };

  console.log('\nEconet Network Conferencer');
  console.log(`Channel: ${channel ^ 0x80}`);
  console.log(`Your name: ${myName}`);
  console.log('Broadcasting presence...\n');

  const queue = createTalkEventQueue();

  // Send initial discovery broadcasts
  for (let i = 0; i < 5; i++) {
    try {
      await sendTalkFind();
      await sendServerFind();
    } catch {
      // ignore
    }
    await sleepMs(100);
  }
  lastPingMs = Date.now();

  console.log('Type *H for help\n');

  return new Promise<void>(resolve => {
    let closing = false;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    const displayMessage = (msg: string) => {
      const currentLine = (rl as any).line as string || '';
      process.stdout.write(`\r\x1b[K${msg}\n`);
      process.stdout.write(`> ${currentLine}`);
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
            await sendToAll('>', 'Logging off');
            closing = true;
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
            await sendTalkMessage(target.station, target.network, ']', myName, message, channel);
          } catch (e) {
            console.error(e instanceof Error ? e.message : e);
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
      try {
        await sendToAll(':', trimmed);
      } catch (e) {
        console.error(e instanceof Error ? e.message : e);
      }
    };

    // Incoming packet handler
    const handleEvent = async (event: EconetEvent) => {
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

    // Network polling interval
    const pollInterval = setInterval(async () => {
      // Drain and handle all queued events
      let event: EconetEvent | undefined;
      while ((event = driver.eventQueueShift(queue)) !== undefined) {
        await handleEvent(event);
      }

      // Periodic presence broadcasts
      const now = Date.now();
      if (pingCount > 0 && now - lastPingMs >= PING_INTERVAL_MS) {
        try {
          await sendTalkFind();
          lastPingMs = now;
          pingCount--;
        } catch {
          // ignore
        }
      }
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
      driver.eventQueueDestroy(queue);
      console.log('');
      resolve();
    });
  });
};
