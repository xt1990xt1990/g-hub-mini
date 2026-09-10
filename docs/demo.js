import { crc16, decodeProfile, patchProfile } from './protocol.js';

export class DemoMouse {
  constructor() {
    this.demo = true;
    this.name = 'G502 X · 演示设备';
    this.identity = 'demo';
    this.mode = 1;
    this.currentDpi = 800;
    this.supported = Array.from({ length: 511 }, (_, i) => 100 + i * 50);
    this.info = { memory: 1, format: 5, count: 1, sectors: 6, size: 256 };
    this.initialProfile = 1;
    const raw = new Uint8Array(256).fill(0xff);
    const v = new DataView(raw.buffer);
    raw[0] = 1; raw[1] = 1; raw[2] = 0;
    [400, 800, 1600, 3200, 6400].forEach((n, i) => v.setUint16(3 + i * 2, n, true));
    v.setUint16(254, crc16(raw.subarray(0, 254)));
    this.profiles = [{ sector: 1, raw, ...decodeProfile(raw) }];
    this.backups = new Map([[1, raw.slice()]]);
  }
  async preview(n) {
    if (!this.supported.includes(n)) throw new Error('演示支持 100–25600 DPI，步进 50。');
    this.mode = 2;
    this.currentDpi = n;
  }
  async onboard() { this.mode = 1; this.currentDpi = this.profiles[0].dpi[this.profiles[0].defaultIndex]; }
  async writeProfile(profile, values, backup) {
    const next = patchProfile(profile.raw, values, this.supported);
    await backup({ version: 1, identity: 'demo', sector: profile.sector, info: this.info, bytes: Array.from(profile.raw) });
    Object.assign(profile, { raw: next, ...decodeProfile(next) });
    return true;
  }
  async disconnect() {}
}
