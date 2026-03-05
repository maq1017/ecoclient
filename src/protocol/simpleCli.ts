import { DirectoryHandles, EconetAddress, executeCliCommand } from '../common';

export const bye = async (serverStation: EconetAddress, handles: DirectoryHandles) =>
  executeCliCommand(serverStation, 'BYE', handles);

export const cdir = async (
  serverStation: EconetAddress,
  dirName: string,
  handles: DirectoryHandles,
) => executeCliCommand(serverStation, `CDIR ${dirName}`, handles);

export const deleteFile = async (
  serverStation: EconetAddress,
  filePath: string,
  handles: DirectoryHandles,
) => executeCliCommand(serverStation, `DELETE ${filePath}`, handles);

export const access = async (
  serverStation: EconetAddress,
  filePath: string,
  accessString: string,
  handles: DirectoryHandles,
) =>
  executeCliCommand(
    serverStation,
    `ACCESS ${filePath} ${accessString}`,
    handles,
  );

export const newUser = async (
  serverStation: EconetAddress,
  username: string,
  handles: DirectoryHandles,
) => executeCliCommand(serverStation, `NEWUSER ${username}`, handles);

export const removeUser = async (
  serverStation: EconetAddress,
  username: string,
  handles: DirectoryHandles,
) => executeCliCommand(serverStation, `REMUSER ${username}`, handles);

export const changePassword = (
  serverStation: EconetAddress,
  oldPassword: string,
  newPassword: string,
  handles: DirectoryHandles,
) =>
  executeCliCommand(
    serverStation,
    `PASS ${oldPassword ? oldPassword : '""'} ${
      newPassword ? newPassword : '""'
    }`,
    handles,
  );

export const setPrivileged = async (
  serverStation: EconetAddress,
  username: string,
  level: string,
  handles: DirectoryHandles,
) =>
  executeCliCommand(
    serverStation,
    `PRIV ${username} ${level ? level : 'N'}`,
    handles,
  );
