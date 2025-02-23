import { join } from 'path';
import { cwd } from 'process';

import * as util from './util';
import {
  isRelayPkgInstalled,
  pollRelayInfo,
  readRelayInfo,
  relayEntryPointPath,
  RelayInfo,
} from './relayInfo';
import { RELAY_PKG_NAME } from './const';

describe('readRelayInfo', () => {
  it.each([
    {
      readJsonFileValue: { port: 5, pid: 7 },
      readRelayInfoValue: { port: 5, pid: 7 },
      name: 'returns relay info (port, pid) if both are valid numbers',
    },
    {
      readJsonFileValue: { port: 5, pid: '7' },
      readRelayInfoValue: false,
      name: 'returns false if pid is not a number',
    },
    {
      readJsonFileValue: { port: '5', pid: 7 },
      readRelayInfoValue: false,
      name: 'returns false if port is not a number',
    },
    {
      readJsonFileValue: 'obviously not JSON containing Relay Info',
      readRelayInfoValue: false,
      name: 'returns false if no relay info has been obtained',
    },
    {
      readJsonFileValue: { not: 'keys we expect' },
      readRelayInfoValue: false,
      name: 'returns false if no relay info has been obtained',
    },
  ])('$name', async ({ readJsonFileValue, readRelayInfoValue }) => {
    jest
      .spyOn(util, 'readJsonFile')
      .mockResolvedValueOnce(readJsonFileValue as any);

    await expect(readRelayInfo()).resolves.toEqual(readRelayInfoValue);
  });

  describe('handles errors', () => {
    it("doesn't log error if file doesn't exist", async () => {
      jest
        .spyOn(util, 'readJsonFile')
        .mockRejectedValueOnce({ code: 'ENOENT' });

      const consoleErrorSpy = jest.spyOn(console, 'error');

      await expect(readRelayInfo()).resolves.toBe(false);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("logs error on any error except ENOENT: file doesn't exist ...", async () => {
      jest
        .spyOn(util, 'readJsonFile')
        .mockRejectedValueOnce({ code: 'random' });
      jest.spyOn(console, 'error').mockImplementationOnce(() => {});

      const consoleErrorSpy = jest.spyOn(console, 'error');

      await expect(readRelayInfo()).resolves.toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });
});

// https://stackoverflow.com/a/52196951/6539857
// https://github.com/facebook/jest/issues/2157#issuecomment-279171856
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('pollRelayInfo', () => {
  let readJsonFileSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    readJsonFileSpy.mockRestore();
  });

  /**
   * Poll for the relay info in interval of 100ms until either:
   * - Valid relay info obtained
   * - Timeout
   *
   * Here, we need 3 function calls to obtain valid relay info, and the interval is 100ms –
   * more than enough time for us to poll relay info and not time out.
   */
  it('polls until relay info is obtained', async () => {
    const relayInfo: RelayInfo = { port: 1, pid: 1 };
    readJsonFileSpy = jest
      .spyOn(util, 'readJsonFile')
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(relayInfo);

    const poll = pollRelayInfo(500, 100);
    await flushPromises();

    // readJsonFile() is called once as soon as pollRelayJson() is called
    // hence we start counter from 1
    for (let i = 1; i <= 2; i += 1) {
      jest.advanceTimersByTime(100);
      await flushPromises();
      expect(readJsonFileSpy).toHaveBeenCalledTimes(i + 1);
    }

    await expect(poll).resolves.toEqual(relayInfo);
  });

  it('polls in regular intervals', async () => {
    const interval = 100;
    // Checking if the behaviour is correct a couple of times is sufficient
    const reps = 2;

    readJsonFileSpy = jest.spyOn(util, 'readJsonFile').mockResolvedValue({});

    // Some padding for timeout not to intersect with the end of the last interval
    const timeout = interval * reps * 1.2;
    // There's no `await expect(pollRelayInfoPromise).resolves/rejects` in this use case (unlike others), so, if a timeout occurs
    // (which can happen only in the warning written below), it will raise an UnhandledPromiseRejectionException
    pollRelayInfo(timeout, interval).catch((error) => {
      console.warn(
        "If you see this message, it means the timeout created in pollRelayInfo has leaked out of this test case.\
      You probably forgot 'jest.clearAllTimeouts()' after this test or in afterEach().",
      );
      console.error(error);
    });
    await flushPromises();

    //    t  | callN
    // ––––––|–––––––
    //    0  |   -
    //   99  |   1
    //  100  |   2
    //  199  |   2
    //  200  |   3
    //      ...
    for (let i = 1; i <= reps; i += 1) {
      jest.advanceTimersByTime(interval - 1);
      await flushPromises();
      expect(readJsonFileSpy).toHaveBeenCalledTimes(i);

      jest.advanceTimersByTime(1);
      await flushPromises();
      expect(readJsonFileSpy).toHaveBeenCalledTimes(i + 1);
    }
  });

  // First poll request's execution time 2000ms exceeds the total specified 1000ms timeout.
  it('rejects on timeout', async () => {
    const timeout = 1000;
    readJsonFileSpy = jest.spyOn(util, 'readJsonFile').mockImplementation(
      () =>
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 2000)),
    );

    const poll = pollRelayInfo(timeout, timeout);
    await flushPromises();

    jest.runAllTimers();
    await expect(poll).rejects.toThrowError(
      `Timed out after waiting for ${timeout} ms`,
    );
  });
});

describe('isRelayPkgInstalled', () => {
  describe('true if relay pkg present in', () => {
    it('dependencies', async () => {
      jest
        .spyOn(util, 'readJsonFile')
        .mockResolvedValueOnce({ dependencies: { [RELAY_PKG_NAME]: '1.0' } });

      await expect(isRelayPkgInstalled()).resolves.toBe(true);
    });

    it('devDependencies', async () => {
      jest.spyOn(util, 'readJsonFile').mockResolvedValueOnce({
        devDependencies: { [RELAY_PKG_NAME]: '1.0' },
      });

      await expect(isRelayPkgInstalled()).resolves.toBe(true);
    });
  });

  describe('false', () => {
    it('if relay pkg not present in dependencies or devDependencies', async () => {
      jest
        .spyOn(util, 'readJsonFile')
        .mockResolvedValueOnce({ dependencies: {}, devDependencies: {} });

      await expect(isRelayPkgInstalled()).resolves.toBe(false);
    });

    it('if package.json not found', async () => {
      jest
        .spyOn(util, 'readJsonFile')
        .mockRejectedValueOnce({ code: 'ENOENT' });

      await expect(isRelayPkgInstalled()).rejects.toThrow(
        'No package.json found for the project at',
      );
    });
  });
});

describe('relayEntryPointPath', () => {
  it(`reads package.json of ${RELAY_PKG_NAME} and gets its main file path`, async () => {
    const main = 'index.ts';

    jest.spyOn(util, 'readJsonFile').mockResolvedValueOnce({ main });

    await expect(relayEntryPointPath()).resolves.toMatch(
      join(cwd(), 'node_modules', RELAY_PKG_NAME, main),
    );
  });

  it(`reads package.json of ${RELAY_PKG_NAME} and gets its main file path`, async () => {
    jest.spyOn(util, 'readJsonFile').mockResolvedValueOnce(undefined as any);

    await expect(relayEntryPointPath()).rejects.toThrowError(
      "Can't read package.json:",
    );
  });

  it(`reads package.json of ${RELAY_PKG_NAME} and gets its main file path`, async () => {
    const main = undefined;
    jest.spyOn(util, 'readJsonFile').mockResolvedValueOnce({ main });

    await expect(relayEntryPointPath()).rejects.toThrowError(
      `The "path" argument must be of type string. Received ${typeof main}`,
    );
  });
});
