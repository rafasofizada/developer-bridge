import { startCase } from 'lodash';
import vorpal from '@moleculer/vorpal';

import HostConnections from '../models/HostConnections';
import DeveloperRelay, { Host } from '../models/DeveloperRelay';

export type DeviceType = 'device' | 'phone';

export const connectAction = async (
  cli: vorpal,
  deviceType: DeviceType,
  hostConnections: HostConnections,
  local = false,
) => {
  let hosts: {
    appHost: Host[];
    companionHost: Host[];
  };

  const developerRelay = await DeveloperRelay.create(local);

  try {
    hosts = await developerRelay.hosts();
  } catch (error) {
    cli.log(
      // tslint:disable-next-line:max-line-length
      `An error was encountered when loading the list of available ${deviceType} hosts: ${
        (error as Error).message
      }`,
    );
    return false;
  }

  const hostTypes: { [key: string]: keyof typeof hosts } = {
    device: 'appHost',
    phone: 'companionHost',
  };

  const hostType = hostTypes[deviceType];
  const matchedHosts = hosts[hostType].filter(
    (host) => host.state === 'available',
  );

  if (matchedHosts.length === 0) {
    cli.activeCommand.log(`No ${deviceType}s are connected and available`);
    return false;
  }

  let host: { id: string; displayName: string };
  if (matchedHosts.length === 1) {
    host = matchedHosts[0];
    cli.activeCommand.log(
      `Auto-connecting only known ${deviceType}: ${host.displayName}`,
    );
  } else {
    host = (
      await cli.activeCommand.prompt<{
        hostID: { id: string; displayName: string };
      }>({
        type: 'list',
        name: 'hostID',
        message: `Which ${deviceType} do you wish to sideload to?`,
        choices: matchedHosts.map((host) => ({
          name: host.displayName,
          value: { id: host.id, displayName: host.displayName },
        })),
      })
    ).hostID;
  }

  const ws = await developerRelay.connect(host.id);
  const connection = await hostConnections.connect(hostType, ws);
  connection.ws.once('finish', () =>
    cli.log(`${startCase(deviceType)} '${host.displayName}' disconnected`),
  );

  return true;
};

export default function ({
  hostConnections,
}: {
  hostConnections: HostConnections;
}) {
  return (cli: vorpal) => {
    const deviceTypes: DeviceType[] = ['device', 'phone'];
    for (const deviceType of deviceTypes) {
      cli
        .command(`connect ${deviceType}`, `Connect a ${deviceType}`)
        .option('-l, --local', 'Connect using Local Relay')
        .action(
          (
            args: vorpal.Args & {
              options: vorpal.Args['options'] & { local?: boolean };
            },
          ) =>
            connectAction(cli, deviceType, hostConnections, args.options.local),
        );
    }
  };
}
