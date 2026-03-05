import { parseEconetAddress } from '../common';
import { setServerNetworkNum, setServerStationNum } from '../config';

export const commandSetFileserver = async (address: string) => {
  const { network, station } = parseEconetAddress(address);
  await setServerNetworkNum(network);
  await setServerStationNum(station);
};
