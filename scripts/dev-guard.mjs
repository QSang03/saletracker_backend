/**
 * Chốt an toàn dùng chung cho các script DEV: phát hiện đích là PRODUCTION thì
 * tự dừng (exit 2) trước khi tạo/xoá bất kỳ dữ liệu nào.
 *
 * Ba dấu hiệu bị coi là production:
 *   1. URL đích (BASE_URL, PYTHON_API_URL...) trỏ tới PROD_HOSTS hoặc không
 *      phải máy local.
 *   2. Máy đang chạy script có IP nằm trong PROD_HOSTS (tức đang chạy trên
 *      chính server production).
 *   3. DB trong .env (backend DB_NAME, python DB_NAME/ZALO_DB_NAME) là schema
 *      production (tên kết thúc bằng `_main` hoặc `autozalo_v2_zalo`).
 *
 * Muốn chạy thật trên môi trường không phải dev thì thêm cờ `--force-prod`
 * (script sẽ in cảnh báo rồi chạy tiếp).
 *
 * Thêm host/schema production mới: sửa PROD_HOSTS / PROD_DB_PATTERNS bên dưới.
 */
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

/** IP / hostname của môi trường production. */
export const PROD_HOSTS = ['192.168.117.224'];

/** Schema DB production — script dev không bao giờ được ghi vào. */
export const PROD_DB_PATTERNS = [/(^|_)main$/i, /^autozalo_v2_zalo$/i];

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Đọc 1 key từ file kiểu .env (trả null nếu không có). */
export function readEnvKey(file, key) {
  try {
    if (!existsSync(file)) return null;
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (!line) return null;
    return line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '') || null;
  } catch {
    return null;
  }
}

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Toàn bộ IPv4 của máy đang chạy script. */
export function localIpv4() {
  const out = [];
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list || []) {
        if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
      }
    }
  } catch {
    /* bỏ qua */
  }
  return out;
}

/**
 * @param {object} opts
 * @param {string} opts.baseUrl            URL server mà script sẽ gọi
 * @param {string[]} [opts.extraUrls]      URL khác script/service sẽ gọi
 * @param {{label: string, file: string, keys: string[]}[]} [opts.envFiles]
 * @returns {{dangerous: boolean, reasons: string[], info: string[]}}
 */
export function inspectTarget({ baseUrl, extraUrls = [], envFiles = [] }) {
  const reasons = [];
  const info = [`Server script gọi: ${baseUrl}`];

  const h = hostOf(baseUrl);
  if (h && PROD_HOSTS.includes(h)) {
    reasons.push(`URL đích trỏ IP production (${h})`);
  } else if (h && !LOCAL_HOSTS.includes(h)) {
    reasons.push(`URL đích không phải máy local (${h})`);
  } else if (!h) {
    reasons.push(`URL đích không hợp lệ (${baseUrl})`);
  }

  for (const u of extraUrls) {
    if (!u) continue;
    const hu = hostOf(u);
    if (hu && PROD_HOSTS.includes(hu)) reasons.push(`URL phụ trỏ IP production (${u})`);
  }

  const ips = localIpv4();
  const onProdMachine = ips.filter((ip) => PROD_HOSTS.includes(ip));
  if (onProdMachine.length) {
    reasons.push(`Máy đang chạy script CHÍNH LÀ server production (${onProdMachine.join(', ')})`);
  }

  for (const { label, file, keys } of envFiles) {
    for (const key of keys) {
      const value = readEnvKey(file, key);
      info.push(`${label} ${key}: ${value ?? '(không đọc được)'}`);
      if (value && PROD_DB_PATTERNS.some((re) => re.test(value))) {
        reasons.push(`${label} ${key} = ${value} là DB production`);
      }
    }
  }

  return { dangerous: reasons.length > 0, reasons, info };
}

/**
 * In cảnh báo và DỪNG (exit 2) nếu đích là production và không có `--force-prod`.
 * @returns {boolean} true nếu bị chặn
 */
export function guardOrExit(report, { scriptName, forceFlag = '--force-prod' }) {
  if (!report.dangerous) return false;

  if (process.argv.includes(forceFlag)) {
    console.warn(
      [
        '',
        `⚠️  ${scriptName}: phát hiện dấu hiệu PRODUCTION nhưng có ${forceFlag} nên vẫn chạy:`,
        ...report.reasons.map((r) => `   - ${r}`),
        '',
      ].join('\n'),
    );
    return false;
  }

  console.error(
    [
      '',
      `⛔ DỪNG: ${scriptName} là script DEV — nó TẠO và XOÁ dữ liệu, không được chạy vào production.`,
      ...report.info.map((i) => `   ${i}`),
      '',
      '   Lý do bị chặn:',
      ...report.reasons.map((r) => `   - ${r}`),
      '',
      `   Nếu ĐÍCH THỰC SỰ là môi trường dev, chạy lại kèm cờ:  ${forceFlag}`,
      '   (hoặc truyền BASE_URL trỏ đúng backend dev).',
      '',
    ].join('\n'),
  );
  process.exit(2);
  return true;
}
