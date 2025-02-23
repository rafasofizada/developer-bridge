import * as fs from 'fs';
import * as child_process from 'child_process';
import { EventEmitter } from 'events';

import * as relayInfoUtils from './relayInfo';
import * as launchUtils from './launch';
import * as utils from './util';
import { instance } from '.';
import { RELAY_PKG_NAME } from './const';

jest.mock('fs');
jest.mock('./relayInfo');
jest.mock('./launch');

// Mock createWriteStream to return an EventEmitter, that
// emits `${event}` as soon as an event listener for `${event}` is set.
export function mockStreamWithEventEmit(
  event: string,
  payload?: any,
): EventEmitter {
  const stream = new EventEmitter();
  const addListener = stream.on.bind(stream);

  jest.spyOn(stream, 'on').mockImplementation((listenerEvent, callback) => {
    addListener(listenerEvent, callback);

    if (listenerEvent === event) {
      stream.emit(event, payload);
    }

    return stream;
  });

  return stream;
}

// Mock createWriteStream to return an EventEmitter, that
// emits 'error' event as soon as an event listener for 'error' is set.

describe('instance', () => {
  it('returns relay info of existing relay instance', async () => {
    const relayInfo = { port: 1, pid: 1 };
    (relayInfoUtils.readRelayInfo as jest.Mock).mockResolvedValueOnce(
      relayInfo,
    );

    await expect(instance()).resolves.toEqual(relayInfo);
  });

  it('throws if local relay pkg not installed', async () => {
    jest
      .spyOn(relayInfoUtils, 'isRelayPkgInstalled')
      .mockResolvedValueOnce(false);

    await expect(instance()).rejects.toThrow(
      `To launch local relay (-l, --local flag), you should have ${RELAY_PKG_NAME} installed. No ${RELAY_PKG_NAME} dependency found in package.json`,
    );
  });

  describe('launches relay instance if no existing relay instance', () => {
    beforeEach(() => {
      jest
        .spyOn(relayInfoUtils, 'isRelayPkgInstalled')
        .mockResolvedValueOnce(true);
    });

    it('polls and returns launched relay instance info', async () => {
      const relayInfo = { port: 1, pid: 1 };

      jest
        .spyOn(utils, 'createLogStream')
        .mockResolvedValueOnce(
          mockStreamWithEventEmit('open') as fs.WriteStream,
        );

      (launchUtils.launch as jest.Mock).mockImplementationOnce(() => {
        const stream = new EventEmitter();
        return stream as child_process.ChildProcess;
      });

      (relayInfoUtils.readRelayInfo as jest.Mock).mockResolvedValueOnce(false);
      (relayInfoUtils.pollRelayInfo as jest.Mock).mockResolvedValueOnce(
        relayInfo,
      );

      await expect(instance()).resolves.toEqual(relayInfo);
      // launch() is an empty mock
      expect(launchUtils.launch).toHaveBeenCalled();
    });

    it('throws if no launched relay instance info obtained', async () => {
      jest
        .spyOn(utils, 'createLogStream')
        .mockResolvedValueOnce(
          mockStreamWithEventEmit('open') as fs.WriteStream,
        );

      (launchUtils.launch as jest.Mock).mockReturnValueOnce(
        new EventEmitter() as child_process.ChildProcess,
      );

      (relayInfoUtils.readRelayInfo as jest.Mock).mockResolvedValueOnce(false);
      (relayInfoUtils.pollRelayInfo as jest.Mock).mockResolvedValueOnce(false);

      await expect(instance()).rejects.toThrow(
        "Couldn't obtain Local Relay port and pid from PID file",
      );

      // launch() is an empty mock
      expect(launchUtils.launch).toHaveBeenCalled();
    });

    it('throws if createWriteStream fails', async () => {
      jest
        .spyOn(utils, 'createLogStream')
        .mockResolvedValueOnce(
          mockStreamWithEventEmit(
            'error',
            new Error('createWriteStream failed'),
          ) as fs.WriteStream,
        );

      /*
      Inside instance() call:
      1. createWriteStream() => stream
      - 1. mock stream.on('error')
      2. stream.on('error', callback)
      - 1. add callback as listener on 'error'
      - 2. emit 'error' (as per mock)
      3. console.error, throw error
      */
      await expect(instance()).rejects.toThrow();
    });
  });
});
