import { fslist } from '../protocol/fslist';

export const commandFslist = async () => {
  const servers = await fslist();
  if (servers.length === 0) {
    console.log('No file servers found');
    return;
  }

  servers.forEach(server => {
    const address = server.network > 0
      ? `${server.network}.${server.station}`
      : `${server.station}`;
    console.log(`${address.padEnd(8)} ${server.version}`);
  });
};
