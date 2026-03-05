import { EconetAddress } from '../common';
import { getHandles } from '../config';
import { bye } from '../protocol/simpleCli';

export const commandBye = async (serverStation: EconetAddress) => {
  await bye(serverStation, await getHandles());
};
