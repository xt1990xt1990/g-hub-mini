export const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join(' ');
const view = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
export const be16 = n => [n >> 8, n & 255];
const equal = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);

export function crc16(bytes) {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  return crc;
}

export function checkSector(bytes) {
  if (bytes.length < 16 || crc16(bytes.subarray(0, -2)) !== view(bytes).getUint16(bytes.length - 2)) {
    throw new Error('板载配置 CRC 校验失败，未写入。请下载日志。');
  }
}

export function decodeProfile(bytes) {
  checkSector(bytes);
  return { dpi: Array.from({ length: 5 }, (_, i) => view(bytes).getUint16(3 + i * 2, true)), defaultIndex: bytes[1], shiftIndex: bytes[2] };
}

export function patchProfile(original, values, supported) {
  checkSector(original);
  if (values.dpi.length !== 5 || !values.dpi.some(n => n > 0)) throw new Error('至少保留一个 DPI 档位。');
  for (const n of values.dpi) if (!Number.isInteger(n) || (n !== 0 && !supported.includes(n))) throw new Error(`设备不支持 DPI ${n}；0 表示关闭该档位。`);
  for (const i of [values.defaultIndex, values.shiftIndex]) {
    if (!Number.isInteger(i) || i < 0 || i > 4 || !values.dpi[i]) throw new Error('默认和狙击 DPI 必须指向已启用的档位。');
  }
  const next = original.slice();
  next[1] = values.defaultIndex;
  next[2] = values.shiftIndex;
  values.dpi.forEach((n, i) => view(next).setUint16(3 + i * 2, n, true));
  view(next).setUint16(next.length - 2, crc16(next.subarray(0, -2)));
  return next;
}

export function parseDpiList(bytes) {
  const values = [];
  for (let offset = 1; offset + 1 < bytes.length; offset += 2) {
    const n = view(bytes).getUint16(offset);
    if (!n) break;
    if ((n & 0xe000) === 0xe000) {
      const step = n & 0x1fff;
      const start = values.at(-1);
      const end = offset + 3 < bytes.length ? view(bytes).getUint16(offset + 2) : 0;
      if (!step || !start || end < start) throw new Error('无法解析设备的 DPI 范围。');
      for (let dpi = start + step; dpi <= end; dpi += step) values.push(dpi);
      offset += 2;
    } else values.push(n);
  }
  if (!values.length) throw new Error('设备没有返回可用 DPI。');
  return [...new Set(values)];
}

export class Hidpp {
  constructor(device, index, log = () => {}, timeout = 1800) {
    this.device = device;
    this.index = index;
    this.log = log;
    this.timeout = timeout;
    this.softwareId = 1;
    this.queue = Promise.resolve();
    this.features = new Map();
    this.listener = event => {
      if (![0x10, 0x11].includes(event.reportId)) return;
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      if (bytes[0] !== this.index || !this.pending) return;
      const p = this.pending;
      if ((bytes[1] === 0xff || bytes[1] === 0x8f) && bytes[2] === p.feature && bytes[3] === p.address) {
        this.log(`RX error ${hex(bytes)}`);
        const error = new Error(`HID++ 错误 0x${bytes[4].toString(16)}，功能 0x${p.feature.toString(16)} / 命令 0x${p.address.toString(16)}`);
        error.code = bytes[4];
        p.finish(error);
      } else if (bytes[1] === p.feature && bytes[2] === p.address) {
        this.log(`RX ${hex(bytes)}`);
        p.finish(null, bytes.slice(3));
      }
    };
    device.addEventListener('inputreport', this.listener);
  }
  request(feature, fn, payload = []) {
    const run = () => new Promise((resolve, reject) => {
      if (this.closed || this.faulted) return reject(new Error('设备连接已失效，请重新连接。'));
      const address = (fn << 4) | this.softwareId;
      this.softwareId = this.softwareId % 15 + 1;
      const bytes = new Uint8Array(19);
      bytes.set([this.index, feature, address]);
      bytes.set(payload, 3);
      const finish = (error, result) => {
        clearTimeout(timer);
        this.pending = null;
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => {
        this.faulted = true;
        finish(new Error(`设备响应超时（功能 ${feature}，命令 ${fn}）。请唤醒鼠标并重新连接。`));
      }, this.timeout);
      this.pending = { feature, address, finish };
      this.log(`TX 11 ${hex(bytes)}`);
      this.device.sendReport(0x11, bytes).catch(error => {
        if (this.pending?.address === address) finish(error);
      });
    });
    const result = this.queue.then(run);
    this.queue = result.catch(() => {});
    return result;
  }
  async feature(id) {
    if (!this.features.has(id)) {
      const bytes = await this.request(0, 0, be16(id));
      if (!bytes[0]) throw new Error(`设备不支持功能 0x${id.toString(16)}`);
      this.features.set(id, bytes[0]);
    }
    return this.features.get(id);
  }
  async call(id, fn, data = []) { return this.request(await this.feature(id), fn, data); }
  dispose() {
    this.closed = true;
    this.device.removeEventListener('inputreport', this.listener);
    this.pending?.finish(new Error('设备已断开。'));
  }
}

function hasLongReport(collection) {
  return collection.outputReports?.some(r => r.reportId === 0x11) || collection.children?.some(hasLongReport);
}

export async function connectMouse(log) {
  const devices = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x046d }] });
  const device = devices.find(d => d.collections.some(hasLongReport));
  if (!device) throw new Error('未选择支持 HID++ 的罗技设备。');
  if (!device.opened) await device.open();
  const receiver = /receiver/i.test(device.productName) || device.productId === 0xc547;
  for (const index of receiver ? [1, 2, 3, 4, 5, 6, 255] : [255, 1, 2, 3, 4, 5, 6]) {
    const hid = new Hidpp(device, index, log);
    try {
      const version = await hid.request(0, 1, [0, 0, 0x5a]);
      if (version[0] < 2 || version[2] !== 0x5a) throw new Error('不是 HID++ 2.0 设备');
      const feature = await hid.feature(0x0005);
      const length = (await hid.request(feature, 0))[0];
      const nameBytes = new Uint8Array(length);
      for (let offset = 0; offset < length; offset += 16) {
        nameBytes.set((await hid.request(feature, 1, [offset])).subarray(0, Math.min(16, length - offset)), offset);
      }
      const name = new TextDecoder().decode(nameBytes);
      if (!/G502\s*X/i.test(name)) throw new Error(`此工具仅支持 G502 X，当前设备为 ${name}`);
      const mouse = new Mouse(hid, name);
      await mouse.init();
      return mouse;
    } catch (error) { log(`探测设备 ${index}: ${error.message}`); hid.dispose(); }
  }
  await device.close();
  throw new Error('未找到 G502 X。请确认型号、唤醒鼠标，或改用 USB 线连接后重试。');
}

export class Mouse {
  constructor(hid, name) { this.hid = hid; this.name = name; this.profiles = []; this.backups = new Map(); }
  async init() {
    this.supported = parseDpiList(await this.hid.call(0x2201, 1, [0]));
    this.currentDpi = await this.getDpi();
    const identity = await this.hid.call(0x0003, 0);
    this.identity = `${this.name}:${hex(identity.subarray(1, 5))}`;
    try {
      const bytes = await this.hid.call(0x8100, 0);
      this.info = { memory: bytes[0], format: bytes[1], count: bytes[3], sectors: bytes[6], size: view(bytes).getUint16(7) };
      this.mode = (await this.hid.call(0x8100, 2))[0];
      this.initialMode = this.mode;
      this.initialProfile = view(await this.hid.call(0x8100, 4)).getUint16(0);
      if (this.info.memory !== 1 || ![1, 2, 3, 5].includes(this.info.format) || ![255, 256].includes(this.info.size)) {
        throw new Error(`板载格式未支持：${JSON.stringify(this.info)}`);
      }
      const directory = await this.readSector(0);
      checkSector(directory);
      for (let i = 0; i < Math.min(this.info.count, 63); i++) {
        const sector = view(directory).getUint16(i * 4);
        if (sector === 0xffff) break;
        if (sector > 0 && sector < this.info.sectors && directory[i * 4 + 2] === 1) {
          const raw = await this.readSector(sector);
          this.profiles.push({ sector, raw, ...decodeProfile(raw) });
          this.backups.set(sector, raw.slice());
        }
      }
      if (!this.profiles.length) throw new Error('没有可写的用户板载配置；当前可能使用出厂配置。');
    } catch (error) { this.profileError = error.message; this.profiles = []; }
  }
  async getDpi() { return view(await this.hid.call(0x2201, 2, [0])).getUint16(1); }
  async setMode(mode) { await this.hid.call(0x8100, 1, [mode]); this.mode = mode; }
  async preview(dpi) {
    if (!this.supported.includes(dpi)) throw new Error('输入值不在设备支持的 DPI 列表中。');
    const previousMode = this.mode;
    if (this.mode === 1) await this.setMode(2);
    try {
      await this.hid.call(0x2201, 3, [0, ...be16(dpi)]);
      this.currentDpi = await this.getDpi();
      if (this.currentDpi !== dpi) throw new Error(`设备回读 DPI 为 ${this.currentDpi}，与输入值不同。`);
    } catch (error) {
      if (previousMode === 1 && !this.hid.faulted) await this.setMode(1);
      throw error;
    }
  }
  async onboard(sector) {
    await this.setMode(1);
    if (sector !== undefined) await this.hid.call(0x8100, 3, be16(sector));
    this.currentDpi = await this.getDpi();
  }
  async readSector(sector) {
    const bytes = new Uint8Array(this.info.size);
    for (let position = 0; position < bytes.length; position += 16) {
      // HID++ always returns 16 bytes; overlap the final read for 255-byte sectors.
      const offset = Math.min(position, bytes.length - 16);
      bytes.set(await this.hid.call(0x8100, 5, [...be16(sector), ...be16(offset)]), offset);
    }
    return bytes;
  }
  async writeProfile(profile, values, backup) {
    const fresh = await this.readSector(profile.sector);
    if (!equal(fresh, profile.raw)) throw new Error('鼠标配置已发生变化，请重新连接读取后再保存。');
    const next = patchProfile(fresh, values, this.supported);
    if (equal(next, fresh)) return false;
    // A durable backup must succeed before the first flash write command.
    await backup({ version: 1, identity: this.identity, info: this.info, sector: profile.sector, created: new Date().toISOString(), bytes: Array.from(fresh) });
    await this.hid.call(0x8100, 6, [...be16(profile.sector), 0, 0, ...be16(next.length)]);
    for (let offset = 0; offset < next.length; offset += 16) await this.hid.call(0x8100, 7, next.subarray(offset, offset + 16));
    await this.hid.call(0x8100, 8);
    const saved = await this.readSector(profile.sector);
    if (!equal(saved, next)) throw new Error('写入后回读不一致。请保留备份和日志，重新连接后检查配置。');
    Object.assign(profile, { raw: saved, ...decodeProfile(saved) });
    return true;
  }
  async disconnect() {
    try { if (this.mode === 2 && this.initialMode === 1 && !this.hid.faulted) await this.onboard(); }
    finally { this.hid.dispose(); await this.hid.device.close(); }
  }
}
