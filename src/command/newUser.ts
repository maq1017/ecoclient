import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { newUser } from '../protocol/simpleCli';

export const commandNewUser = async (
  serverStation: EconetAddress,
  username: string,
) => {
  await newUser(serverStation, username, await getHandles());
};
