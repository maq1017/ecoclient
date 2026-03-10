import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { cdir } from '../protocol/simpleCli';

export const commandCdir = async (serverStation: EconetAddress, dirPath: string) => {
  await cdir(serverStation, dirPath, await getHandles());
};
