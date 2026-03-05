import { EconetAddress } from '../common';
import { getHandles, setHandleCurrentDir } from '../config';
import { dir } from '../protocol/dir';

export const commandDir = async (serverStation: EconetAddress, dirPath: string) => {
  const dirInfo = await dir(serverStation, dirPath, await getHandles());
  await setHandleCurrentDir(dirInfo.handleCurrentDir);
};
