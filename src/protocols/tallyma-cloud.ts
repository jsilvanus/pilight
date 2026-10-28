import mqtt, { type MqttClient } from 'mqtt';
import { CLOUD_STATES, type CloudState, type TallyMode } from '../types.js';

export interface CloudClientOptions {
  brokerUrl?: string; // e.g. "mqtt://jnsl.asuscomm.com:18069" or "mqtt://localhost:1883"
  host?: string;
  port?: number;
  clientId?: string;
  username?: string;
  password?: string;
}

/**
 * Converts a high-level TallyMode into Tally-Ma cloud numeric code:
 * 0: dark/off
 * 1: program/red
 * 2: preview/green
 * 3: recording
 * 4: streaming
 */
export function modeToCloudState(mode: TallyMode): CloudState {
  switch (mode) {
    case 'pgm':
      return CLOUD_STATES.PROGRAM;
    case 'prv':
      return CLOUD_STATES.PREVIEW;
    case 'off':
    default:
      return CLOUD_STATES.OFF;
  }
}

/**
 * MQTT / Cloud client for Tally-Ma wireless tally devices.
 */
export class TallyMaCloudClient {
  private client: MqttClient | null = null;
  private brokerUrl: string;
  private isConnected = false;

  constructor(options?: CloudClientOptions) {
    if (options?.brokerUrl) {
      this.brokerUrl = options.brokerUrl;
    } else {
      const host = options?.host ?? 'jnsl.asuscomm.com';
      const port = options?.port ?? 18069;
      this.brokerUrl = `mqtt://${host}:${port}`;
    }
  }

  /**
   * Connect to MQTT broker.
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.client) return;

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: 5000,
        connectTimeout: 5000,
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        resolve();
      });

      this.client.on('error', (err) => {
        console.error('[TallyMaCloudClient] MQTT error:', err.message);
        if (!this.isConnected) {
          reject(err);
        }
      });

      this.client.on('close', () => {
        this.isConnected = false;
      });
    });
  }

  /**
   * Publish tally state (0..4) to the device's cloud topic.
   */
  async publishState(topic: string, state: CloudState | number): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.client?.publish(topic, String(state), { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Publish arbitrary payload to a topic.
   */
  async publish(topic: string, payload: string | Buffer): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.client?.publish(topic, payload, { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Subscribe to topic.
   */
  async subscribe(topic: string, callback: (topic: string, message: Buffer) => void): Promise<void> {
    if (!this.client || !this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      this.client?.subscribe(topic, (err) => {
        if (err) return reject(err);

        this.client?.on('message', (t, msg) => {
          if (t === topic) {
            callback(t, msg);
          }
        });
        resolve();
      });
    });
  }

  /**
   * Disconnect from broker.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      return new Promise((resolve) => {
        this.client?.end(false, () => {
          this.isConnected = false;
          this.client = null;
          resolve();
        });
      });
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }
}
