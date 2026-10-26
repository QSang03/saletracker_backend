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

/**
 * Timeout mỗi request — API Python có endpoint chậm (query contacts quét toàn
 * bảng tin nhắn, đo thực tế 7–20s) nên để dài hơn API NKM mới đủ.
 */
const REQUEST_TIMEOUT_MS = 60000;

@Injectable()
export class ZaloPythonApiClient {
  private readonly baseUrl = (
    process.env.PYTHON_API_URL || 'http://127.0.0.1:5555'
  ).replace(/\/$/, '');
  private readonly masterKey = process.env.MASTER_KEY || '';

  private async getData(
    path: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS,
  ): Promise<any[]> {
    if (!this.masterKey) {
      throw new ServiceUnavailableException(
        'Chưa cấu hình MASTER_KEY — không gọi được API Python (zalo_entities_api)',
      );
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        headers: { 'x-master-key': this.masterKey },
        signal: AbortSignal.timeout(timeoutMs),
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
    const rows = await this.getData(
      `/web/accounts?limit=${Math.min(limit, 200)}`,
    );
    return rows.map((r) => ({
      accountId: Number(r.id),
      userId: r.user_id == null ? null : Number(r.user_id),
      displayName: r.display_name ?? null,
      isActive: !!r.is_active,
    }));
  }

  /**
   * Liên hệ theo tài khoản của một nhân viên, tìm theo tên hoặc mã liên hệ.
   * Python hỗ trợ phân trang (page/limit ≤ 200) — truyền `page` để lấy các
   * trang sau khi tài khoản có nhiều hơn 200 liên hệ.
   */
  async getContacts(opts: {
    userId?: number;
    search?: string;
    limit?: number;
    page?: number;
  }): Promise<PythonZaloContact[]> {
    const params = new URLSearchParams();
    params.set('limit', String(Math.min(opts.limit ?? 50, 200)));
    if (opts.page && opts.page > 1) params.set('page', String(opts.page));
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

  /**
   * Tên hiển thị của nhiều contact theo zalo_contact_id.
   *
   * Dùng endpoint batch `/web/contacts/by-ids` (tối đa 200 id/lần) thay vì
   * gọi search từng contact — search có thể mất 7–20s mỗi lần.
   */
  async getContactNamesByIds(
    zaloContactIds: string[],
    opts?: { timeoutMs?: number },
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(
        zaloContactIds
          .map((id) => String(id).trim())
          .filter((id) => Boolean(id) && id !== '0'),
      ),
    ];
    const names = new Map<string, string>();
    const timeoutMs = opts?.timeoutMs ?? REQUEST_TIMEOUT_MS;

    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const rows = await this.getData(
        `/web/contacts/by-ids?ids=${encodeURIComponent(chunk.join(','))}`,
        timeoutMs,
      );
      for (const row of rows) {
        const contactId = String(row.zalo_contact_id ?? '').trim();
        const displayName = row.display_name;
        if (contactId && displayName && !names.has(contactId)) {
          names.set(contactId, String(displayName));
        }
      }
    }

    return names;
  }
}
