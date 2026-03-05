import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { access } from '../protocol/simpleCli';

export const commandAccess = async (
  serverStation: EconetAddress,
  pathToSetAccess: string,
  accessString: string,
) => {
  await access(
    serverStation,
    pathToSetAccess,
    accessString,
    await getHandles(),
  );
};
