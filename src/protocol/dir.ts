import { DirectoryHandles, EconetAddress, executeCliCommand } from '../common';

export const dir = async (
  serverStation: EconetAddress,
  path: string,
  handles: DirectoryHandles,
) => {
  const serverReply = await executeCliCommand(
    serverStation,
    `DIR ${path}`,
    handles,
  );

  if (serverReply.data.length < 1) {
    throw new Error(
      `Malformed response from station ${serverStation.network}.${serverStation.station}: success but not enough data`,
    );
  }

  return {
    handleCurrentDir: serverReply.data[0],
  };
};
