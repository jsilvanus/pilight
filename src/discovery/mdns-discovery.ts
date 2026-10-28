import dns from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import makeMdns from 'multicast-dns';
import { DEFAULT_TALLY_DEVICES } from '../types.js';

export interface DiscoveredLight {
  id: string;               // e.g. "tally01"
  hostname: string;         // e.g. "tally01.local"
  ip: string;               // dynamically discovered DHCP IP address
  unitIndex?: number | undefined; // 1..8
  lastSeen: string;         // ISO timestamp
  discoveryMethod: 'mdns-multicast' | 'dns-lookup';
}

export interface MdnsDiscoveryOptions {
  intervalMs?: number | undefined;   // Periodic query interval (default: 30000ms / 30s)
  scanUnits?: number | undefined;    // Number of units to query for: 1..N (default: 8)
  enableOsLookup?: boolean | undefined; // Run parallel OS dns.lookup (default: true)
}

/**
 * Normalizes a target (e.g. "tally01", "1", "tally01.local") to standard "tally01.local"
 */
export function normalizeMdnsHostname(target: string): string {
  const norm = target.trim().toLowerCase();
  if (norm.endsWith('.local')) return norm;

  const m = norm.match(/^(?:cam|tally|light)?0*(\d+)$/i);
  if (m && m[1]) {
    const pad = m[1].padStart(2, '0');
    return `tally${pad}.local`;
  }
  return `${norm}.local`;
}

/**
 * mDNS Discovery Service that discovers and tracks dynamic DHCP IP addresses
 * of Tally-Ma wireless tally lights on the local network.
 */
export class MdnsDiscoveryService extends EventEmitter {
  private mdnsInstance: any = null;
  private cache = new Map<string, DiscoveredLight>();
  private queryTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private maxUnits: number;
  private queryIntervalMs: number;
  private enableOsLookup: boolean;

  constructor(options?: MdnsDiscoveryOptions) {
    super();
    this.maxUnits = options?.scanUnits ?? 8;
    this.queryIntervalMs = options?.intervalMs ?? 30000;
    this.enableOsLookup = options?.enableOsLookup ?? true;

    // Seed cache with any known initial fallbacks as baselines
    for (const [key, dev] of Object.entries(DEFAULT_TALLY_DEVICES)) {
      if (dev.fallbackIp) {
        const hostname = dev.host;
        const norm = hostname.toLowerCase();
        const m = key.match(/0*(\d+)$/);
        const unitIndex = m && m[1] ? parseInt(m[1], 10) : undefined;
        this.cache.set(norm, {
          id: key,
          hostname,
          ip: dev.fallbackIp,
          unitIndex,
          lastSeen: new Date().toISOString(),
          discoveryMethod: 'dns-lookup',
        });
      }
    }
  }

  /**
   * Start continuous background mDNS discovery.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      this.mdnsInstance = makeMdns();

      this.mdnsInstance.on('response', (packet: any) => {
        this.handleMdnsPacket(packet);
      });

      this.mdnsInstance.on('error', (err: any) => {
        console.warn('[MdnsDiscovery] mDNS socket error:', err.message);
      });
    } catch (err: any) {
      console.warn('[MdnsDiscovery] Failed to bind multicast-dns socket:', err.message);
    }

    // Trigger initial scan immediately
    this.queryNow().catch(() => {});

    // Periodic sweep
    if (this.queryIntervalMs > 0) {
      this.queryTimer = setInterval(() => {
        if (!this.isRunning) return;
        this.queryNow().catch(() => {});
      }, this.queryIntervalMs);
      this.queryTimer.unref();
    }
  }

  /**
   * Stop background discovery and close multicast socket.
   */
  stop(): void {
    this.isRunning = false;
    if (this.queryTimer) {
      clearInterval(this.queryTimer);
      this.queryTimer = null;
    }
    if (this.mdnsInstance) {
      try {
        this.mdnsInstance.destroy();
      } catch {
        // Suppress destroy errors
      }
      this.mdnsInstance = null;
    }
  }

  /**
   * Send mDNS queries right now for all tally units and services.
   */
  async queryNow(): Promise<void> {
    const questions: Array<{ name: string; type: 'A' | 'PTR' }> = [];

    // 1. Query for tally01.local through tally08.local (A records)
    for (let i = 1; i <= this.maxUnits; i++) {
      const pad = String(i).padStart(2, '0');
      questions.push({ name: `tally${pad}.local`, type: 'A' });
    }

    // 2. Query for standard HTTP service
    questions.push({ name: '_http._tcp.local', type: 'PTR' });

    if (this.mdnsInstance) {
      try {
        this.mdnsInstance.query({ questions });
      } catch (err: any) {
        console.warn('[MdnsDiscovery] Query error:', err.message);
      }
    }

    // 3. Parallel OS DNS lookup for each unit
    if (this.enableOsLookup) {
      for (let i = 1; i <= this.maxUnits; i++) {
        const pad = String(i).padStart(2, '0');
        const host = `tally${pad}.local`;
        dns.lookup(host, { family: 4 })
          .then(({ address }) => {
            if (address) {
              this.recordDiscovered({
                id: `tally${pad}`,
                hostname: host,
                ip: address,
                unitIndex: i,
                lastSeen: new Date().toISOString(),
                discoveryMethod: 'dns-lookup',
              });
            }
          })
          .catch(() => {
            // Expected if unit is offline
          });
      }
    }
  }

  /**
   * Inspect incoming mDNS packet and record discovered tally IPs.
   */
  private handleMdnsPacket(packet: any): void {
    if (!packet) return;

    const records = [...(packet.answers ?? []), ...(packet.additionals ?? [])];

    for (const record of records) {
      if (record.type === 'A' && typeof record.name === 'string' && typeof record.data === 'string') {
        const name = record.name.toLowerCase().replace(/\.$/, '');
        const ip = record.data;

        // Check if name is tallyXX.local or contains tally
        if (name.includes('tally')) {
          const m = name.match(/tally0*(\d+)/i);
          const unitIndex = m && m[1] ? parseInt(m[1], 10) : undefined;
          const id = unitIndex ? `tally${String(unitIndex).padStart(2, '0')}` : name.split('.')[0]!;

          this.recordDiscovered({
            id,
            hostname: name.endsWith('.local') ? name : `${name}.local`,
            ip,
            unitIndex,
            lastSeen: new Date().toISOString(),
            discoveryMethod: 'mdns-multicast',
          });
        }
      }
    }
  }

  /**
   * Register or update a discovered light in the cache.
   */
  private recordDiscovered(light: DiscoveredLight): void {
    const key = light.hostname.toLowerCase();
    const existing = this.cache.get(key);

    const isNew = !existing;
    const ipChanged = existing && existing.ip !== light.ip;

    this.cache.set(key, light);

    if (isNew) {
      console.log(
        `[MdnsDiscovery] Discovered Tally light: ${light.hostname} -> DHCP IP: ${light.ip} (via ${light.discoveryMethod})`
      );
      this.emit('discovered', light);
    } else if (ipChanged) {
      console.log(
        `[MdnsDiscovery] DHCP IP changed for ${light.hostname}: ${existing.ip} -> ${light.ip}`
      );
      this.emit('ipChanged', { light, previousIp: existing.ip });
    }
  }

  /**
   * Get the dynamically discovered IP address for a target hostname or id.
   */
  getResolvedIp(target: string): string | undefined {
    const host = normalizeMdnsHostname(target);
    const item = this.cache.get(host);
    return item?.ip;
  }

  /**
   * Get discovered details for a target hostname or id.
   */
  getDiscovered(target: string): DiscoveredLight | undefined {
    const host = normalizeMdnsHostname(target);
    return this.cache.get(host);
  }

  /**
   * Return all currently discovered lights.
   */
  getAllDiscovered(): DiscoveredLight[] {
    return Array.from(this.cache.values());
  }

  /**
   * Perform an immediate active scan and return all discovered units after waitMs.
   */
  async scan(waitMs: number = 2000): Promise<DiscoveredLight[]> {
    if (!this.isRunning) {
      this.start();
    }
    await this.queryNow();
    await new Promise((r) => setTimeout(r, waitMs));
    return this.getAllDiscovered();
  }
}
