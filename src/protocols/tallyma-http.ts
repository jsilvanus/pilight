import { type BrightnessLevel } from '../types.js';

export interface HttpOptions {
  fallbackIp?: string | undefined;
  timeoutMs?: number | undefined;
}

/**
 * HTTP client for interacting with Tally-Ma device onboard HTTP server.
 * Defaults to mDNS hostname (e.g. 'tally01.local') with automatic fallback to IP.
 * Note: Paths and query parameters on Tally-Ma firmware are strictly case-sensitive.
 */
export class TallyMaHttpClient {
  readonly primaryHost: string;
  readonly fallbackIp?: string | undefined;
  private activeHost: string;
  private port: number;
  private timeoutMs: number;

  constructor(host: string, port: number = 80, options?: HttpOptions) {
    this.primaryHost = host;
    this.fallbackIp = options?.fallbackIp;
    this.activeHost = host;
    this.port = port;
    this.timeoutMs = options?.timeoutMs ?? 3000;
  }

  getActiveHost(): string {
    return this.activeHost;
  }

  resetToPrimary(): void {
    this.activeHost = this.primaryHost;
  }

  private async executeFetch(host: string, path: string): Promise<{ status: number; text: string }> {
    const url = `http://${host}:${this.port}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      const text = await response.text();
      return { status: response.status, text };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async request(path: string): Promise<{ status: number; text: string }> {
    try {
      const res = await this.executeFetch(this.activeHost, path);
      return res;
    } catch (err: any) {
      // If we failed on primary host and have a fallback IP, attempt fallback
      if (this.fallbackIp && this.activeHost !== this.fallbackIp) {
        console.warn(
          `[TallyMaHttpClient] Primary host "${this.primaryHost}" failed (${err.message}). Trying fallback IP "${this.fallbackIp}"...`
        );
        const res = await this.executeFetch(this.fallbackIp, path);
        this.activeHost = this.fallbackIp; // Switch active host to working fallback
        return res;
      }
      throw err;
    }
  }

  /**
   * Set Program tally (Red).
   */
  async setProgram(): Promise<{ status: number; text: string }> {
    return this.request('/PGM');
  }

  /**
   * Set Preview tally (Green).
   */
  async setPreview(): Promise<{ status: number; text: string }> {
    return this.request('/PRV');
  }

  /**
   * Turn tally light off (Black).
   */
  async setOff(): Promise<{ status: number; text: string }> {
    return this.request('/NONE');
  }

  /**
   * Set RGB color using hex string (e.g. "FF5500").
   */
  async setColorHex(hex: string): Promise<{ status: number; text: string }> {
    const cleanHex = hex.replace(/^#/, '').toUpperCase();
    return this.request(`/COLOR?HEX=${cleanHex}`);
  }

  /**
   * Set RGB color using R, G, B components (0..255).
   */
  async setColor(r: number, g: number, b: number): Promise<{ status: number; text: string }> {
    const cr = Math.max(0, Math.min(255, Math.round(r)));
    const cg = Math.max(0, Math.min(255, Math.round(g)));
    const cb = Math.max(0, Math.min(255, Math.round(b)));
    return this.request(`/COLOR?R=${cr}&G=${cg}&B=${cb}`);
  }

  /**
   * Flash white three times to call the operator / talent.
   */
  async call(): Promise<{ status: number; text: string }> {
    return this.request('/CALL');
  }

  /**
   * Set LED brightness level ('LOW', 'MEDIUM', 'HIGH').
   */
  async setBrightness(level: BrightnessLevel): Promise<{ status: number; text: string }> {
    return this.request(`/${level}`);
  }

  /**
   * Enable (H=1) or disable (H=0) holding/ignoring server data.
   */
  async setHoldData(hold: boolean): Promise<{ status: number; text: string }> {
    return this.request(`/HOLDDATA?H=${hold ? 1 : 0}`);
  }

  /**
   * Enable (C=1) or disable (C=0) cloud mode.
   */
  async setCloud(enable: boolean): Promise<{ status: number; text: string }> {
    return this.request(`/CLOUD?C=${enable ? 1 : 0}`);
  }

  /**
   * Configure cloud server hostname and port.
   */
  async setCloudServer(server: string, port: number): Promise<{ status: number; text: string }> {
    return this.request(`/SETCLOUDSERVER?SERVER=${encodeURIComponent(server)}&PORT=${port}`);
  }

  /**
   * Configure automatic cloud server.
   */
  async setCloudServerAuto(): Promise<{ status: number; text: string }> {
    return this.request('/SETCLOUDSERVERAUTO');
  }

  /**
   * Reset all settings to factory defaults.
   */
  async resetAllSettings(): Promise<{ status: number; text: string }> {
    return this.request('/resetallsettings');
  }
}
