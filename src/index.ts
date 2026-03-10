#! /usr/bin/env node
import { driver } from '@jprayner/piconet-nodejs';
import { Command } from '@commander-js/extra-typings';

import { ConfigOptions, EconetAddress, initConnection, parseEconetAddress } from './common';
import { PKG_VERSION } from './version';
import { getLocalStationNum, getServerNetworkNum, getServerStationNum } from './config';
import { commandIAm } from './command/iAm';
import { commandSetFileserver } from './command/setFileserver';
import { commandGetStatus } from './command/getStatus';
import { commandSetStation } from './command/setStation';
import { commandSetMetadata } from './command/setMetadata';
import { commandNotify } from './command/notify';
import { commandDir } from './command/dir';
import { commandMonitor } from './command/monitor';
import { commandBye } from './command/bye';
import { commandDelete } from './command/delete';
import { commandGet } from './command/get';
import { commandPut } from './command/put';
import { commandLoad } from './command/load';
import { commandSave } from './command/save';
import { commandCat } from './command/cat';
import { commandCdir } from './command/cdir';
import { commandAccess } from './command/access';
import { commandNewUser } from './command/newUser';
import { commandRemUser } from './command/remUser';
import { commandPass } from './command/pass';
import { commandPriv } from './command/priv';
import { commandInteractive } from './command/interactive';
import { commandFslist } from './command/fslist';
import { commandTalk } from './command/talk';
import { readHiddenPassword } from './util/readPassword';

type CliOptions = {
  debug?: true | undefined;
  devicename?: string | undefined;
  station?: string | undefined;
  fileserver?: string | undefined;
};

const program = new Command()
  .name('ecoclient')
  .description('Econet fileserver client')
  .version(PKG_VERSION, '-V, --version', 'Output the version number')
  .helpOption('-h, --help', 'Display help for command')
  .option('-d, --debug', 'Enable debug output')
  .option('-n, --devicename <string>', 'Specify device name/path')
  .option('-s, --station <number>', 'Specify local Econet station number')
  .option('-fs, --fileserver <address>', 'Specify fileserver address (e.g. 254 or 1.254)')
  .option('-i, --interactive', 'Start an interactive shell session with the fileserver')
  .addHelpText('after', ' ')
  .action(async () => {
    if (program.opts().interactive) {
      const config = await resolveConfig(program.opts());
      await connectionWrapper(commandInteractive, config, config.serverStation);
    } else {
      program.help();
    }
  });

program
  .command('set-fs')
  .description('Set fileserver')
  .argument('[net.]<station>', 'Station number')
  .action(async station => {
    await errorHandlingWrapper(commandSetFileserver, station);
  });

program
  .command('set-station')
  .description('Set Econet station')
  .argument('<station>', 'Station number')
  .action(async station => {
    await errorHandlingWrapper(commandSetStation, station);
  });

program
  .command('status')
  .description('Display status info for ecoclient and board')
  .action(async () => {
    const config = await resolveConfig(program.opts());
    await errorHandlingWrapper(commandGetStatus, config);
  });

program
  .command('set-metadata')
  .description('Set metadata storage mechanism')
  .argument('<type>', 'Storage type (inf|filename|none)')
  .action(async metadataType => {
    await errorHandlingWrapper(commandSetMetadata, metadataType);
  });

program
  .command('i-am')
  .description('Logon to fileserver like a "*I AM" command')
  .argument('<username>', 'Username')
  .argument('[password]', 'Password (use ":" to be prompted securely)')
  .action(async (username, password) => {
    const config = await resolveConfig(program.opts());
    const actualPassword = password === ':' ? await readHiddenPassword('Password: ') : (password || '');
    await connectionWrapper(
      commandIAm,
      config,
      config.serverStation,
      username,
      actualPassword,
    );
  });

program
  .command('notify')
  .description(
    'Send notification message to a station like a "*NOTIFY" command',
  )
  .argument('[net.]<station>', 'Station number')
  .argument('<message>', 'Message')
  .action(async (station, message) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandNotify, config, station, message);
  });

program
  .command('dir')
  .description('Change current directory')
  .argument('[dir]', 'Directory path', '')
  .action(async dirPath => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandDir, config, config.serverStation, dirPath);
  });

program
  .command('monitor')
  .description('Listen for network traffic like a "*NETMON" command')
  .action(async () => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandMonitor, config);
  });

program
  .command('fslist')
  .description('List file servers on the network')
  .action(async () => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandFslist, config);
  });

program
  .command('talk')
  .description('Join the Econet Network Conferencer (Talk)')
  .argument('[name]', 'Your display name (max 12 characters)')
  .action(async (nameArg, _cmdOpts) => {
    const cliOptions = program.opts();
    const stationOption = cliOptions.station;
    const localStation =
      typeof stationOption === 'string' ? parseInt(stationOption) : await getLocalStationNum();
    if (typeof localStation === 'undefined') {
      console.error(
        'You must specify an econet station number using --station or set-station command',
      );
      process.exit(1);
    }

    let name = (nameArg ?? '').slice(0, 12).trim();
    if (!name) {
      const { createInterface } = await import('readline');
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      name = await new Promise<string>(res =>
        rl.question('What is your name? ', answer => {
          rl.close();
          res(answer.slice(0, 12).trim());
        }),
      );
    }
    if (!name) {
      console.error('Name is required.');
      process.exit(1);
    }

    const deviceName =
      typeof cliOptions.devicename === 'string' ? cliOptions.devicename : undefined;
    const debugEnabled = cliOptions.debug === true;
    await initConnection(deviceName, localStation, debugEnabled);
    driver.setDebugEnabled(debugEnabled);
    try {
      await errorHandlingWrapper(commandTalk, name, localStation, debugEnabled);
    } finally {
      try {
        await driver.setMode('STOP');
      } catch {
        // ignore
      }
      await driver.close();
      // Readline's close() internally calls stdin.resume(), which leaves stdin
      // as a referenced handle that would keep the process alive. Unref it here,
      // after all driver cleanup is done, so the process can exit cleanly.
      process.stdin.unref();
    }
  });

program
  .command('bye')
  .description('Logout of fileserver like a "*BYE" command')
  .action(async () => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandBye, config, config.serverStation);
  });

program
  .command('delete')
  .description('Delete file(s) from fileserver')
  .argument(
    '<pathPattern>',
    'Path for file(s)/dir(s) to delete (* matches multiple chars, ? matches single char)',
  )
  .option('-r, --recurse', 'Recurse subdirectories')
  .option('-f, --force', 'Force deletion without prompting')
  .action(async (pathPattern, commandOpts) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandDelete,
      config,
      config.serverStation,
      pathPattern,
      commandOpts.recurse || false,
      commandOpts.force || false,
    );
  });

program
  .command('get')
  .description('Get file(s)/dir(s) from fileserver using "LOAD" command')
  .argument(
    '<pathPattern>',
    'Path for file(s)/dir(s) to get (* matches multiple chars, ? matches single char)',
  )
  .option('-r, --recurse', 'Recurse subdirectories')
  .option('-f, --force', 'Force overwrite of existing files')
  .action(async (pathPattern, commandOpts) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandGet,
      config,
      config.serverStation,
      pathPattern,
      commandOpts.recurse || false,
      commandOpts.force || false,
    );
  });

program
  .command('put')
  .description('Put file(s)/dir(s) to fileserver using "SAVE" command')
  .argument(
    '<pathPattern>',
    'Path for file(s)/dir(s) to put (* matches multiple chars, ? matches single char)',
  )
  .option('-r, --recurse', 'Recurse subdirectories')
  .option('-f, --force', 'Force overwrite of existing files')
  .action(async (pathPattern, commandOpts) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandPut,
      config,
      config.serverStation,
      pathPattern,
      commandOpts.recurse || false,
      commandOpts.force || false,
    );
  });

program
  .command('load')
  .description('Load basic file and detokenise (needs basictool installed)')
  .argument('<filename>', 'Filename')
  .action(async filename => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandLoad,
      config,
      config.serverStation,
      filename,
    );
  });

program
  .command('save')
  .description('Save basic file after detokenising (needs basictool installed)')
  .argument('<localPath>', 'Path to file on local filesystem')
  .argument(
    '[destPath]',
    'Path to file on fileserver (defaults to filename part of localPath)',
  )
  .action(async (localPath, destPath) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandSave,
      config,
      config.serverStation,
      localPath,
      destPath,
    );
  });

program
  .command('cat')
  .description('Get catalogue of directory from fileserver')
  .argument('[dirPath]', 'Directory path', '')
  .action(async dirPath => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandCat, config, config.serverStation, dirPath);
  });

program
  .command('cdir')
  .description('Create directory on fileserver')
  .argument('<dirPath>', 'Directory path')
  .action(async dirPath => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(commandCdir, config, config.serverStation, dirPath);
  });

program
  .command('access')
  .description('Set access on fileserver')
  .argument('<path>', 'File path')
  .argument('<accessString>', 'Access string')
  .action(async (remotePath, accessString) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandAccess,
      config,
      config.serverStation,
      remotePath,
      accessString,
    );
  });

program
  .command('newuser')
  .description('Create a new user account on fileserver')
  .argument('<username>', 'Username')
  .action(async username => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandNewUser,
      config,
      config.serverStation,
      username,
    );
  });

program
  .command('remuser')
  .description('Remove a user account from fileserver')
  .argument('<username>', 'Username')
  .action(async username => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandRemUser,
      config,
      config.serverStation,
      username,
    );
  });

program
  .command('pass')
  .description('Change password for current user')
  .argument('<oldPassword>', 'Old password')
  .argument('<newPassword>', 'New password')
  .action(async (oldPassword, newPassword) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandPass,
      config,
      config.serverStation,
      oldPassword,
      newPassword,
    );
  });

program
  .command('priv')
  .description('Assign privilege level to user')
  .argument('<username>', 'Username')
  .argument(
    '[privilegeChar]',
    '"S" == System, "N" (or omit) == Normal, others are system/level-dependent',
  )
  .action(async (username, privilegeChar) => {
    const config = await resolveConfig(program.opts());
    await connectionWrapper(
      commandPriv,
      config,
      config.serverStation,
      username,
      privilegeChar?.toUpperCase() ?? 'N',
    );
  });

const main = async () => {
  await program.parseAsync(process.argv);
};

const resolveConfig = async (cliOptions: CliOptions) => {
  const deviceName =
    typeof cliOptions.devicename === 'string'
      ? cliOptions.devicename
      : undefined;

  const serverStationOption = cliOptions.fileserver;
  const serverStation: EconetAddress =
    typeof serverStationOption === 'string'
      ? parseEconetAddress(serverStationOption)
      : { network: await getServerNetworkNum(), station: await getServerStationNum() };

  const stationOption = cliOptions.station;
  const localStation =
    typeof stationOption === 'string'
      ? parseInt(stationOption)
      : await getLocalStationNum();
  if (typeof localStation === 'undefined') {
    throw new Error(
      'You must specify an econet station number for this machine using the --station option (or store a default value using the set-station command)',
    );
  }

  const debugOption = cliOptions.debug;
  const debugEnabled = typeof debugOption === 'boolean' ? debugOption : false;

  return {
    deviceName,
    serverStation,
    localStation,
    debugEnabled,
  } as ConfigOptions;
};

/**
 * Wraps a command function so a thrown error is sensibly logged and a non-zero status code is returned.
 *
 * @param operation The function to wrap.
 * @param parameters The parameters to pass to operation.
 * @returns The result of the operation.
 */
async function errorHandlingWrapper<Args extends unknown[], Return>(
  operation: (...operationParameters: Args) => Promise<Return>,
  ...parameters: Args
): Promise<Return> {
  try {
    return await operation(...parameters);
  } catch (e: unknown) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

/**
 * Wraps a command function so that a connection with the fileserver is established
 * before it is invoked and then closed afterwards. It further decorates the function
 * with some error handling using {@link errorHandlingWrapper}.
 *
 * Note that this decorator is not necessary for commands that do not require a connection
 * e.g. for setting configuration options.
 *
 * @param operation The function to wrap.
 * @param parameters The parameters to pass to operation.
 * @returns The result of the operation.
 */
async function connectionWrapper<Args extends unknown[], Return>(
  operation: (...operationParameters: Args) => Promise<Return>,
  configOptions: ConfigOptions,
  ...parameters: Args
): Promise<Return> {
  driver.setDebugEnabled(configOptions.debugEnabled);
  await initConnection(
    configOptions.deviceName,
    configOptions.localStation,
    configOptions.debugEnabled,
  );

  try {
    return await errorHandlingWrapper(operation, ...parameters);
  } finally {
    try {
      await driver.setMode('STOP');
    } catch (e: unknown) {
      console.error(
        'Failed to STOP driver: ' +
          (e instanceof Error ? e.message : 'unknown error'),
      );
    }
    await driver.close();
  }
}

main();
