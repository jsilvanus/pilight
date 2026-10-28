import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUdpPacket,
  TALLYMA_PACKET_LENGTH,
  TALLYMA_UDP_MAGIC,
} from '../src/protocols/tallyma-udp.js';
import { type RGB } from '../src/types.js';

test('UDP packet length and magic header', () => {
  const packet = buildUdpPacket([255, 0, 0]);

  assert.equal(packet.length, TALLYMA_PACKET_LENGTH);
  assert.equal(packet.length, 29);
  assert.equal(packet[0], 0x02);
  assert.equal(packet[1], 0x05);
});

test('UDP packet for Program (Red)', () => {
  const packet = buildUdpPacket([255, 0, 0]);

  // Check 9 triplets
  for (let i = 0; i < 9; i++) {
    const offset = 2 + i * 3;
    assert.equal(packet[offset], 255, `Red component mismatch at zone ${i}`);
    assert.equal(packet[offset + 1], 0, `Green component mismatch at zone ${i}`);
    assert.equal(packet[offset + 2], 0, `Blue component mismatch at zone ${i}`);
  }
});

test('UDP packet for Preview (Green)', () => {
  const packet = buildUdpPacket([0, 255, 0]);

  for (let i = 0; i < 9; i++) {
    const offset = 2 + i * 3;
    assert.equal(packet[offset], 0);
    assert.equal(packet[offset + 1], 255);
    assert.equal(packet[offset + 2], 0);
  }
});

test('UDP packet for Off (Black)', () => {
  const packet = buildUdpPacket([0, 0, 0]);

  for (let i = 0; i < 9; i++) {
    const offset = 2 + i * 3;
    assert.equal(packet[offset], 0);
    assert.equal(packet[offset + 1], 0);
    assert.equal(packet[offset + 2], 0);
  }
});

test('UDP packet with individual 9 zones', () => {
  const zones: RGB[] = [
    [10, 20, 30],
    [40, 50, 60],
    [70, 80, 90],
    [100, 110, 120],
    [130, 140, 150],
    [160, 170, 180],
    [190, 200, 210],
    [220, 230, 240],
    [250, 255, 5],
  ];

  const packet = buildUdpPacket(zones);
  assert.equal(packet.length, 29);

  for (let i = 0; i < 9; i++) {
    const offset = 2 + i * 3;
    assert.equal(packet[offset], zones[i]![0]);
    assert.equal(packet[offset + 1], zones[i]![1]);
    assert.equal(packet[offset + 2], zones[i]![2]);
  }
});

test('UDP packet clamps values out of 0..255 range', () => {
  const packet = buildUdpPacket([-50, 300, 128]);

  assert.equal(packet[2], 0);
  assert.equal(packet[3], 255);
  assert.equal(packet[4], 128);
});
