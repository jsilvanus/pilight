#!/usr/bin/env node
import { TallyMaUdpClient, TALLYMA_UDP_PORT } from './protocols/tallyma-udp.js';
import { TallyMaHttpClient } from './protocols/tallyma-http.js';
import { createServer } from './server.js';
import { type RGB, TALLY_COLORS, type BrightnessLevel, DEFAULT_TALLY_DEVICES } from './types.js';

export function parseTarget(input: string): { host: string; fallbackIp?: string | undefined } {
  const norm = input.trim().toLowerCase();

  // 1. Direct match in defaults
  if (DEFAULT_TALLY_DEVICES[norm]) {
    return { ...DEFAULT_TALLY_DEVICES[norm]! };
  }

  // 2. Pure number (e.g. "1" -> tally01.local)
  if (/^\d+$/.test(norm)) {
    const pad = norm.padStart(2, '0');
    const key = `tally${pad}`;
    const fallback = DEFAULT_TALLY_DEVICES[key]?.fallbackIp;
    return { host: `tally${pad}.local`, fallbackIp: fallback };
  }

  // 3. Raw IP address provided
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(norm)) {
    return { host: norm };
  }

  // 4. Fully qualified or custom hostname (e.g. tally01.local)
  if (norm.includes('.')) {
    // If it's tally01.local or tally02.local, attach fallback if known
    const nameOnly = norm.split('.')[0]!;
    const fallback = DEFAULT_TALLY_DEVICES[nameOnly]?.fallbackIp;
    return { host: norm, fallbackIp: fallback };
  }

  // 5. Pattern match (cam1, tally1, light2)
  const m = norm.match(/^(?:cam|tally|light)?0*(\d+)$/);
  if (m && m[1]) {
    const pad = m[1].padStart(2, '0');
    const key = `tally${pad}`;
    const fallback = DEFAULT_TALLY_DEVICES[key]?.fallbackIp;
    return { host: `tally${pad}.local`, fallbackIp: fallback };
  }

  // 6. Generic mDNS fallback
  return { host: `${norm}.local` };
}

function parseColor(val: string): RGB {
  const lower = val.toLowerCase();
  if (lower === 'pgm' || lower === 'red') return [...TALLY_COLORS.pgm];
  if (lower === 'prv' || lower === 'green') return [...TALLY_COLORS.prv];
  if (lower === 'off' || lower === 'black' || lower === 'none') return [...TALLY_COLORS.off];
  if (lower === 'yellow') return [...TALLY_COLORS.yellow];
  if (lower === 'blue') return [...TALLY_COLORS.blue];
  if (lower === 'white') return [...TALLY_COLORS.white];

  if (val.startsWith('#') || /^[0-9a-fA-F]{6}$/.test(val)) {
    const hex = val.replace(/^#/, '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return [r, g, b];
  }

  if (val.includes(',')) {
    const parts = val.split(',').map((p) => parseInt(p.trim(), 10));
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return [parts[0]!, parts[1]!, parts[2]!];
    }
  }

  throw new Error(`Unrecognized color or mode: "${val}". Use pgm, prv, off, red, green, blue, #RRGGBB or R,G,B.`);
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function printHelp(): void {
  console.log(`
pilight - Tally light controller for Tally-Ma wireless tally lights

Scope:
  - Defaults to mDNS names (e.g. tally01.local, tally02.local) with IP fallback.
  - HTTP is the default interface for all tally state and configuration.
  - UDP is strictly reserved for high-rate moving animations.

Usage:
  pilight set <target> <color|mode> [--udp]
  pilight cue <target> <pan-left|pan-right|zoom-in|zoom-out|operator-call>
  pilight cycle <target> [--speed <ms>]
  pilight call <target>
  pilight hold <target> [1|0]
  pilight brightness <target> <low|medium|high>
  pilight rainbow <target> [--duration <sec>] [--fps <fps>]
  pilight cloud <target> <on|off> [--server <host>] [--port <port>]
  pilight serve [--port <port>] [--cloud <brokerUrl>]
  pilight help

Target formats:
  tally01             Resolves to tally01.local (fallback: 192.168.1.70)
  tally02             Resolves to tally02.local (fallback: 192.168.1.89)
  1 or 2              Shortcut for tally01.local or tally02.local
  tally01.local       Full mDNS hostname
  192.168.1.70        Direct IP address

Examples:
  pilight set tally01 pgm                 # Sends HTTP /PGM to tally01.local
  pilight set 1 pgm                       # Same as above
  pilight cue 1 pan-left                  # Flashes left/operator LEDs to cue camera operator
  pilight cue 1 zoom-in                   # Expanding pulse to cue zoom in
  pilight cycle 1                         # Sequentially cycles each of the 9 LEDs to test order
  pilight set tally02 prv                 # Sends HTTP /PRV to tally02.local
  pilight set tally01 off                 # Sends HTTP /NONE
  pilight set tally01 #FFAA00             # Sends HTTP /COLOR?HEX=FFAA00
  pilight call tally01                    # Sends HTTP /CALL (flash 3x)
  pilight hold tally01 1                  # Sends HTTP /HOLDDATA?H=1
  pilight brightness tally01 high         # Sends HTTP /HIGH
  pilight rainbow tally01 --duration 5    # Streams moving rainbow via UDP (port 21324)
  pilight serve --port 3200               # Starts HTTP REST API daemon
`);
}

export async function runCli(args: string[]): Promise<void> {
  const command = args[0]?.toLowerCase();

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'serve') {
    let port = 3200;
    const portIdx = args.indexOf('--port');
    if (portIdx !== -1 && args[portIdx + 1]) {
      port = parseInt(args[portIdx + 1]!, 10);
    }

    const server = createServer({ port });
    await server.start();
    return;
  }

  const rawTarget = args[1];
  if (!rawTarget) {
    console.error('Error: Target device (name, number, mDNS or IP) is required.');
    process.exit(1);
  }

  const { host, fallbackIp } = parseTarget(rawTarget);

  if (command === 'call') {
    const client = new TallyMaHttpClient(host, 80, { fallbackIp });
    console.log(`Sending CALL (flash) to http://${host}/CALL (fallback: ${fallbackIp ?? 'none'})...`);
    const res = await client.call();
    console.log(`Device response (${res.status}): ${res.text} [target: ${client.getActiveHost()}]`);
    return;
  }

  if (command === 'hold') {
    const val = args[2] ?? '1';
    const hold = val === '1' || val.toLowerCase() === 'true';
    const client = new TallyMaHttpClient(host, 80, { fallbackIp });
    console.log(`Setting HOLDDATA=${hold ? 1 : 0} on http://${host} (fallback: ${fallbackIp ?? 'none'})...`);
    const res = await client.setHoldData(hold);
    console.log(`Device response (${res.status}): ${res.text} [target: ${client.getActiveHost()}]`);
    return;
  }

  if (command === 'brightness') {
    const level = (args[2] ?? 'medium').toUpperCase() as BrightnessLevel;
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(level)) {
      console.error('Error: Brightness must be low, medium, or high.');
      process.exit(1);
    }
    const client = new TallyMaHttpClient(host, 80, { fallbackIp });
    console.log(`Setting brightness to ${level} on http://${host} (fallback: ${fallbackIp ?? 'none'})...`);
    const res = await client.setBrightness(level);
    console.log(`Device response (${res.status}): ${res.text} [target: ${client.getActiveHost()}]`);
    return;
  }

  if (command === 'cloud') {
    const enable = args[2]?.toLowerCase() === 'on' || args[2] === '1';
    const client = new TallyMaHttpClient(host, 80, { fallbackIp });
    const srvIdx = args.indexOf('--server');
    const portIdx = args.indexOf('--port');
    if (srvIdx !== -1 && args[srvIdx + 1] && portIdx !== -1 && args[portIdx + 1]) {
      const server = args[srvIdx + 1]!;
      const port = parseInt(args[portIdx + 1]!, 10);
      console.log(`Configuring cloud server ${server}:${port}...`);
      await client.setCloudServer(server, port);
    }
    console.log(`Setting cloud mode ${enable ? 'ON' : 'OFF'} on http://${host}...`);
    const res = await client.setCloud(enable);
    console.log(`Device response (${res.status}): ${res.text} [target: ${client.getActiveHost()}]`);
    return;
  }

  // Moving animation over UDP
  if (command === 'rainbow') {
    let duration = 5.0;
    let fps = 20.0;
    const durIdx = args.indexOf('--duration');
    if (durIdx !== -1 && args[durIdx + 1]) duration = parseFloat(args[durIdx + 1]!);
    const fpsIdx = args.indexOf('--fps');
    if (fpsIdx !== -1 && args[fpsIdx + 1]) fps = parseFloat(args[fpsIdx + 1]!);

    console.log(`Streaming moving rainbow animation to ${host}:${TALLYMA_UDP_PORT} over UDP for ${duration}s at ${fps} FPS...`);
    const udp = new TallyMaUdpClient();
    const intervalMs = 1000 / fps;
    const start = Date.now();
    let sent = 0;

    while ((Date.now() - start) < duration * 1000) {
      const elapsed = (Date.now() - start) / 1000;
      const offset = elapsed / 2.5;

      const zones: RGB[] = [];
      for (let i = 0; i < 9; i++) {
        const hue = (offset + i / 9) % 1.0;
        zones.push(hsvToRgb(hue, 1.0, 1.0));
      }

      await udp.send(host, zones, TALLYMA_UDP_PORT, fallbackIp);
      sent++;
      await new Promise((r) => setTimeout(r, intervalMs));
    }

    await udp.close();
    console.log(`Done. Sent ${sent} UDP frames.`);
    return;
  }

  // Camera Director / PTZ Cueing over UDP
  if (command === 'cue') {
    const direction = args[2] as import('./types.js').CameraCueDirection;
    if (!direction || !['pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'operator-call'].includes(direction)) {
      console.error('Error: Direction must be pan-left, pan-right, zoom-in, zoom-out, or operator-call.');
      process.exit(1);
    }

    let durationMs = 2000;
    const durIdx = args.indexOf('--duration');
    if (durIdx !== -1 && args[durIdx + 1]) durationMs = parseInt(args[durIdx + 1]!, 10);

    console.log(`Sending cue "${direction}" to ${host} for ${durationMs}ms over UDP...`);
    const { TallyDevice } = await import('./devices/tally-device.js');
    const device = new TallyDevice({ id: rawTarget, name: rawTarget, host, fallbackIp });
    await device.cueCamera(direction, durationMs);
    device.destroy();
    console.log('Cue finished.');
    return;
  }

  // Sequentially cycle through each of the 9 LEDs to verify physical layout
  if (command === 'cycle') {
    let stepMs = 500;
    const speedIdx = args.indexOf('--speed');
    if (speedIdx !== -1 && args[speedIdx + 1]) stepMs = parseInt(args[speedIdx + 1]!, 10);

    console.log(`\nSequentially testing each of the 9 LEDs on ${host} (${stepMs}ms per step)...`);
    console.log('Use this to observe physical LED numbering (e.g. front vs back 1 and 9).\n');

    const udp = new TallyMaUdpClient();
    const testColors: Array<{ name: string; rgb: RGB }> = [
      { name: 'Red', rgb: [...TALLY_COLORS.pgm] },
      { name: 'Green', rgb: [...TALLY_COLORS.prv] },
      { name: 'Amber', rgb: [...TALLY_COLORS.amber] },
    ];

    for (let led = 0; led < 9; led++) {
      for (const color of testColors) {
        process.stdout.write(`\r-> Testing LED #${led + 1} (Zone Index ${led}): ${color.name}   `);
        const frame: RGB[] = Array.from({ length: 9 }, () => [0, 0, 0]);
        frame[led] = [...color.rgb];
        await udp.send(host, frame, TALLYMA_UDP_PORT, fallbackIp);
        await new Promise((r) => setTimeout(r, stepMs));
      }
    }

    // Turn all off at the end
    const offFrame: RGB[] = Array.from({ length: 9 }, () => [0, 0, 0]);
    await udp.send(host, offFrame, TALLYMA_UDP_PORT, fallbackIp);
    await udp.close();

    console.log('\n\nCycle test complete. All 9 LEDs returned to OFF.');
    return;
  }

  // Set command: HTTP by default!
  if (command === 'set') {
    const colorStr = args[2];
    if (!colorStr) {
      console.error('Error: Color or mode required (e.g. pgm, prv, off, #FF0000).');
      process.exit(1);
    }

    const useUdp = args.includes('--udp');

    if (useUdp) {
      const rgb = parseColor(colorStr);
      const udp = new TallyMaUdpClient();
      const bytes = await udp.send(host, rgb, TALLYMA_UDP_PORT, fallbackIp);
      console.log(`[UDP] Sent 29-byte UDP packet to ${host}:${TALLYMA_UDP_PORT} (${bytes} bytes). RGB: [${rgb.join(', ')}]`);
      await udp.close();
      return;
    }

    // Default: HTTP
    const client = new TallyMaHttpClient(host, 80, { fallbackIp });
    const lower = colorStr.toLowerCase();
    let res;
    if (lower === 'pgm' || lower === 'red') {
      console.log(`[HTTP] Setting Program (Red) -> http://${host}/PGM`);
      res = await client.setProgram();
    } else if (lower === 'prv' || lower === 'green') {
      console.log(`[HTTP] Setting Preview (Green) -> http://${host}/PRV`);
      res = await client.setPreview();
    } else if (lower === 'off' || lower === 'black' || lower === 'none') {
      console.log(`[HTTP] Setting Off -> http://${host}/NONE`);
      res = await client.setOff();
    } else {
      const rgb = parseColor(colorStr);
      console.log(`[HTTP] Setting Color [${rgb.join(',')}] -> http://${host}/COLOR`);
      res = await client.setColor(rgb[0], rgb[1], rgb[2]);
    }
    console.log(`Device response (${res.status}): ${res.text} [target: ${client.getActiveHost()}]`);
    return;
  }

  console.error(`Unknown command: "${command}". Run "pilight help" for usage.`);
  process.exit(1);
}

// When executed directly
if (process.argv[1]?.endsWith('cli.ts') || process.argv[1]?.endsWith('cli.js')) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error('CLI error:', err);
    process.exit(1);
  });
}
