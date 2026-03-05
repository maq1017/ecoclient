import { executeCliCommand } from '../common';
import { access, bye, cdir, deleteFile } from './simpleCli';

jest.mock('../common');

const executeCliCommandMock = jest.mocked(executeCliCommand);
const handles = { userRoot: 0, current: 1, library: 2 };
describe('simpleCli protocol handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should call executeCliCommand with the correct arguments for 'BYE' command", async () => {
    await bye({ network: 0, station: 254 }, handles);
    expect(executeCliCommandMock).toHaveBeenCalledWith({ network: 0, station: 254 }, 'BYE', handles);
  });

  it("should call executeCliCommand with the correct arguments for 'CDIR' command", async () => {
    await cdir({ network: 0, station: 254 }, 'test', handles);
    expect(executeCliCommandMock).toHaveBeenCalledWith(
      { network: 0, station: 254 },
      'CDIR test',
      handles,
    );
  });

  it("should call executeCliCommand with the correct arguments for 'DELETE' command", async () => {
    await deleteFile({ network: 0, station: 254 }, 'test', handles);
    expect(executeCliCommandMock).toHaveBeenCalledWith(
      { network: 0, station: 254 },
      'DELETE test',
      handles,
    );
  });

  it("should call executeCliCommand with the correct arguments for 'ACCESS' command", async () => {
    await access({ network: 0, station: 254 }, 'test', 'WR/R', handles);
    expect(executeCliCommandMock).toHaveBeenCalledWith(
      { network: 0, station: 254 },
      'ACCESS test WR/R',
      handles,
    );
  });
});
