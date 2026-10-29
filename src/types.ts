/**
 * Core type definitions for pilight and Tally-Ma tally light control.
 */

export type RGB = [number, number, number];

export type TallyMode = 'off' | 'pgm' | 'prv' | 'color' | 'zones' | 'animation' | 'segmented';

export type BrightnessLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export type TallyProtocol = 'http' | 'udp' | 'cloud';

export const TALLY_COLORS = {
  off: [0, 0, 0] as RGB,
  pgm: [255, 0, 0] as RGB,            // Program / Red
  prv: [0, 255, 0] as RGB,            // Preview / Green
  amber: [255, 170, 0] as RGB,        // Standby / Buffering / Warming
  yellow: [255, 255, 0] as RGB,
  cyan: [0, 204, 255] as RGB,         // Projector Lamp On / Display
  purple: [161, 0, 255] as RGB,       // Matrix Route 1
  electricBlue: [0, 102, 255] as RGB, // Matrix Route 2
  blue: [0, 0, 255] as RGB,
  white: [255, 255, 255] as RGB,
} as const;

export const CLOUD_STATES = {
  OFF: 0,
  PROGRAM: 1,
  PREVIEW: 2,
  RECORDING: 3,
  STREAMING: 4,
} as const;

export type CloudState = (typeof CLOUD_STATES)[keyof typeof CLOUD_STATES];

/**
 * Known default mDNS hostnames and observed IP fallbacks.
 */
export const DEFAULT_TALLY_DEVICES: Record<string, { host: string; fallbackIp?: string | undefined }> = {
  'tally01': { host: 'tally01.local', fallbackIp: '192.168.1.70' },
  'tally02': { host: 'tally02.local', fallbackIp: '192.168.1.89' },
};

/**
 * System facets a segment or tally light can follow.
 */
export type SegmentFacet =
  | { type: 'atem-input'; input: number }           // Program (Red), Preview (Green), Off (Black)
  | { type: 'youtube-stream' }                      // Live (Red), Connecting (Amber), Off (Black)
  | { type: 'matrox-encoder'; encoder: 1 | 2 }      // Live (Red), Starting (Amber), Off (Black)
  | { type: 'atem-recording' }                      // Recording (Red), Off (Black)
  | { type: 'atem-streaming' }                      // Streaming (Red), Off (Black)
  | { type: 'projector'; projector: 1 | 2 }         // On (Cyan), Warming/Cooling (Amber), Off (Black)
  | { type: 'atlona-output'; output: number }        // Routed (Purple/Blue), Off (Black)
  | { type: 'atlona-input'; input: number }         // Routed to any display (Purple/Blue), Off (Black)
  | { type: 'pi-output'; output: 1 | 2 }            // On Air / Playing (Red), Off (Black)
  | { type: 'stt-state' }                           // Speech/Busy (Amber/Green), Off (Black)
  | { type: 'caption-state' }                       // Captions flowing (Cyan), Off (Black)
  | { type: 'manual'; color?: RGB | undefined };

/**
 * A freely configured group of LEDs within the 9 total zones (indices 0..8).
 */
export interface LightSegment {
  id: string;                                       // e.g. 'stream', 'rec', 'projector'
  name: string;                                     // friendly label
  leds: number[];                                   // 0-based indices in 0..8 (e.g. [0, 1, 2])
  facet: SegmentFacet;                              // facet this segment reflects
}

/**
 * Camera operator cueing directions (sent via LED animations/flashes).
 */
export type CameraCueDirection =
  | 'pan-left'
  | 'pan-right'
  | 'zoom-in'
  | 'zoom-out'
  | 'operator-call';

export interface TallyLightConfig {
  id: string;
  name: string;
  host?: string | undefined;                        // Primary host, defaults to mDNS (e.g. 'tally01.local')
  fallbackIp?: string | undefined;                  // Optional fallback IP if mDNS resolution fails
  ip?: string | undefined;                          // Alias for host or fallbackIp
  httpPort?: number | undefined;                    // Default: 80
  udpPort?: number | undefined;                     // Default: 21324
  protocol?: TallyProtocol | undefined;             // Default: 'http' (HTTP for solid; UDP for animations/multi-status)
  segments?: LightSegment[] | undefined;            // Optional free segmenting of the 9 LEDs
  cloudTopic?: string | undefined;                  // Optional MQTT topic if using cloud mode
}

export interface TallyLightState {
  id: string;
  host: string;
  fallbackIp?: string | undefined;
  activeTarget: string;                             // Current host or IP being contacted
  mode: TallyMode;
  rgb: RGB;
  zones?: RGB[] | undefined;                        // 9 individual RGB triplets if mode is 'zones' or 'segmented'
  segments?: LightSegment[] | undefined;            // Currently active segments
  isAnimating?: boolean | undefined;                // true if an active moving UDP animation or cue is playing
  brightness?: BrightnessLevel | undefined;
  holdData?: boolean | undefined;
  cloudMode?: boolean | undefined;
  lastUpdated: string;                              // ISO timestamp
  online: boolean;
}

export interface SetStateRequest {
  mode: TallyMode;
  rgb?: RGB | undefined;
  zones?: RGB[] | undefined;
}
