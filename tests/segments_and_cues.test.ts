import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TallyDevice } from '../src/devices/tally-device.js';
import { evaluateFacetColor, type SystemStatusSnapshot } from '../src/coordinator.js';
import { TALLY_COLORS, type LightSegment, type RGB } from '../src/types.js';

test('Free segmenting of 9 LEDs into custom groups', async () => {
  const udpPackets: Array<{ zones: RGB[] }> = [];

  const mockUdpClient: any = {
    send: async (_host: string, zones: RGB[]) => {
      udpPackets.push({ zones: zones.map((z) => [...z] as RGB) });
      return 29;
    },
    close: async () => {},
  };

  const segments: LightSegment[] = [
    { id: 'stream', name: 'YouTube Stream', leds: [0, 1, 2], facet: { type: 'youtube-stream' } },
    { id: 'rec', name: 'ATEM Recording', leds: [3, 4, 5], facet: { type: 'atem-recording' } },
    { id: 'projector', name: 'Main Projector', leds: [6, 7, 8], facet: { type: 'projector', projector: 1 } },
  ];

  const device = new TallyDevice(
    {
      id: 'monitor1',
      name: 'Studio Multi-Monitor',
      host: 'tally01.local',
      segments,
    },
    { udp: mockUdpClient }
  );

  // 1. Update stream segment to Red
  await device.updateSegment('stream', [...TALLY_COLORS.pgm]);
  assert.equal(udpPackets.length, 1);
  const frame1 = udpPackets[0]!.zones;

  // LEDs 0..2 should be Red
  for (let i = 0; i <= 2; i++) {
    assert.deepEqual(frame1[i], [255, 0, 0], `LED ${i} should be Red`);
  }
  // LEDs 3..8 should be Off
  for (let i = 3; i <= 8; i++) {
    assert.deepEqual(frame1[i], [0, 0, 0], `LED ${i} should be Off`);
  }

  // 2. Update projector segment to Cyan
  await device.updateSegment('projector', [...TALLY_COLORS.cyan]);
  assert.equal(udpPackets.length, 2);
  const frame2 = udpPackets[1]!.zones;

  // Stream segment (0..2) should remain Red
  for (let i = 0; i <= 2; i++) {
    assert.deepEqual(frame2[i], [255, 0, 0]);
  }
  // Recording segment (3..5) remains Off
  for (let i = 3; i <= 5; i++) {
    assert.deepEqual(frame2[i], [0, 0, 0]);
  }
  // Projector segment (6..8) should be Cyan
  for (let i = 6; i <= 8; i++) {
    assert.deepEqual(frame2[i], [0, 204, 255]);
  }

  device.destroy();
});

test('Camera cueing: operator call and direction cues send animated UDP frames', async () => {
  const udpPackets: Array<{ zones: RGB[] }> = [];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('OK', { status: 200 })) as any;

  try {
    const mockUdpClient: any = {
      send: async (_host: string, zones: RGB[]) => {
        udpPackets.push({ zones: zones.map((z) => [...z] as RGB) });
        return 29;
      },
      close: async () => {},
    };

    const device = new TallyDevice(
      {
        id: 'cam1',
        name: 'Camera 1',
        host: 'tally01.local',
      },
      { udp: mockUdpClient }
    );

    // Cue pan-left for a short duration
    await device.cueCamera('pan-left', 150);
    assert.ok(udpPackets.length > 0, 'Should stream cue frames over UDP');

    // Cue operator-call
    udpPackets.length = 0;
    await device.cueCamera('operator-call', 150);
    assert.ok(udpPackets.length > 0, 'Should stream operator call frames');

    device.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Facet evaluator maps telemetry to broadcast colors', () => {
  const snapshot: SystemStatusSnapshot = {
    atem: { programInput: 1, previewInput: 2 },
    youtube: { live: true },
    projectors: { projector1On: true, projector2On: false },
    atlona: { output1Input: 1, output2Input: 2 },
  };

  // ATEM input 1 -> Program (Red)
  assert.deepEqual(evaluateFacetColor({ type: 'atem-input', input: 1 }, snapshot), [255, 0, 0]);

  // ATEM input 2 -> Preview (Green)
  assert.deepEqual(evaluateFacetColor({ type: 'atem-input', input: 2 }, snapshot), [0, 255, 0]);

  // ATEM input 3 -> Off
  assert.deepEqual(evaluateFacetColor({ type: 'atem-input', input: 3 }, snapshot), [0, 0, 0]);

  // YouTube live -> Red
  assert.deepEqual(evaluateFacetColor({ type: 'youtube-stream' }, snapshot), [255, 0, 0]);

  // Projector 1 On -> Cyan
  assert.deepEqual(evaluateFacetColor({ type: 'projector', projector: 1 }, snapshot), [0, 204, 255]);

  // Projector 2 Off -> Off
  assert.deepEqual(evaluateFacetColor({ type: 'projector', projector: 2 }, snapshot), [0, 0, 0]);

  // Atlona Output 1 -> Purple
  assert.deepEqual(evaluateFacetColor({ type: 'atlona-output', output: 1 }, snapshot), [161, 0, 255]);
});
