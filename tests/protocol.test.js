import test from 'node:test';
import assert from 'node:assert/strict';
import { Hidpp, Mouse, crc16, decodeProfile, patchProfile, parseDpiList } from '../docs/protocol.js';

function sector(dpi = [400, 800, 1600, 3200, 6400]) {
  const bytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 31) & 255);
  bytes[0] = 1; bytes[1] = 1; bytes[2] = 0;
  const view = new DataView(bytes.buffer);
  dpi.forEach((n, i) => view.setUint16(3 + 2 * i, n, true));
  view.setUint16(254, crc16(bytes.subarray(0, 254)));
  return bytes;
}

// Simulates the HID wire boundary, not the public Mouse methods.
class FakeDevice extends EventTarget {
  constructor() {
    super();
    this.opened = true;
    this.profile = sector();
    this.directory = new Uint8Array(256).fill(255);
    this.directory.set([0, 1, 1, 0, 255, 255, 0, 0]);
    new DataView(this.directory.buffer).setUint16(254, crc16(this.directory.subarray(0, 254)));
    this.dpi = 800;
    this.mode = 1;
    this.calls = [];
  }
  async close() { this.opened = false; }
  async sendReport(reportId, bytes) {
    assert.equal(reportId, 0x11);
    assert.equal(bytes.length, 19);
    const [device, feature, address] = bytes;
    const fn = address >> 4;
    const payload = bytes.slice(3);
    this.calls.push({ feature, fn, payload });
    if (this.silent) return;
    const reply = new Uint8Array(19);
    reply.set([device, feature, address]);
    const out = reply.subarray(3);
    const input = new DataView(payload.buffer);
    const output = new DataView(out.buffer, out.byteOffset);
    if (feature === 0 && fn === 0) out[0] = new Map([[0x2201, 3], [0x8100, 4], [0x0003, 5]]).get(input.getUint16(0)) || 0;
    else if (feature === 5) out.set([1, 0xaa, 0xbb, 0xcc, 0xdd]);
    else if (feature === 3 && fn === 1) out.set([0, 0, 100, 0xe0, 50, 0x64, 0]);
    else if (feature === 3 && fn === 2) output.setUint16(1, this.dpi);
    else if (feature === 3 && fn === 3) this.dpi = input.getUint16(1);
    else if (feature === 4) {
      if (fn === 0) out.set([1, 5, 1, 1, 1, 13, 6, 1, 0]);
      else if (fn === 1) this.mode = payload[0];
      else if (fn === 2) out[0] = this.mode;
      else if (fn === 3) this.dpi = decodeProfile(this.profile).dpi[this.profile[1]];
      else if (fn === 4) out.set([0, 1]);
      else if (fn === 5) {
        const source = input.getUint16(0) === 0 ? this.directory : this.profile;
        const offset = input.getUint16(2);
        out.set(source.subarray(offset, offset + 16));
        if (this.corruptRead && this.committed && offset === 0) out[3] ^= 1;
      } else if (fn === 6) {
        assert.equal(input.getUint16(0), 1);
        assert.equal(input.getUint16(2), 0);
        assert.equal(input.getUint16(4), 256);
        this.staging = new Uint8Array(256); this.offset = 0;
      } else if (fn === 7) {
        this.staging.set(payload, this.offset); this.offset += 16;
      } else if (fn === 8) {
        assert.equal(this.offset, 256); this.profile = this.staging; this.committed = true;
      }
    }
    if (this.errorFn === fn && feature === 4) reply.set([device, 0xff, feature, address, 3]);
    queueMicrotask(() => {
      // Unrelated software-ID/device reports must not satisfy the pending request.
      const unrelated = new Event('inputreport');
      unrelated.reportId = 0x11;
      const noise = reply.slice(); noise[0] = 99;
      unrelated.data = new DataView(noise.buffer); this.dispatchEvent(unrelated);
      const event = new Event('inputreport');
      event.reportId = 0x11; event.data = new DataView(reply.buffer); this.dispatchEvent(event);
    });
  }
}

async function fixture(t) {
  const device = new FakeDevice();
  const hid = new Hidpp(device, 1, () => {}, 40);
  t.after(() => hid.dispose());
  const mouse = new Mouse(hid, 'G502 X PLUS');
  await mouse.init();
  assert.equal(mouse.profileError, undefined);
  return { mouse, hid, device };
}
const changes = { dpi: [400, 1000, 1800, 0, 0], defaultIndex: 1, shiftIndex: 0 };

test('CRC known vector; changing DPI preserves all other profile bytes', () => {
  assert.equal(crc16(new TextEncoder().encode('123456789')), 0x29b1);
  const raw = sector();
  const next = patchProfile(raw, changes, [400, 1000, 1800]);
  assert.deepEqual(decodeProfile(next), changes);
  assert.equal(next[0], raw[0]);
  assert.deepEqual(next.subarray(13, 254), raw.subarray(13, 254));
  assert.equal(decodeProfile(raw).dpi[1], 800);
  const broken = raw.slice(); broken[22] ^= 1;
  assert.throws(() => patchProfile(broken, changes, [400, 1000, 1800]), /CRC/);
  assert.throws(() => patchProfile(raw, { ...changes, defaultIndex: 4 }, [400, 1000, 1800]), /已启用/);
  assert.throws(() => patchProfile(raw, changes, [400, 800]), /不支持/);
});

test('device DPI range and discrete values decode correctly', () => {
  const range = parseDpiList(Uint8Array.of(0, 0, 100, 0xe0, 50, 0x64, 0, 0, 0));
  assert.equal(range.length, 511); assert.equal(range[0], 100); assert.equal(range.at(-1), 25600);
  assert.deepEqual(parseDpiList(Uint8Array.of(0, 1, 144, 3, 32, 6, 64, 0, 0)), [400, 800, 1600]);
});

test('reads device profile; previews DPI in host mode and verifies it', async t => {
  const { mouse, device } = await fixture(t);
  assert.equal(mouse.initialProfile, 1);
  assert.equal(mouse.info.format, 5);
  assert.equal(mouse.profiles.length, 1);
  assert.equal(mouse.currentDpi, 800);
  await mouse.preview(1200);
  assert.equal(device.mode, 2); assert.equal(mouse.currentDpi, 1200);
  await mouse.onboard(1);
  assert.equal(device.mode, 1); assert.equal(mouse.currentDpi, 800);
  assert.equal(device.calls.filter(c => c.feature === 4 && [6, 7, 8].includes(c.fn)).length, 0);
});

test('backup precedes flash writes; correct sequence and readback preserve unrelated fields', async t => {
  const { mouse, device } = await fixture(t);
  const original = device.profile.slice();
  let backedUp = false;
  await mouse.writeProfile(mouse.profiles[0], changes, async backup => {
    assert.equal(device.calls.some(c => c.feature === 4 && c.fn === 6), false);
    assert.deepEqual(backup.bytes, Array.from(original)); backedUp = true;
  });
  assert.equal(backedUp, true);
  const writes = device.calls.filter(c => c.feature === 4 && [6, 7, 8].includes(c.fn));
  assert.deepEqual(writes.map(c => c.fn), [6, ...new Array(16).fill(7), 8]);
  assert.deepEqual(device.profile.subarray(13, 254), original.subarray(13, 254));
  assert.deepEqual(decodeProfile(device.profile), changes);
  assert.deepEqual(mouse.backups.get(1), original);
});

test('backup failure and stale profile stop before any write', async t => {
  const { mouse, device } = await fixture(t);
  await assert.rejects(mouse.writeProfile(mouse.profiles[0], changes, async () => { throw new Error('Storage full'); }), /Storage full/);
  assert.equal(device.calls.some(c => c.feature === 4 && c.fn === 6), false);
  device.profile = sector([500, 800, 1600, 3200, 6400]);
  await assert.rejects(mouse.writeProfile(mouse.profiles[0], changes, async () => {}), /发生变化/);
  assert.equal(device.calls.some(c => c.feature === 4 && c.fn === 6), false);
});

test('readback mismatch is reported, never claimed as a successful save', async t => {
  const { mouse, device } = await fixture(t);
  const before = mouse.profiles[0].raw.slice();
  device.corruptRead = true;
  await assert.rejects(mouse.writeProfile(mouse.profiles[0], changes, async () => {}), /回读不一致/);
  assert.deepEqual(mouse.profiles[0].raw, before);
});

test('firmware error aborts write sequence with original profile retained', async t => {
  const { mouse, device } = await fixture(t);
  device.errorFn = 7;
  await assert.rejects(mouse.writeProfile(mouse.profiles[0], changes, async () => {}), /HID\+\+ 错误/);
  assert.equal(device.committed, undefined);
  assert.equal(device.calls.some(c => c.feature === 4 && c.fn === 8), false);
});

test('timeout invalidates connection so commands are not retried', async t => {
  const { hid, device } = await fixture(t);
  device.silent = true;
  await assert.rejects(hid.request(4, 2), /超时/);
  const count = device.calls.length;
  await assert.rejects(hid.request(4, 2), /重新连接/);
  assert.equal(device.calls.length, count);
});
