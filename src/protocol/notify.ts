import { driver, EconetEvent, RxTransmitEvent } from '@jprayner/piconet-nodejs';
import { EconetAddress } from '../common';

const NOTIFY_CONTROL_BYTE = 0x85;
const NOTIFY_PORT = 0x00;

export const notify = async (station: EconetAddress, message: string) => {
  for (const char of message) {
    await driver.transmit(
      station.station,
      station.network,
      NOTIFY_CONTROL_BYTE,
      NOTIFY_PORT,
      Buffer.from(char),
      Buffer.from([0x00, 0x00, char.charCodeAt(0), 0x00]),
    );
  }
};

export const createNotifyListenerQueue = () => {
  return driver.eventQueueCreate(
    (event: EconetEvent) =>
      event instanceof RxTransmitEvent &&
      event.scoutFrame.length >= 6 &&
      event.scoutFrame[4] === NOTIFY_CONTROL_BYTE &&
      event.scoutFrame[5] === NOTIFY_PORT,
  );
};

export const extractNotifyChar = (event: RxTransmitEvent): string | undefined => {
  if (event.dataFrame.length < 5) return undefined;
  return String.fromCharCode(event.dataFrame[4]);
};

export const notifySenderStation = (event: RxTransmitEvent): string => {
  const srcStn = event.scoutFrame[2];
  const srcNet = event.scoutFrame[3];
  return srcNet === 0 ? `${srcStn}` : `${srcNet}.${srcStn}`;
};
