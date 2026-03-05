import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { removeUser } from '../protocol/simpleCli';

export const commandRemUser = async (
  serverStation: EconetAddress,
  username: string,
) => {
  await removeUser(serverStation, username, await getHandles());
};
