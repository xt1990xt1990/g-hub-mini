import { connectMouse, decodeProfile } from './protocol.js';
import { DemoMouse } from './demo.js';

const $ = id => document.getElementById(id);
let mouse = null;
let busy = false;
let selected = null;
let testing = false;
const logs = [];
const log = message => {
  logs.push(`${new Date().toLocaleTimeString()} ${message}`);
  if (logs.length > 800) logs.shift();
  $('log').textContent = logs.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
};
const status = (message, tone = '') => { $('status').textContent = message; $('status').dataset.tone = tone; };
function download(name, data, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function controls() {
  const ready = Boolean(mouse) && !busy && !testing;
  $('connect').disabled = busy || testing || !navigator.hid;
  $('connect').lastChild.textContent = mouse && !mouse.demo ? '断开连接' : '连接鼠标';
  $('demo').disabled = busy || testing;
  $('demo').textContent = mouse?.demo ? '退出演示' : '演示';
  $('dpi').disabled = !ready;
  $('apply').disabled = !ready;
  $('onboard').disabled = !ready || !mouse.info;
  document.querySelectorAll('[data-dpi]').forEach(button => { button.disabled = !ready || !mouse.supported.includes(Number(button.dataset.dpi)); });
  $('profile').disabled = !ready || !mouse.profiles.length;
  for (const id of ['save', 'backup', 'restore']) $(id).disabled = !ready || !selected;
  document.querySelectorAll('#slots input').forEach(input => { input.disabled = !ready || !selected; });
  $('start').disabled = busy;
}
function renderDevice() {
  $('connection-state').textContent = mouse ? (mouse.demo ? '演示模式' : mouse.name) : '未连接';
  $('connection-state').className = `badge ${mouse ? (mouse.demo ? 'demo' : 'live') : ''}`;
  $('current-dpi').textContent = `当前 DPI：${mouse?.currentDpi ?? '—'}`;
  $('mode').textContent = mouse ? (mouse.mode === 1 ? '板载模式' : '即时试用') : '—';
  if (mouse) {
    $('dpi').value = mouse.currentDpi;
    $('dpi').min = mouse.supported[0];
    $('dpi').max = mouse.supported.at(-1);
    // Supported values are validated against the sensor's own list.
    $('dpi').step = '1';
    $('dpi').title = `${mouse.supported[0]}–${mouse.supported.at(-1)} DPI；以设备支持的档位为准`;
  }
  $('device-info').textContent = mouse ? JSON.stringify({ name: mouse.name, identity: mouse.identity, onboard: mouse.info, profileError: mouse.profileError, dpiRange: [mouse.supported[0], mouse.supported.at(-1)], supportedDpi: mouse.supported }, null, 2) : '未连接设备';
  controls();
}
function renderProfiles() {
  $('profile').replaceChildren();
  for (const profile of mouse?.profiles || []) {
    const option = new Option(`配置 ${profile.sector}${profile.sector === mouse.initialProfile ? ' · 连接时使用' : ''}`, profile.sector);
    $('profile').add(option);
  }
  if (selected) $('profile').value = selected.sector;
  else $('profile').add(new Option('无可写配置', ''));
  const values = selected || { dpi: [0, 0, 0, 0, 0], defaultIndex: -1, shiftIndex: -1 };
  $('slots').replaceChildren();
  values.dpi.forEach((n, i) => {
    const row = document.createElement('tr');
    const number = document.createElement('td'); number.textContent = String(i + 1); row.append(number);
    const dpiCell = document.createElement('td');
    const input = document.createElement('input');
    Object.assign(input, { type: 'number', min: '0', max: String(mouse?.supported.at(-1) || 25600), step: '1', value: String(n), id: `slot-${i}`, title: '输入 0 可关闭此档位' });
    input.setAttribute('aria-label', `档位 ${i + 1} DPI，0 为关闭`);
    dpiCell.append(input); row.append(dpiCell);
    for (const [name, index] of [['default', values.defaultIndex], ['shift', values.shiftIndex]]) {
      const cell = document.createElement('td');
      const radio = document.createElement('input');
      Object.assign(radio, { type: 'radio', name, value: String(i), checked: i === index });
      radio.setAttribute('aria-label', `${name === 'default' ? '默认' : '狙击'}档位 ${i + 1}`);
      cell.append(radio); row.append(cell);
    }
    $('slots').append(row);
  });
  $('save-state').textContent = selected ? '0 可关闭档位 · 保存后切换到此配置' : mouse?.profileError || '等待读取配置';
  controls();
}
async function run(action) {
  if (busy) return;
  busy = true; controls();
  try { await action(); }
  catch (error) { log(error.stack || error.message); status(error.message, 'error'); }
  finally { busy = false; renderDevice(); }
}
function adopt(device) {
  mouse = device;
  selected = mouse?.profiles.find(p => p.sector === mouse.initialProfile) || mouse?.profiles[0] || null;
  renderProfiles(); renderDevice();
}
$('connect').addEventListener('click', () => run(async () => {
  if (mouse && !mouse.demo) { await mouse.disconnect(); adopt(null); status('已断开。'); return; }
  status('选择罗技鼠标或接收器，然后等待设备读取。');
  const device = await connectMouse(log);
  adopt(device);
  status(`已连接 ${mouse.name}。板载写入功能尚待 G502 X 实机验证。${mouse.profileError ? ' ' + mouse.profileError : ''}`);
}));
$('demo').addEventListener('click', () => run(async () => {
  const wasDemo = mouse?.demo;
  if (mouse) await mouse.disconnect();
  adopt(wasDemo ? null : new DemoMouse());
  status(wasDemo ? '已退出演示。' : '演示模式：数值只在页面内变化，不会改变真实鼠标速度或写入设备。');
}));
$('dpi-form').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    if (!mouse) return;
    await mouse.preview(Number($('dpi').value));
    status(`${mouse.demo ? '演示' : '已应用'} ${mouse.currentDpi} DPI。${mouse.demo ? '真实鼠标速度不变。' : '正在即时试用；保存板载档位后才能长期保留。'}`, 'success');
  });
});
document.querySelectorAll('[data-dpi]').forEach(button => button.addEventListener('click', () => {
  $('dpi').value = button.dataset.dpi;
  $('dpi-form').requestSubmit();
}));
$('onboard').addEventListener('click', () => run(async () => {
  await mouse.onboard();
  status('已恢复板载模式。', 'success');
}));
$('profile').addEventListener('change', () => {
  selected = mouse.profiles.find(p => p.sector === Number($('profile').value));
  renderProfiles();
});
function formValues() {
  const index = name => {
    const radio = document.querySelector(`input[name="${name}"]:checked`);
    return radio ? Number(radio.value) : -1;
  };
  return { dpi: Array.from({ length: 5 }, (_, i) => $('slot-' + i).value.trim() === '' ? NaN : Number($('slot-' + i).value)), defaultIndex: index('default'), shiftIndex: index('shift') };
}
async function keepBackup(backup) {
  if (mouse.demo) return;
  const key = `g502x-backup:${backup.identity}:${backup.sector}`;
  // Keep the first original profile across reloads, and a backup before each write.
  const text = JSON.stringify(backup);
  try {
    if (!localStorage.getItem(key)) localStorage.setItem(key, text);
    localStorage.setItem(key + ':latest', text);
  } catch { throw new Error('无法保存本地备份，已停止写入。请允许站点存储后重试。'); }
  log(`原始配置已备份：扇区 ${backup.sector}`);
}
async function saveValues(values) {
  const wrote = await mouse.writeProfile(selected, values, keepBackup);
  $('save-state').textContent = wrote ? '写入成功，回读一致' : '档位没有变化';
  try { await mouse.onboard(selected.sector); }
  catch (error) { throw new Error(`档位已保存且回读一致，但激活配置失败：${error.message}`); }
  renderProfiles();
  $('save-state').textContent = mouse.demo ? '已保存演示配置' : '已保存 · 回读一致';
  status(mouse.demo ? '演示配置已保存，未写入真实鼠标。' : '板载档位已写入并验证。请断电重连，再确认 DPI 档位是否保留。', 'success');
}
$('save').addEventListener('click', () => run(() => saveValues(formValues())));
$('restore').addEventListener('click', () => run(async () => {
  const original = mouse.backups.get(selected.sector);
  await saveValues(decodeProfile(original));
}));
$('backup').addEventListener('click', () => {
  const backup = { version: 1, identity: mouse.identity, info: mouse.info, profiles: Array.from(mouse.backups, ([sector, bytes]) => ({ sector, bytes: Array.from(bytes) })) };
  if (!mouse.demo) {
    backup.savedBackups = mouse.profiles.map(p => {
      const key = `g502x-backup:${mouse.identity}:${p.sector}`;
      try { return { original: JSON.parse(localStorage.getItem(key)), latest: JSON.parse(localStorage.getItem(key + ':latest')) }; }
      catch { return null; }
    });
  }
  download('g502x-profile-backup.json', JSON.stringify(backup, null, 2));
});
$('download-log').addEventListener('click', () => download('g502x-log.txt', $('device-info').textContent + '\n\n' + logs.join('\n'), 'text/plain'));
navigator.hid?.addEventListener('disconnect', event => {
  if (mouse?.hid?.device === event.device) {
    mouse.hid.dispose();
    if (testing) finishPractice(false);
    adopt(null); status('鼠标已断开，请重新连接。');
  }
});
window.addEventListener('beforeunload', event => {
  if (busy || (mouse && !mouse.demo && mouse.mode === 2 && mouse.initialMode === 1)) {
    event.preventDefault(); event.returnValue = '';
  }
});

// A small target drill compares feel; screen coordinates do not measure hardware DPI.
const canvas = $('field');
const context = canvas.getContext('2d');
let target = { x: .5, y: .5 };
let hits = 0, clicks = 0, started = 0, lastHit = 0, intervals = [], frame = 0;
let testDpi = '—';
const history = [];
function paint() {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  context.fillStyle = '#e0e8e2';
  for (let x = 20; x < width; x += 24) for (let y = 20; y < height; y += 24) context.fillRect(x, y, 1, 1);
  const x = target.x * width, y = target.y * height;
  context.beginPath(); context.arc(x, y, 22, 0, Math.PI * 2); context.fillStyle = testing ? '#147c66' : '#c2d5ca'; context.fill();
  context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.fillStyle = '#fff'; context.fill();
}
new ResizeObserver(paint).observe(canvas);
function moveTarget() { target = { x: .12 + Math.random() * .76, y: .14 + Math.random() * .68 }; paint(); }
function meanInterval() { return intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : null; }
function updateStats() {
  $('hits').textContent = hits;
  $('accuracy').textContent = clicks ? `${Math.round(hits / clicks * 100)}%` : '—';
  $('reaction').textContent = intervals.length ? `${meanInterval()} ms` : '—';
}
function finishPractice(record = true) {
  testing = false; cancelAnimationFrame(frame);
  $('start').lastChild.textContent = '再次测试';
  $('arena-state').textContent = record ? '测试结束' : '已停止';
  if (record) {
    history.unshift({ dpi: testDpi, hits, accuracy: clicks ? `${Math.round(hits / clicks * 100)}%` : '—', interval: intervals.length ? `${meanInterval()} ms` : '—' });
    if (history.length > 10) history.pop();
    renderHistory();
  }
  controls(); paint();
}
function renderHistory() {
  $('history').replaceChildren();
  if (!history.length) {
    const row = $('history').insertRow(); const cell = row.insertCell(); cell.colSpan = 4; cell.className = 'empty'; cell.textContent = '暂无记录';
  }
  for (const result of history) {
    const row = $('history').insertRow();
    for (const key of ['dpi', 'hits', 'accuracy', 'interval']) row.insertCell().textContent = result[key];
  }
}
function tick() {
  const remaining = Math.max(0, 20 - (performance.now() - started) / 1000);
  $('time').textContent = `${remaining.toFixed(1)} s`;
  if (remaining === 0) finishPractice();
  else frame = requestAnimationFrame(tick);
}
$('start').addEventListener('click', () => {
  if (testing) { finishPractice(false); return; }
  hits = clicks = 0; intervals = []; started = lastHit = performance.now(); testing = true;
  testDpi = mouse ? `${mouse.currentDpi}${mouse.demo ? ' (演示)' : ''}` : '未连接';
  $('start').lastChild.textContent = '停止';
  $('arena-state').textContent = `${testDpi} · 点击绿色靶标`;
  updateStats(); controls(); moveTarget(); tick();
});
canvas.addEventListener('pointerdown', event => {
  if (!testing || event.button !== 0) return;
  event.preventDefault();
  if (performance.now() - started >= 20000) { finishPractice(); return; }
  clicks++;
  const rect = canvas.getBoundingClientRect();
  const distance = Math.hypot(event.clientX - rect.left - target.x * rect.width, event.clientY - rect.top - target.y * rect.height);
  if (distance <= 22) { hits++; intervals.push(performance.now() - lastHit); lastHit = performance.now(); moveTarget(); }
  updateStats();
});
$('clear').addEventListener('click', () => { history.length = 0; renderHistory(); });
renderProfiles(); renderDevice();
status(navigator.hid ? '连接鼠标开始；也可以先试用演示模式。板载写入尚待实机验证。' : '当前浏览器不支持 WebHID。请使用桌面 Chrome 或 Edge；可先试用演示模式。');
