import { driver, EconetEvent, RxTransmitEvent } from '@jprayner/piconet-nodejs';
import { fsControlByte, fsPort, replyPort, sleepMs } from '../common';

export type FileServerInfo = {
  network: number;
  station: number;
  version: string;
};

const fslistTimeoutMs = 5000;
const fsVerFunctionCode = 0x19;

export const fslist = async (): Promise<FileServerInfo[]> => {
  const queue = driver.eventQueueCreate(
    (event: EconetEvent) =>
      event instanceof RxTransmitEvent &&
      event.scoutFrame.length >= 6 &&
      event.scoutFrame[5] === replyPort,
  );

  try {
    const broadcastData = Buffer.from([fsControlByte, fsPort, replyPort, fsVerFunctionCode]);
    const txResult = await driver.broadcast(broadcastData);

    if (!txResult.success) {
      throw new Error(`Failed to send FSVER broadcast: ${txResult.description}`);
    }

    const servers: FileServerInfo[] = [];
    const startTime = Date.now();

    while (Date.now() - startTime < fslistTimeoutMs) {
      const event = driver.eventQueueShift(queue);

      if (!event) {
        await sleepMs(10);
        continue;
      }

      if (event instanceof RxTransmitEvent) {
        const srcStation = event.scoutFrame[2];
        const srcNetwork = event.scoutFrame[3];
        const versionData = event.dataFrame.slice(6);
        const version = versionData.toString('ascii').replace(/[\x00\r\n]/g, '').trim();
        servers.push({ network: srcNetwork, station: srcStation, version });
      }
    }

    return servers;
  } finally {
    driver.eventQueueDestroy(queue);
  }
};
