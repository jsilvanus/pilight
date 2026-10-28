import { EventEmitter } from 'node:events';
import {
  type RGB,
  type TallyLightConfig,
  type TallyLightState,
  type TallyMode,
} from './types.js';
import { TallyDevice } from './devices/tally-device.js';
import { TallyMaUdpClient, TALLYMA_UDP_PORT } from './protocols/tallyma-udp.js';
import { TallyMaHttpClient } from './protocols/tallyma-http.js';
import { TallyMaCloudClient } from './protocols/tallyma-cloud.js';
import { MdnsDiscoveryService, type DiscoveredLight, normalizeMdnsHostname } from './discovery/mdns-discovery.js';

export interface ManagerOptions {
  cloudBrokerUrl?: string | undefined;
  disableDiscovery?: boolean | undefined;
}

export class TallyManager extends EventEmitter {
  private devices = new Map<string, TallyDevice>();
  private sharedUdpClient: TallyMaUdpClient;
  private sharedCloudClient?: TallyMaCloudClient | undefined;
  private discoveryService: MdnsDiscoveryService;

  constructor(options?: ManagerOptions) {
    super();
    this.sharedUdpClient = new TallyMaUdpClient();
    this.discoveryService = new MdnsDiscoveryService();

    if (options?.cloudBrokerUrl) {
      this.sharedCloudClient = new TallyMaCloudClient({ brokerUrl: options.cloudBrokerUrl });
    }

    if (!options?.disableDiscovery) {
      this.discoveryService.start();

      // Listen for DHCP IP discoveries or changes
      this.discoveryService.on('ipChanged', ({ light }: { light: DiscoveredLight }) => {
        this.updateDeviceDiscoveredIp(light);
      });
      this.discoveryService.on('discovered', (light: DiscoveredLight) => {
        this.updateDeviceDiscoveredIp(light);
        this.emit('deviceDiscovered', light);
      });
    }
  }

  private updateDeviceDiscoveredIp(light: DiscoveredLight): void {
    const targetHost = light.hostname.toLowerCase();
    for (const dev of this.devices.values()) {
      if (dev.host.toLowerCase() === targetHost) {
        dev.updateDynamicIp(light.ip);
      }
    }
  }

  getDiscovery(): MdnsDiscoveryService {
    return this.discoveryService;
  }

  getDiscoveredDevices(): DiscoveredLight[] {
    return this.discoveryService.getAllDiscovered();
  }

  /**
   * Register a new tally light. Automatically binds discovered DHCP IP if not statically set.
   */
  registerDevice(config: TallyLightConfig): TallyDevice {
    if (this.devices.has(config.id)) {
      this.removeDevice(config.id);
    }

    // If fallbackIp wasn't provided, check dynamic mDNS discovery cache
    const targetHost = config.host ?? config.ip ?? config.id;
    const discoveredIp = this.discoveryService.getResolvedIp(targetHost);
    const enrichedConfig: TallyLightConfig = {
      ...config,
      fallbackIp: config.fallbackIp ?? discoveredIp,
    };

    const device = new TallyDevice(enrichedConfig, {
      udp: this.sharedUdpClient,
      cloud: this.sharedCloudClient,
    });

    device.on('change', (state: TallyLightState) => {
      this.emit('deviceChange', state);
    });

    this.devices.set(config.id, device);
    this.emit('deviceAdded', device.getState());
    return device;
  }

  /**
   * Remove a tally light by id.
   */
  removeDevice(id: string): boolean {
    const device = this.devices.get(id);
    if (!device) return false;

    device.destroy();
    this.devices.delete(id);
    this.emit('deviceRemoved', id);
    return true;
  }

  /**
   * Get a registered device by id.
   */
  getDevice(id: string): TallyDevice | undefined {
    return this.devices.get(id);
  }

  /**
   * List all registered devices.
   */
  getAllDevices(): TallyDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Get current states of all devices.
   */
  getAllStates(): TallyLightState[] {
    return this.getAllDevices().map((d) => d.getState());
  }

  /**
   * Batch update multiple devices at once.
   */
  async setBatchStates(
    updates: Array<{ id: string; mode: TallyMode; rgb?: RGB | undefined }>
  ): Promise<void> {
    const promises = updates.map(async (u) => {
      const device = this.devices.get(u.id);
      if (!device) return;

      if (u.mode === 'pgm') {
        await device.setProgram();
      } else if (u.mode === 'prv') {
        await device.setPreview();
      } else if (u.mode === 'off') {
        await device.setOff();
      } else if (u.mode === 'color' && u.rgb) {
        await device.setColor(u.rgb);
      }
    });

    await Promise.all(promises);
  }

  /**
   * Play moving rainbow animation over UDP on a device.
   */
  async playRainbow(id: string, options?: { durationSec?: number | undefined; fps?: number | undefined }): Promise<void> {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Device "${id}" not found`);
    return device.playRainbow(options);
  }

  /**
   * Send a directional or operator camera cue via LED animation over UDP.
   */
  async cueCamera(id: string, direction: import('./types.js').CameraCueDirection, durationMs?: number): Promise<void> {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Device "${id}" not found`);
    return device.cueCamera(direction, durationMs);
  }

  /**
   * Configure free segments on a device.
   */
  setSegments(id: string, segments: import('./types.js').LightSegment[]): void {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Device "${id}" not found`);
    device.setSegments(segments);
  }

  /**
   * Update a specific segment's color on a device over UDP.
   */
  async updateSegment(id: string, segmentId: string, color: RGB): Promise<void> {
    const device = this.devices.get(id);
    if (!device) throw new Error(`Device "${id}" not found`);
    return device.updateSegment(segmentId, color);
  }

  /**
   * Stop active animation on a device.
   */
  stopAnimation(id: string): void {
    const device = this.devices.get(id);
    if (device) {
      device.stopAnimation();
    }
  }

  /**
   * Send a one-off direct UDP packet to an ad-hoc IP without registering a device.
   */
  async sendDirectUdp(
    ip: string,
    rgb: RGB | RGB[],
    port: number = TALLYMA_UDP_PORT
  ): Promise<number> {
    return this.sharedUdpClient.send(ip, rgb, port);
  }

  /**
   * Send a direct HTTP command to an ad-hoc IP.
   */
  async sendDirectHttp(
    ip: string,
    command: string,
    port: number = 80
  ): Promise<{ status: number; text: string }> {
    const client = new TallyMaHttpClient(ip, port);
    switch (command.toUpperCase()) {
      case 'PGM':
        return client.setProgram();
      case 'PRV':
        return client.setPreview();
      case 'NONE':
      case 'OFF':
        return client.setOff();
      case 'CALL':
        return client.call();
      case 'HOLD1':
        return client.setHoldData(true);
      case 'HOLD0':
        return client.setHoldData(false);
      default:
        throw new Error(`Unsupported direct HTTP command: ${command}`);
    }
  }

  /**
   * Tear down the manager and all devices.
   */
  async destroy(): Promise<void> {
    for (const device of this.devices.values()) {
      device.destroy();
    }
    this.devices.clear();

    await this.sharedUdpClient.close();
    if (this.sharedCloudClient) {
      await this.sharedCloudClient.disconnect();
    }
    this.discoveryService.stop();
  }
}
