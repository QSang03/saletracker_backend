#!/usr/bin/env node
/**
 * Don sach tien trinh backend saletracker_backend con sot (npm run start:dev,
 * nest start --watch, node dist\main). An toan: CHI target process node.exe
 * co "saletracker_backend" trong command line, hoac process node.exe dang giu
 * port 3001. Khong đụng MCP tool, ZCode hay process khac.
 *
 * Cach dung: npm run kill:dev
 *
 * Moi goi lenh deu dung execFileSync voi MANG THAM SO (khong qua shell) de
 * tranh loi escape cua cmd.exe voi | va $().
 */
const { execFileSync } = require('child_process');
const { readFileSync } = require('fs');
const path = require('path');

// Doc PORT tu .env (mac dinh 3001) - kiem tra ca port 3001 lan PORT cau hinh
let portFromEnv = 3001;
try {
  const env = readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const m = env.match(/^PORT\s*=\s*(\d+)/m);
  if (m) portFromEnv = parseInt(m[1], 10);
} catch {}
const PORTS = [...new Set([3001, portFromEnv])];

function ps(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8',
  });
}

const targets = new Map(); // pid -> { pid, cmdline }

// 1) Process node co duong dan saletracker_backend trong command line
try {
  const out = ps(`
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
  "$($_.ProcessId)|$($_.CommandLine)"
}
`);
  for (const line of out.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf('|');
    if (sep < 1) continue;
    const pid = parseInt(trimmed.slice(0, sep), 10);
    const cmdline = trimmed.slice(sep + 1);
    if (Number.isFinite(pid) && /saletracker_backend/i.test(cmdline)) {
      targets.set(pid, { pid, cmdline });
    }
  }
} catch (e) {
  console.error('Khong liet ke duoc process: ' + e.message.split('\n')[0]);
  process.exit(1);
}

// 2) Process dang giu port (3001 + PORT trong .env) - chi kill neu la node.exe
const portRegex = new RegExp(`:(${PORTS.join('|')})\\s`);
try {
  const net = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  for (const line of net.split(/\r?\n/)) {
    if (!portRegex.test(line) || !/LISTENING/i.test(line)) continue;
    const m = line.match(/LISTENING\s+(\d+)\s*$/i);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    if (!Number.isFinite(pid) || targets.has(pid)) continue;
    const name = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], {
      encoding: 'utf8',
    });
    if (/node\.exe/i.test(name)) {
      targets.set(pid, { pid, cmdline: `(dang giu port ${PORTS.join('/')})` });
    } else {
      console.log(
        `Bo qua PID ${pid} (dang giu port nhung khong phai node.exe).`,
      );
    }
  }
} catch {
  // netstat/tasklist loi thi bo qua buoc nay
}

if (targets.size === 0) {
  console.log('OK - khong co tien trinh backend nao dang chay.');
  process.exit(0);
}

for (const { pid, cmdline } of targets.values()) {
  const shown = cmdline && cmdline.length > 120 ? cmdline.slice(0, 120) + '...' : cmdline;
  console.log(`Kill PID ${pid}: ${shown}`);
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore' });
  } catch {
    console.log(`  -> khong kill duoc PID ${pid} (co the da tu thoat).`);
  }
}

// Xac nhan port da roi
let still = false;
try {
  const net = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
  still = PORTS.some((port) =>
    new RegExp(`:${port}\\s.*LISTENING`, 'i').test(net),
  );
} catch {}
console.log(
  still
    ? 'CANH BAO: van con process giu port.'
    : `Da tat ${targets.size} tien trinh. Port ${PORTS.join('/')} trong, chay lai start:dev duoc roi.`,
);
