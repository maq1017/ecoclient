import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { changePassword } from '../protocol/simpleCli';

export const commandPass = async (
  serverStation: EconetAddress,
  oldPassword: string,
  newPassword: string,
) => {
  await changePassword(
    serverStation,
    oldPassword,
    newPassword,
    await getHandles(),
  );
};
