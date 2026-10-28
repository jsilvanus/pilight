import dgram from 'node:dgram';
import { type RGB } from '../types.js';

export const TALLYMA_UDP_PORT = 21324;
export const TALLYMA_UDP_MAGIC = Buffer.from([0x02, 0x05]);
export const TALLYMA_ZONE_COUNT = 9;
export const TALLYMA_PACKET_LENGTH = 2 + TALLYMA_ZONE_COUNT * 3; // 29 bytes

/**
 * Builds a 29-byte UDP packet for Tally-Ma lights.
 * Payload structure:
 *  - Offset 0..1: [0x02, 0x05]
 *  - Offset 2..28: 9 RGB triplets (27 bytes)
 *
 * @param input Either a single uniform RGB triplet or an array of 9 RGB triplets.
 */
export function buildUdpPacket(input: RGB | RGB[]): Buffer {
  const buf = Buffer.alloc(TALLYMA_PACKET_LENGTH);
  TALLYMA_UDP_MAGIC.copy(buf, 0);

  let offset = 2;

  if (Array.isArray(input[0])) {
    // Array of RGB triplets
    const zones = input as RGB[];
    for (let i = 0; i < TALLYMA_ZONE_COUNT; i++) {
      const triplet = zones[i] ?? [0, 0, 0];
      buf[offset++] = Math.max(0, Math.min(255, Math.round(triplet[0])));
      buf[offset++] = Math.max(0, Math.min(255, Math.round(triplet[1])));
      buf[offset++] = Math.max(0, Math.min(255, Math.round(triplet[2])));
    }
  } else {
    // Single RGB triplet repeated 9 times
    const [r, g, b] = input as RGB;
    const clampedR = Math.max(0, Math.min(255, Math.round(r)));
    const clampedG = Math.max(0, Math.min(255, Math.round(g)));
    const clampedB = Math.max(0, Math.min(255, Math.round(b)));

    for (let i = 0; i < TALLYMA_ZONE_COUNT; i++) {
      buf[offset++] = clampedR;
      buf[offset++] = clampedG;
      buf[offset++] = clampedB;
    }
  }

  return buf;
}

/**
 * UDP client managing socket lifecycle and sending packets to Tally-Ma devices.
 * Supports mDNS hostnames (e.g. 'tally01.local') with automatic fallback IP.
 */
export class TallyMaUdpClient {
  private socket: dgram.Socket | null = null;

  constructor() {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      // Avoid uncaught errors on background socket
      console.error('[TallyMaUdpClient] Socket error:', err.message);
    });
  }

  private sendRaw(host: string, packet: Buffer, port: number): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      if (!this.socket) {
        this.socket = dgram.createSocket('udp4');
      }
      this.socket.send(packet, 0, packet.length, port, host, (err, bytes) => {
        if (err) reject(err);
        else resolve(bytes);
      });
    });
  }

  /**
   * Send a 29-byte color packet to a Tally-Ma light.
   * If primary host (e.g. mDNS) fails and fallbackIp is supplied, automatically retries on fallbackIp.
   */
  async send(
    host: string,
    input: RGB | RGB[],
    port: number = TALLYMA_UDP_PORT,
    fallbackIp?: string
  ): Promise<number> {
    const packet = buildUdpPacket(input);

    try {
      return await this.sendRaw(host, packet, port);
    } catch (err: any) {
      if (fallbackIp && host !== fallbackIp) {
        console.warn(`[TallyMaUdpClient] UDP send to "${host}" failed (${err.message}). Retrying on fallback IP "${fallbackIp}"...`);
        return await this.sendRaw(fallbackIp, packet, port);
      }
      throw err;
    }
  }

  /**
   * Close the UDP socket.
   */
  async close(): Promise<void> {
    if (this.socket) {
      return new Promise<void>((resolve) => {
        this.socket?.close(() => {
          this.socket = null;
          resolve();
        });
      });
    }
  }
}
