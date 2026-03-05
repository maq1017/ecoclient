import { parseEconetAddress } from '../common';
import { notify } from '../protocol/notify';

export const commandNotify = async (station: string, message: string) => {
  await notify(parseEconetAddress(station), message);
};
