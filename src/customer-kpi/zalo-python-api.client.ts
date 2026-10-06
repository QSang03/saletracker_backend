import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Client gọi API Python (zalo_entities_api, FastAPI port 5555).
 *
 * Quy tắc kiến trúc: backend NestJS KHÔNG đọc DB Zalo — dữ liệu liên hệ /
 * tài khoản Zalo chỉ lấy qua API này (header x-master-key, cùng MASTER_KEY
 * trong .env hai bên) hoặc do job Python bổ sung thẳng vào main DB.
 */
export interface PythonZaloAccount {
  accountId: number;
  userId: number | null;
  displayName: string | null;
  isActive: boolean;
}

export interface PythonZaloContact {
  accountId: number;
  userId: number | null;
  zaloContactId: string;
  displayName: string | null;
}

@Injectable()
export class ZaloPythonApiClient {
  private readonly baseUrl = (
    process.env.PYTHON_API_URL || 'http://127.0.0.1:5555'
  ).replace(/\/$/, '');
  private readonly masterKey = process.env.MASTER_KEY || '';

  private async getData(path: string): Promise<any[]> {
    if (!this.masterKey) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình MASTER_KEY — không gọi được API Python (zalo_entities_api)',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'x-master-key': this.masterKey },
        signal: AbortSignal.timeout(10000),
      });
    } catch (error: any) {
      throw new ServiceUnavailableException(
        `Không kết nối được API Python (${this.baseUrl}): ${error?.message}`,
      );
    }
    if (!res.ok) {
      throw new ServiceUnavailableException(
        `API Python ${path} trả HTTP ${res.status}`,
      );
    }
    const json: any = await res.json();
    return Array.isArray(json?.data) ? json.data : [];
  }

  /** Tài khoản Zalo theo nhân viên (za.user_id) — tối đa 200 dòng/lần. */
  async getAccounts(limit = 200): Promise<PythonZaloAccount[]> {
    const rows = await this.getData(`/web/accounts?limit=${Math.min(limit, 200)}`);
    return rows.map((r) => ({
      accountId: Number(r.id),
      userId: r.user_id == null ? null : Number(r.user_id),
      displayName: r.display_name ?? null,
      isActive: !!r.is_active,
    }));
  }

  /** Liên hệ theo tài khoản của một nhân viên, tìm theo tên hoặc mã liên hệ. */
  async getContacts(opts: {
    userId?: number;
    search?: string;
    limit?: number;
  }): Promise<PythonZaloContact[]> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(opts.limit ?? 50, 200)));
    if (opts.userId != null) params.set('user_id', String(opts.userId));
    if (opts.search) params.set('search', opts.search);
    const rows = await this.getData(`/web/contacts?${params.toString()}`);
    return rows
      .filter((r) => r.is_active !== 0 && r.is_active !== false)
      .map((r) => ({
        accountId: Number(r.zalo_account_id),
        userId: r.user_id == null ? null : Number(r.user_id),
        zaloContactId: String(r.zalo_contact_id ?? ''),
        displayName: r.display_name ?? null,
      }))
      .filter((r) => r.zaloContactId && r.zaloContactId !== '0');
  }
}
