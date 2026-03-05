import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { setPrivileged } from '../protocol/simpleCli';

export const commandPriv = async (
  serverStation: EconetAddress,
  username: string,
  level: string,
) => {
  await setPrivileged(serverStation, username, level, await getHandles());
};
