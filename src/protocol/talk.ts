//Based on & compatible with TALK v5.24 by J.G.Harston

import { driver, EconetEvent, RxBroadcastEvent, RxTransmitEvent } from '@jprayner/piconet-nodejs';

export const TALK_PORT = 0xb0;
export const TALK_REPLY_PORT = 0xb1;
export const TALK_CTRL_DISCOVER = 0x80;
export const TALK_CHANNEL_DEFAULT = 0x81;

const TALK_BROADCAST_TIMEOUT_MS = 1000;

// Broadcast: TalkFind — announces our presence, triggers TalkReply from others
export const sendTalkFind = async () => {
  const data = Buffer.concat([Buffer.from([TALK_CTRL_DISCOVER, TALK_PORT]), Buffer.from('TALK    ')]);
  return driver.broadcast(data, TALK_BROADCAST_TIMEOUT_MS);
};

// Broadcast: ServerFind — asks existing clients to identify themselves with name
export const sendServerFind = async () => {
  const data = Buffer.concat([Buffer.from([TALK_CTRL_DISCOVER, TALK_PORT]), Buffer.from('        ')]);
  return driver.broadcast(data, TALK_BROADCAST_TIMEOUT_MS);
};

// Response to a TalkFind broadcast
export const sendTalkReply = async (station: number, network: number) => {
  return driver.transmit(station, network, TALK_CTRL_DISCOVER, TALK_PORT, Buffer.from('TALK_RPL'));
};

// Response to a ServerFind broadcast — includes our name
export const sendServerReply = async (station: number, network: number, myName: string) => {
  const nameBytes = Buffer.from(myName.slice(0, 13));
  const data = Buffer.alloc(12 + nameBytes.length);
  data[0] = 0x00;
  data[1] = TALK_PORT;
  data[2] = 0x52; // version 5.2
  Buffer.from('TALK    ').copy(data, 3);
  data[11] = nameBytes.length;
  nameBytes.copy(data, 12);
  return driver.transmit(station, network, TALK_CTRL_DISCOVER, TALK_REPLY_PORT, data);
};

// Send a talk message to a specific station
export const sendTalkMessage = async (
  station: number,
  network: number,
  flag: string,
  myName: string,
  message: string,
  channel = TALK_CHANNEL_DEFAULT,
) => {
  const parts: number[] = [flag.charCodeAt(0), 0x00];
  if (flag !== ';') {
    for (const ch of myName) {
      parts.push(ch === ' ' ? 0x80 : ch.charCodeAt(0));
    }
    parts.push(0x0d);
  }
  for (const ch of message) {
    parts.push(ch.charCodeAt(0));
  }
  parts.push(0x0d);
  return driver.transmit(station, network, channel, TALK_PORT, Buffer.from(parts));
};

// Event queue for all incoming TALK protocol events
export const createTalkEventQueue = () => {
  return driver.eventQueueCreate(
    (event: EconetEvent) =>
      event instanceof RxBroadcastEvent ||
      (event instanceof RxTransmitEvent &&
        event.scoutFrame.length >= 6 &&
        (event.scoutFrame[5] === TALK_PORT || event.scoutFrame[5] === TALK_REPLY_PORT)),
  );
};

export type ParsedBroadcast = {
  srcStation: number;
  srcNetwork: number;
  data: Buffer;
};

export type ParsedTransmit = {
  srcStation: number;
  srcNetwork: number;
  ctrl: number;
  port: number;
  data: Buffer;
};

export type ParsedTalkMessage = {
  flag: string;
  senderName: string;
  message: string;
};

export const parseBroadcast = (event: RxBroadcastEvent): ParsedBroadcast => ({
  srcStation: event.econetFrame[2],
  srcNetwork: event.econetFrame[3],
  data: event.econetFrame.slice(6),
});

export const parseTransmit = (event: RxTransmitEvent): ParsedTransmit => ({
  srcStation: event.scoutFrame[2],
  srcNetwork: event.scoutFrame[3],
  ctrl: event.scoutFrame[4],
  port: event.scoutFrame[5],
  data: event.dataFrame.slice(4),
});

export const parseTalkMessage = (data: Buffer): ParsedTalkMessage | undefined => {
  if (data.length < 2) return undefined;

  const flag = String.fromCharCode(data[0]);
  let offset = 2; // skip flag + zero byte

  let senderName = '';
  while (offset < data.length && data[offset] !== 0x0d) {
    const byte = data[offset++];
    if (byte === 0x80) {
      senderName += ' ';
    } else if (byte >= 32) {
      senderName += String.fromCharCode(byte);
    }
  }
  if (offset < data.length) offset++; // skip 0x0D

  let message = '';
  while (offset < data.length && data[offset] !== 0x0d) {
    const byte = data[offset++];
    if (byte >= 32 || byte === 0x0a) {
      message += String.fromCharCode(byte);
    }
  }

  return { flag, senderName, message };
};

// Parse a ServerReply data payload (data[0..] from parseTransmit)
export const parseServerReply = (data: Buffer): string | undefined => {
  if (data.length < 12) return undefined;
  if (data[0] !== 0x00 || data[1] !== TALK_PORT) return undefined;
  if (!data.slice(3, 11).equals(Buffer.from('TALK    '))) return undefined;
  const nameLen = data[11];
  if (nameLen === 0 || nameLen > 13 || data.length < 12 + nameLen) return undefined;
  return data.slice(12, 12 + nameLen).toString('ascii');
};
