import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, Raw, DataSource } from 'typeorm';
import { Debt, DebtStatus } from './debt.entity';
import { DebtConfig, CustomerType } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';
import { Request } from 'express';
import { DebtStatistic } from 'src/debt_statistics/debt_statistic.entity';
import { DebtImportBackup } from './debt_import_backups.entity';

@Injectable()
export class DebtService {
  constructor(
    @InjectRepository(Debt)
    private readonly debtRepository: Repository<Debt>,
    @InjectRepository(DebtConfig)
    private readonly debtConfigRepository: Repository<DebtConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(DebtStatistic)
    private readonly debtStatisticRepo: Repository<DebtStatistic>,
    @InjectRepository(DebtImportBackup)
    private readonly debtImportBackupRepo: Repository<DebtImportBackup>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(query: any = {}, currentUser?: User, page = 1, pageSize = 10) {
    const roleNames = (currentUser?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdminOrManager =
      roleNames.includes('admin') || roleNames.includes('manager-cong-no');
    const qb = this.debtRepository
      .createQueryBuilder('debt')
      .leftJoinAndSelect('debt.sale', 'sale')
      .leftJoinAndSelect('debt.debt_config', 'debt_config')
      .leftJoinAndSelect('debt_config.employee', 'employee');

    // Filter ngày (giữ nguyên logic cũ)
    let filterDate: string | undefined = query.singleDate;
    if (!filterDate && query.date) {
      filterDate = query.date;
    }
    if (!filterDate) {
      const today = new Date();
      filterDate = today.toISOString().slice(0, 10);
    }
    qb.andWhere('DATE(debt.updated_at) = :filterDate', { filterDate });

    // Filter search (áp dụng cho nhiều trường)
    if (query.search) {
      const search = `%${query.search.trim()}%`;
      qb.andWhere(
        '(debt.customer_raw_code LIKE :search OR debt.invoice_code LIKE :search OR debt.bill_code LIKE :search OR debt.sale_name_raw LIKE :search)',
        { search },
      );
    }
    // Filter trạng thái (hỗ trợ truyền nhiều status, giống employeeCodes)
    if (
      query.statuses &&
      typeof query.statuses === 'string' &&
      query.statuses.trim()
    ) {
      // Hỗ trợ truyền vào dạng "paid,pay_later,no_information_available"
      let statuses: string[] = [];
      if (typeof query.statuses === 'string') {
        statuses = query.statuses
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean);
      } else {
        statuses = query.statuses.map((s: string) => s.trim()).filter(Boolean);
      }
      if (statuses.length > 0) {
        qb.andWhere('debt.status IN (:...statuses)', { statuses });
      }
    } else if (query.status) {
      qb.andWhere('debt.status = :status', { status: query.status });
    }
    // Filter mã đối tác
    if (query.customerCode) {
      qb.andWhere('debt.customer_raw_code = :customerCode', {
        customerCode: query.customerCode,
      });
    }
    // Filter kế toán công nợ (employeeCode)
    if (
      query.employeeCodes &&
      typeof query.employeeCodes === 'string' &&
      query.employeeCodes.trim()
    ) {
      // Hỗ trợ truyền vào dạng "NKTO01-TRẦN THỊ THÙY QUYÊN,NKTO05-TRẦN THỊ NGỌC HÂN"
      let employeeCodes: string[] = [];
      if (typeof query.employeeCodes === 'string') {
        employeeCodes = query.employeeCodes
          .split(',')
          .map((s: string) => s.split('-')[0].trim())
          .filter(Boolean);
      } else {
        employeeCodes = query.employeeCodes
          .map((s: string) => s.split('-')[0].trim())
          .filter(Boolean);
      }
      
      if (employeeCodes.length > 0) {
        qb.andWhere(
          `TRIM(SUBSTRING(debt.employee_code_raw, LOCATE('-', debt.employee_code_raw) + 1)) IN (:...employeeCodes)`,
          { employeeCodes },
        );
      }
    }
    // Filter NVKD (saleCode)
    if (query.saleCode) {
      qb.andWhere('debt.sale_name_raw LIKE :saleCode', {
        saleCode: `%${query.saleCode}%`,
      });
    }
    // Filter ngày công nợ (nếu có)
    if (query.debtDate) {
      qb.andWhere('DATE(debt.issue_date) = :debtDate', {
        debtDate: query.debtDate,
      });
    }
    // Filter nhiều trường khác nếu cần (mở rộng)

    if (!isAdminOrManager) {
      qb.andWhere(
        `(
          TRIM(LEFT(debt.employee_code_raw, CASE WHEN LOCATE('-', debt.employee_code_raw) > 0 THEN LOCATE('-', debt.employee_code_raw) - 1 ELSE CHAR_LENGTH(debt.employee_code_raw) END)) = :empCode
          OR debt_config.employee = :userId
        )`,
        {
          empCode: currentUser?.employeeCode,
          userId: currentUser?.id,
        },
      );
    }
    // Pagination
    const total = await qb.getCount();
    qb.skip((page - 1) * pageSize).take(pageSize);
    const data = await qb.getMany();
    return { data, total, page, pageSize };
  }

  findOne(id: number) {
    return this.debtRepository.findOneBy({ id });
  }

  create(data: Partial<Debt>) {
    return this.debtRepository.save(data);
  }

  update(id: number, data: Partial<Debt>) {
    return this.debtRepository.update(id, data);
  }

  remove(id: number) {
    return this.debtRepository.softDelete(id);
  }

  private generateImportSessionId(): string {
    const now = new Date();
    const day = now.getDate().toString().padStart(2, '0');
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const year = now.getFullYear();
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');

    return `import_${day}_${month}_${year}_${hour}${minute}${second}`;
  }

  // Hàm import cũ để backup
  async importExcelRowsOld(rows: any[]) {
    type ImportResult = { row: number; error?: string; success?: boolean };
    const errors: ImportResult[] = [];
    const imported: ImportResult[] = [];

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        imported,
        errors: [{ row: 0, error: 'Không có dữ liệu để import' }],
      };
    }

    const excelInvoiceCodes = rows
      .map((row) => row['Số chứng từ'])
      .filter(Boolean);

    const existingDebts =
      excelInvoiceCodes.length > 0
        ? await this.debtRepository.find({
            where: { invoice_code: In(excelInvoiceCodes) },
          })
        : [];

    const existingDebtsMap = new Map(
      existingDebts.map((d) => [d.invoice_code, d]),
    );

    // Lấy các phiếu không có trong Excel để cập nhật thành 'paid'
    // CHỈ lấy các phiếu chưa PAID
    const debtsNotInExcel =
      excelInvoiceCodes.length > 0
        ? await this.debtRepository.find({
            where: {
              invoice_code: Not(In(excelInvoiceCodes)),
              status: Not(DebtStatus.PAID), // Chỉ lấy các phiếu chưa paid
            },
          })
        : [];

    // Lưu lại updated_at cũ của các phiếu sẽ được cập nhật thành paid
    const updatedAtMap = new Map<number, Date>();
    for (const debt of debtsNotInExcel) {
      updatedAtMap.set(debt.id, debt.updated_at);
    }

    // Cập nhật status = 'paid' cho các phiếu không có trong Excel
    for (const debt of debtsNotInExcel) {
      const oldUpdatedAt = updatedAtMap.get(debt.id);
      if (oldUpdatedAt) {
        // Cập nhật status = paid
        await this.debtRepository.update(debt.id, { status: DebtStatus.PAID });

        // Khôi phục lại updated_at cũ
        await this.debtRepository.update(debt.id, { updated_at: oldUpdatedAt });

        // Cập nhật trạng thái paid cho debt_statistics snapshot đúng ngày updated_at cũ
        await this.debtStatisticRepo
          .createQueryBuilder()
          .update()
          .set({ status: DebtStatus.PAID })
          .where('original_debt_id = :id', { id: debt.id })
          .andWhere('DATE(statistic_date) = :date', {
            date: oldUpdatedAt.toISOString().slice(0, 10),
          })
          .execute();
      }
    }

    // Map customer_code -> pay_later (Date) từ DB
    const customerCodes = rows.map((row) => row['Mã đối tác']).filter(Boolean);
    const payLaterMap = new Map<string, Date>();

    if (customerCodes.length > 0) {
      const debtsWithPayLater = await this.debtRepository.find({
        where: { customer_raw_code: In(customerCodes) },
        select: ['customer_raw_code', 'pay_later'],
      });

      for (const d of debtsWithPayLater) {
        if (d.customer_raw_code && d.pay_later) {
          // Lấy ngày gần nhất nếu có nhiều phiếu cùng mã
          const old = payLaterMap.get(d.customer_raw_code);
          if (!old || d.pay_later > old) {
            payLaterMap.set(d.customer_raw_code, d.pay_later);
          }
        }
      }
    }

    // Refactor xử lý batch song song
    const updatePromises: Promise<any>[] = [];
    const insertPromises: Promise<any>[] = [];
    const importedResults: ImportResult[] = [];
    const errorResults: ImportResult[] = [];

    // Truy vấn debtConfig và user cho tất cả dòng trước
    const customerCodesSet = new Set(
      rows.map((r) => r['Mã đối tác']).filter(Boolean),
    );
    const debtConfigs = await this.debtConfigRepository.find({
      where: { customer_code: In([...customerCodesSet]) },
    });
    const debtConfigMap = new Map(
      debtConfigs.map((dc) => [dc.customer_code, dc]),
    );

    // Truy vấn tất cả employeeCode và saleCode trước
    const empCodesSet = new Set(
      rows
        .map((r) => String(r['Kế toán công nợ']).split('-')[0].trim())
        .filter(Boolean),
    );
    const saleCodesSet = new Set(
      rows
        .map((r) => (r['NVKD'] ? r['NVKD'].split('-')[0] : ''))
        .filter(Boolean),
    );
    const users = await this.userRepository.find({
      where: { employeeCode: In([...empCodesSet, ...saleCodesSet]) },
    });
    const userMap = new Map(users.map((u) => [u.employeeCode, u]));

    // Xử lý từng dòng, gom batch
    rows.forEach((row, i) => {
      const keys = Object.keys(row).filter((k) => k !== 'Còn lại');
      const onlyHasConLai = keys.every((k) => {
        const value = row[k];
        return (
          value === null ||
          value === undefined ||
          value === '' ||
          (typeof value === 'string' && value.trim() === '')
        );
      });
      if (onlyHasConLai && row['Còn lại']) return;

      const required = [
        'Mã đối tác',
        'Số chứng từ',
        'Ngày chứng từ',
        'Ngày đến hạn',
        'Thành tiền chứng từ',
        'Còn lại',
        'NVKD',
        'Kế toán công nợ',
      ];
      const missing = required.filter((k) => !row[k]);
      if (missing.length) {
        errorResults.push({
          row: i + 2,
          error: `Thiếu trường: ${missing.join(', ')}`,
        });
        return;
      }

      const debtConfig = debtConfigMap.get(row['Mã đối tác']);
      let sale_id: number | undefined = undefined;
      let sale_name_raw: string = '';

      if (debtConfig && row['Kế toán công nợ']) {
        const empCode = String(row['Kế toán công nợ']).split('-')[0].trim();
        const user = userMap.get(empCode);
        if (
          user &&
          (!debtConfig.employee || user.id !== debtConfig.employee.id)
        ) {
          debtConfig.employee = user;
          updatePromises.push(this.debtConfigRepository.save(debtConfig));
        }
      }

      if (row['NVKD']) {
        const code = row['NVKD'].split('-')[0];
        const user = userMap.get(code);
        if (user && user.employeeCode && user.employeeCode.startsWith(code)) {
          sale_id = user.id;
        } else {
          sale_name_raw = row['NVKD'] || '';
        }
      }

      const employee_code_raw: string = row['Kế toán công nợ'] || '';
      const invoice_code = row['Số chứng từ'];
      const oldDebt = existingDebtsMap.get(invoice_code);

      if (oldDebt && oldDebt.status === DebtStatus.PAID) {
        errorResults.push({
          row: i + 2,
          error: `Phiếu ${invoice_code} đã được thanh toán, không thể cập nhật`,
        });
        return;
      }

      const parseDate = (val: any): Date | null => {
        const str = this.parseExcelDate(val);
        return str ? new Date(str) : null;
      };

      let pay_later: Date | undefined = undefined;
      if (oldDebt) {
        pay_later =
          oldDebt.pay_later || payLaterMap.get(row['Mã đối tác']) || undefined;
      } else {
        pay_later = payLaterMap.get(row['Mã đối tác']) || undefined;
      }

      try {
        if (oldDebt) {
          oldDebt.customer_raw_code = row['Mã đối tác'] || '';
          oldDebt.invoice_code = invoice_code;
          oldDebt.issue_date =
            parseDate(row['Ngày chứng từ']) || oldDebt.issue_date;
          oldDebt.bill_code = row['Số hóa đơn'] || '';
          oldDebt.due_date = parseDate(row['Ngày đến hạn']) || oldDebt.due_date;
          oldDebt.total_amount = row['Thành tiền chứng từ'] || 0;
          oldDebt.remaining = row['Còn lại'] || 0;
          oldDebt.sale = sale_id ? ({ id: sale_id } as any) : undefined;
          oldDebt.sale_name_raw = sale_name_raw;
          oldDebt.employee_code_raw = employee_code_raw;
          oldDebt.debt_config = debtConfig
            ? ({ id: debtConfig.id } as any)
            : undefined;
          oldDebt.updated_at = new Date();
          oldDebt.pay_later = pay_later ?? null;
          updatePromises.push(
            this.debtRepository
              .save(oldDebt)
              .then(() => importedResults.push({ row: i + 2, success: true }))
              .catch((err) =>
                errorResults.push({
                  row: i + 2,
                  error: err?.message || 'Unknown error',
                }),
              ),
          );
        } else {
          const debt = this.debtRepository.create({
            customer_raw_code: row['Mã đối tác'] || '',
            invoice_code: invoice_code,
            issue_date: parseDate(row['Ngày chứng từ']) || new Date(),
            bill_code: row['Số hóa đơn'] || '',
            due_date: parseDate(row['Ngày đến hạn']) || new Date(),
            total_amount: row['Thành tiền chứng từ'] || 0,
            remaining: row['Còn lại'] || 0,
            sale: sale_id ? ({ id: sale_id } as any) : undefined,
            sale_name_raw,
            employee_code_raw,
            debt_config: debtConfig
              ? ({ id: debtConfig.id } as any)
              : undefined,
            created_at: new Date(),
            updated_at: new Date(),
            pay_later: pay_later ?? null,
          });
          insertPromises.push(
            this.debtRepository
              .save(debt)
              .then(() => importedResults.push({ row: i + 2, success: true }))
              .catch((err) =>
                errorResults.push({
                  row: i + 2,
                  error: err?.message || 'Unknown error',
                }),
              ),
          );
        }
      } catch (err) {
        errorResults.push({
          row: i + 2,
          error: err?.message || 'Unknown error',
        });
      }
    });

    // Chờ tất cả update/insert xong
    await Promise.all([...updatePromises, ...insertPromises]);
    return { imported: importedResults, errors: errorResults };
  }

  // Hàm import mới với backup logic
  async importExcelRows(rows: any[]) {
    type ImportResult = { row: number; error?: string; success?: boolean };
    const errors: ImportResult[] = [];
    const imported: ImportResult[] = [];

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        imported,
        errors: [{ row: 0, error: 'Không có dữ liệu để import' }],
        import_session_id: null,
      };
    }

    // Tạo import session ID
    const import_session_id = this.generateImportSessionId();

    // Sử dụng transaction để đảm bảo an toàn dữ liệu
    return await this.dataSource.transaction(async (manager) => {
      const debtRepo = manager.getRepository(Debt);
      const debtStatisticRepo = manager.getRepository(DebtStatistic);
      const debtConfigRepo = manager.getRepository(DebtConfig);
      const userRepo = manager.getRepository(User);
      const backupRepo = manager.getRepository(DebtImportBackup);

      const excelInvoiceCodes = rows
        .map((row) => row['Số chứng từ'])
        .filter(Boolean);

      const existingDebts =
        excelInvoiceCodes.length > 0
          ? await debtRepo.find({
              where: { invoice_code: In(excelInvoiceCodes) },
            })
          : [];

      const existingDebtsMap = new Map(
        existingDebts.map((d) => [d.invoice_code, d]),
      );

      // Lấy các phiếu không có trong Excel để cập nhật thành 'paid'
      const debtsNotInExcel =
        excelInvoiceCodes.length > 0
          ? await debtRepo.find({
              where: {
                invoice_code: Not(In(excelInvoiceCodes)),
                status: Not(DebtStatus.PAID),
              },
            })
          : [];

      // Backup các phiếu sẽ được đánh dấu PAID trước khi thay đổi
      for (const debt of debtsNotInExcel) {
        await backupRepo.save({
          import_session_id,
          original_debt_id: debt.id,
          original_data: {
            status: debt.status,
            updated_at: debt.updated_at,
            pay_later: debt.pay_later,
            remaining: debt.remaining,
            total_amount: debt.total_amount,
            customer_raw_code: debt.customer_raw_code,
            invoice_code: debt.invoice_code,
            bill_code: debt.bill_code,
            issue_date: debt.issue_date,
            due_date: debt.due_date,
            sale: debt.sale,
            sale_name_raw: debt.sale_name_raw,
            employee_code_raw: debt.employee_code_raw,
            note: debt.note,
            debt_config: debt.debt_config,
          },
          action_type: 'MARK_PAID',
        });
      }

      // Lưu lại updated_at cũ của các phiếu sẽ được cập nhật thành paid
      const updatedAtMap = new Map<number, Date>();
      for (const debt of debtsNotInExcel) {
        updatedAtMap.set(debt.id, debt.updated_at);
      }

      // Cập nhật status = 'paid' cho các phiếu không có trong Excel
      for (const debt of debtsNotInExcel) {
        const oldUpdatedAt = updatedAtMap.get(debt.id);
        if (oldUpdatedAt) {
          await debtRepo.update(debt.id, { status: DebtStatus.PAID });
          await debtRepo.update(debt.id, { updated_at: oldUpdatedAt });

          await debtStatisticRepo
            .createQueryBuilder()
            .update()
            .set({ status: DebtStatus.PAID })
            .where('original_debt_id = :id', { id: debt.id })
            .andWhere('DATE(statistic_date) = :date', {
              date: oldUpdatedAt.toISOString().slice(0, 10),
            })
            .execute();
        }
      }

      // Map customer_code -> pay_later từ DB
      const customerCodes = rows
        .map((row) => row['Mã đối tác'])
        .filter(Boolean);
      const payLaterMap = new Map<string, Date>();

      if (customerCodes.length > 0) {
        const debtsWithPayLater = await debtRepo.find({
          where: { customer_raw_code: In(customerCodes) },
          select: ['customer_raw_code', 'pay_later'],
        });

        for (const d of debtsWithPayLater) {
          if (d.customer_raw_code && d.pay_later) {
            const old = payLaterMap.get(d.customer_raw_code);
            if (!old || d.pay_later > old) {
              payLaterMap.set(d.customer_raw_code, d.pay_later);
            }
          }
        }
      }

      // Batch processing
      const updatePromises: Promise<any>[] = [];
      const insertPromises: Promise<any>[] = [];
      const importedResults: ImportResult[] = [];
      const errorResults: ImportResult[] = [];

      // Truy vấn debtConfig và user cho tất cả dòng trước
      const customerCodesSet = new Set(
        rows.map((r) => r['Mã đối tác']).filter(Boolean),
      );
      const debtConfigs = await debtConfigRepo.find({
        where: { customer_code: In([...customerCodesSet]) },
      });
      const debtConfigMap = new Map(
        debtConfigs.map((dc) => [dc.customer_code, dc]),
      );

      const empCodesSet = new Set(
        rows
          .map((r) => String(r['Kế toán công nợ']).split('-')[0].trim())
          .filter(Boolean),
      );
      const saleCodesSet = new Set(
        rows
          .map((r) => (r['NVKD'] ? r['NVKD'].split('-')[0] : ''))
          .filter(Boolean),
      );
      const users = await userRepo.find({
        where: { employeeCode: In([...empCodesSet, ...saleCodesSet]) },
      });
      const userMap = new Map(users.map((u) => [u.employeeCode, u]));

      // Xử lý từng dòng
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Kiểm tra dòng trống
        const keys = Object.keys(row).filter((k) => k !== 'Còn lại');
        const onlyHasConLai = keys.every((k) => {
          const value = row[k];
          return (
            value === null ||
            value === undefined ||
            value === '' ||
            (typeof value === 'string' && value.trim() === '')
          );
        });
        if (onlyHasConLai && row['Còn lại']) continue;

        // Kiểm tra trường bắt buộc
        const required = [
          'Mã đối tác',
          'Số chứng từ',
          'Ngày chứng từ',
          'Ngày đến hạn',
          'Thành tiền chứng từ',
          'Còn lại',
          'NVKD',
          'Kế toán công nợ',
        ];
        const missing = required.filter((k) => !row[k]);
        if (missing.length) {
          errorResults.push({
            row: i + 2,
            error: `Thiếu trường: ${missing.join(', ')}`,
          });
          continue;
        }

        const debtConfig = debtConfigMap.get(row['Mã đối tác']);
        let sale_id: number | undefined = undefined;
        let sale_name_raw: string = '';

        // Cập nhật debtConfig employee nếu cần
        if (debtConfig && row['Kế toán công nợ']) {
          const empCode = String(row['Kế toán công nợ']).split('-')[0].trim();
          const user = userMap.get(empCode);
          if (
            user &&
            (!debtConfig.employee || user.id !== debtConfig.employee.id)
          ) {
            debtConfig.employee = user;
            updatePromises.push(debtConfigRepo.save(debtConfig));
          }
        }

        // Xử lý NVKD
        if (row['NVKD']) {
          const code = row['NVKD'].split('-')[0];
          const user = userMap.get(code);
          if (user && user.employeeCode && user.employeeCode.startsWith(code)) {
            sale_id = user.id;
          } else {
            sale_name_raw = row['NVKD'] || '';
          }
        }

        const employee_code_raw: string = row['Kế toán công nợ'] || '';
        const invoice_code = row['Số chứng từ'];
        const oldDebt = existingDebtsMap.get(invoice_code);

        // Kiểm tra phiếu đã thanh toán
        if (oldDebt && oldDebt.status === DebtStatus.PAID) {
          errorResults.push({
            row: i + 2,
            error: `Phiếu ${invoice_code} đã được thanh toán, không thể cập nhật`,
          });
          continue;
        }

        const parseDate = (val: any): Date | null => {
          const str = this.parseExcelDate(val);
          return str ? new Date(str) : null;
        };

        let pay_later: Date | undefined = undefined;
        if (oldDebt) {
          pay_later =
            oldDebt.pay_later ||
            payLaterMap.get(row['Mã đối tác']) ||
            undefined;
        } else {
          pay_later = payLaterMap.get(row['Mã đối tác']) || undefined;
        }

        try {
          if (oldDebt) {
            // Backup trước khi update
            await backupRepo.save({
              import_session_id,
              original_debt_id: oldDebt.id,
              original_data: {
                customer_raw_code: oldDebt.customer_raw_code,
                invoice_code: oldDebt.invoice_code,
                bill_code: oldDebt.bill_code,
                issue_date: oldDebt.issue_date,
                due_date: oldDebt.due_date,
                total_amount: oldDebt.total_amount,
                remaining: oldDebt.remaining,
                status: oldDebt.status,
                updated_at: oldDebt.updated_at,
                pay_later: oldDebt.pay_later,
                sale: oldDebt.sale,
                sale_name_raw: oldDebt.sale_name_raw,
                employee_code_raw: oldDebt.employee_code_raw,
                note: oldDebt.note,
                debt_config: oldDebt.debt_config,
              },
              action_type: 'UPDATE',
            });

            // Update debt
            oldDebt.customer_raw_code = row['Mã đối tác'] || '';
            oldDebt.invoice_code = invoice_code;
            oldDebt.issue_date =
              parseDate(row['Ngày chứng từ']) || oldDebt.issue_date;
            oldDebt.bill_code = row['Số hóa đơn'] || '';
            oldDebt.due_date =
              parseDate(row['Ngày đến hạn']) || oldDebt.due_date;
            oldDebt.total_amount = row['Thành tiền chứng từ'] || 0;
            oldDebt.remaining = row['Còn lại'] || 0;
            oldDebt.sale = sale_id ? ({ id: sale_id } as any) : undefined;
            oldDebt.sale_name_raw = sale_name_raw;
            oldDebt.employee_code_raw = employee_code_raw;
            oldDebt.debt_config = debtConfig
              ? ({ id: debtConfig.id } as any)
              : undefined;
            oldDebt.updated_at = new Date();
            oldDebt.pay_later = pay_later ?? null;

            updatePromises.push(
              debtRepo
                .save(oldDebt)
                .then(() => importedResults.push({ row: i + 2, success: true }))
                .catch((err) =>
                  errorResults.push({
                    row: i + 2,
                    error: err?.message || 'Unknown error',
                  }),
                ),
            );
          } else {
            const debt = debtRepo.create({
              customer_raw_code: row['Mã đối tác'] || '',
              invoice_code: invoice_code,
              issue_date: parseDate(row['Ngày chứng từ']) || new Date(),
              bill_code: row['Số hóa đơn'] || '',
              due_date: parseDate(row['Ngày đến hạn']) || new Date(),
              total_amount: row['Thành tiền chứng từ'] || 0,
              remaining: row['Còn lại'] || 0,
              sale: sale_id ? ({ id: sale_id } as any) : undefined,
              sale_name_raw,
              employee_code_raw,
              debt_config: debtConfig
                ? ({ id: debtConfig.id } as any)
                : undefined,
              created_at: new Date(),
              updated_at: new Date(),
              pay_later: pay_later ?? null,
            });

            insertPromises.push(
              debtRepo
                .save(debt)
                .then((savedDebt) => {
                  // Backup sau khi create
                  return backupRepo
                    .save({
                      import_session_id,
                      original_debt_id: savedDebt.id,
                      original_data: null, // Không có data gốc vì là tạo mới
                      action_type: 'CREATE',
                    })
                    .then(() => {
                      importedResults.push({ row: i + 2, success: true });
                    });
                })
                .catch((err) =>
                  errorResults.push({
                    row: i + 2,
                    error: err?.message || 'Unknown error',
                  }),
                ),
            );
          }
        } catch (err) {
          errorResults.push({
            row: i + 2,
            error: err?.message || 'Unknown error',
          });
        }
      }

      // Chờ tất cả update/insert xong
      await Promise.all([...updatePromises, ...insertPromises]);

      return {
        imported: importedResults,
        errors: errorResults,
        import_session_id,
      };
    });
  }

  private parseExcelDate(value: any): string | null {
    if (!value) return null;

    // Nếu là số (Excel date serial number)
    if (typeof value === 'number') {
      // Excel date serial number (ngày 1 = 1/1/1900, nhưng Excel có bug nên dùng 1899/12/30)
      const excelEpoch = new Date(1899, 11, 30); // 30/12/1899
      const jsDate = new Date(
        excelEpoch.getTime() + value * 24 * 60 * 60 * 1000,
      );

      const yyyy = jsDate.getFullYear();
      const mm = String(jsDate.getMonth() + 1).padStart(2, '0');
      const dd = String(jsDate.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    // Nếu là string
    if (typeof value === 'string') {
      value = value.trim();
      if (!value) return null;

      // Thử parse các format phổ biến (dd/mm/yyyy format từ Excel VN)
      const formats = [
        {
          regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
          parse: (match: RegExpMatchArray) => {
            // Format dd/mm/yyyy (Vietnam format)
            const [, day, month, year] = match;
            return {
              day: parseInt(day),
              month: parseInt(month),
              year: parseInt(year),
            };
          },
        },
        {
          regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
          parse: (match: RegExpMatchArray) => {
            // Format yyyy-mm-dd
            const [, year, month, day] = match;
            return {
              day: parseInt(day),
              month: parseInt(month),
              year: parseInt(year),
            };
          },
        },
        {
          regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
          parse: (match: RegExpMatchArray) => {
            // Format dd-mm-yyyy
            const [, day, month, year] = match;
            return {
              day: parseInt(day),
              month: parseInt(month),
              year: parseInt(year),
            };
          },
        },
        {
          regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
          parse: (match: RegExpMatchArray) => {
            // Format dd.mm.yyyy
            const [, day, month, year] = match;
            return {
              day: parseInt(day),
              month: parseInt(month),
              year: parseInt(year),
            };
          },
        },
      ];

      for (const format of formats) {
        const match = value.match(format.regex);
        if (match) {
          const { day, month, year } = format.parse(match);

          // Kiểm tra tháng và ngày hợp lệ
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const parsedDate = new Date(year, month - 1, day);

            // Kiểm tra ngày được tạo có đúng với input không
            if (
              parsedDate.getFullYear() === year &&
              parsedDate.getMonth() === month - 1 &&
              parsedDate.getDate() === day
            ) {
              const yyyy = parsedDate.getFullYear();
              const mm = String(parsedDate.getMonth() + 1).padStart(2, '0');
              const dd = String(parsedDate.getDate()).padStart(2, '0');
              return `${yyyy}-${mm}-${dd}`;
            }
          }
        }
      }
    }

    // Nếu là Date object
    if (value instanceof Date && !isNaN(value.getTime())) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, '0');
      const dd = String(value.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }

    if (typeof value === 'object' && value.result) {
      // Nếu result là string hoặc Date
      if (typeof value.result === 'string') {
        // Nếu là ISO string
        const parsed = new Date(value.result);
        if (!isNaN(parsed.getTime())) {
          const yyyy = parsed.getFullYear();
          const mm = String(parsed.getMonth() + 1).padStart(2, '0');
          const dd = String(parsed.getDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        }
      }
      // Nếu result là Date object
      if (value.result instanceof Date && !isNaN(value.result.getTime())) {
        const yyyy = value.result.getFullYear();
        const mm = String(value.result.getMonth() + 1).padStart(2, '0');
        const dd = String(value.result.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    }

    // Thử parse trực tiếp
    try {
      const parsed = new Date(value);
      if (!isNaN(parsed.getTime())) {
        const yyyy = parsed.getFullYear();
        const mm = String(parsed.getMonth() + 1).padStart(2, '0');
        const dd = String(parsed.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    } catch (e) {
      // Ignore
    }

    return null;
  }

  async getUniqueCustomerList(currentUser?: User) {
    const roleNames = (currentUser?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdminOrManager =
      roleNames.includes('admin') || roleNames.includes('manager-cong-no');

    // 1. Lấy các debt config hợp lệ theo quyền
    const configs = await this.debtConfigRepository.find({
      select: ['customer_code', 'customer_name', 'employee', 'customer_type'],
    });
    const configMap = new Map<string, string>();
    for (const c of configs) {
      if (c.customer_type === 'fixed') continue;

      if (isAdminOrManager) {
        configMap.set(c.customer_code, c.customer_name);
      } else if (
        c.employee &&
        currentUser &&
        c.employee.id === currentUser.id
      ) {
        configMap.set(c.customer_code, c.customer_name);
      }
      // Dòng không hợp lệ quyền, bỏ qua
    }

    // 2. Lấy tất cả customer_raw_code (đã lọc theo quyền ở SQL)
    let rawDebtsQuery = this.debtRepository
      .createQueryBuilder('debt')
      .select(['debt.customer_raw_code']);

    if (!isAdminOrManager) {
      rawDebtsQuery = rawDebtsQuery.where(
        `TRIM(LEFT(debt.employee_code_raw, CASE WHEN LOCATE('-', debt.employee_code_raw) > 0 THEN LOCATE('-', debt.employee_code_raw) - 1 ELSE CHAR_LENGTH(debt.employee_code_raw) END)) = :empCode`,
        { empCode: currentUser?.employeeCode },
      );
    }
    const rawDebts = await rawDebtsQuery
      .groupBy('debt.customer_raw_code')
      .getRawMany();

    // 3. Gộp kết quả duy nhất: ưu tiên tên từ configMap nếu có
    const result: { code: string; name: string }[] = [];
    const seen = new Set();

    // Lấy hết mã từ configMap (theo quyền)
    for (const [code, name] of configMap.entries()) {
      if (!seen.has(code)) {
        result.push({ code, name });
        seen.add(code);
      }
    }

    // Lấy thêm mã mới từ bảng debt chưa có trong configMap
    for (const d of rawDebts) {
      const code = d.debt_customer_raw_code;
      if (code && !seen.has(code)) {
        result.push({ code, name: code });
        seen.add(code);
      }
    }
    return result;
  }

  async getUniqueEmployeeList(currentUser?: User) {
    const roleNames = (currentUser?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdminOrManager =
      roleNames.includes('admin') || roleNames.includes('manager-cong-no');

    // Lấy employee_code_raw từ bảng debt
    let employeeQuery = this.debtRepository
      .createQueryBuilder('debt')
      .select(['debt.employee_code_raw'])
      .where('debt.employee_code_raw IS NOT NULL')
      .andWhere('debt.employee_code_raw != ""');

    if (!isAdminOrManager) {
      employeeQuery = employeeQuery.andWhere(
        `TRIM(LEFT(debt.employee_code_raw, CASE WHEN LOCATE('-', debt.employee_code_raw) > 0 THEN LOCATE('-', debt.employee_code_raw) - 1 ELSE CHAR_LENGTH(debt.employee_code_raw) END)) = :empCode`,
        { empCode: currentUser?.employeeCode },
      );
    }

    const employees = await employeeQuery
      .groupBy('debt.employee_code_raw')
      .getRawMany();

    // Tách mã nhân viên phía trước dấu "-", gom unique code
    const codeSet = new Set<string>();
    const rawToOnlyCode = new Map<string, string>(); // mapping raw => onlyCode
    for (const emp of employees) {
      const raw = emp.debt_employee_code_raw;
      if (!raw) continue;
      // lấy phần trước dấu "-"
      const onlyCode = raw.split('-')[0].trim();
      rawToOnlyCode.set(raw, onlyCode);
      codeSet.add(onlyCode);
    }

    // Lấy danh sách user có employeeCode nằm trong codeSet
    const userList = await this.userRepository.find({
      where: { employeeCode: In([...codeSet]) },
    });
    const codeToFullName = new Map<string, string>();
    for (const user of userList) {
      if (user.employeeCode) {
        codeToFullName.set(user.employeeCode.trim(), user.fullName || '');
      }
    }

    // Tạo danh sách kết quả cuối cùng
    const result: { code: string; name: string }[] = [];
    const seen = new Set();
    for (const emp of employees) {
      const raw = emp.debt_employee_code_raw;
      if (!raw || seen.has(raw)) continue;

      const onlyCode = rawToOnlyCode.get(raw) || '';
      const fullName = codeToFullName.get(onlyCode);
      result.push({
        code: raw,
        name: fullName || raw, // fallback nếu user không có
      });
      seen.add(raw);
    }

    // Sắp xếp theo tên
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  async updatePayLaterForCustomers(customerCodes: string[], payDate: Date) {
    if (!Array.isArray(customerCodes) || !payDate) return 0;
    // Lấy danh sách customer_code fixed
    const fixedConfigs = await this.debtConfigRepository.find({
      where: {
        customer_code: In(customerCodes),
        customer_type: CustomerType.FIXED,
      },
      select: ['customer_code'],
    });
    const fixedCodes = new Set(fixedConfigs.map((c) => c.customer_code));
    // Lọc bỏ các mã thuộc fixed
    const validCodes = customerCodes.filter((code) => !fixedCodes.has(code));
    if (!validCodes.length) return 0;
    // Lấy danh sách các phiếu sẽ bị cập nhật và lưu lại updated_at cũ
    const debts = await this.debtRepository.find({
      where: { customer_raw_code: In(validCodes) },
      select: ['id', 'updated_at', 'status'],
    });
    const updatedAtMap = new Map<number, Date>();
    debts.forEach((d) => updatedAtMap.set(d.id, d.updated_at));
    // Chỉ cập nhật các phiếu chưa paid
    const toUpdate = debts.filter((d) => d.status !== 'paid');
    if (toUpdate.length === 0) return 0;
    // Cập nhật pay_later và status = 'pay_later'
    await Promise.all(
      toUpdate.map((d) =>
        this.debtRepository.update(d.id, {
          pay_later: payDate,
          status: 'pay_later' as any,
        }),
      ),
    );
    // Khôi phục lại updated_at cũ cho các phiếu vừa cập nhật
    for (const d of toUpdate) {
      await this.debtRepository.update(d.id, { updated_at: d.updated_at });
    }
    return toUpdate.length;
  }

  async updateNoteAndStatusKeepUpdatedAt(
    id: number,
    data: { note?: string; status?: string },
  ) {
    if (!id || (!data.note && !data.status)) {
      throw new BadRequestException('Thiếu dữ liệu cập nhật');
    }
    // Lấy updated_at cũ
    const debt = await this.findOne(Number(id));
    if (!debt) throw new BadRequestException('Không tìm thấy công nợ');
    const updateData: any = {};
    if (data.note !== undefined) updateData.note = data.note;
    if (data.status !== undefined) updateData.status = data.status;
    await this.update(id, updateData);
    // Khôi phục updated_at cũ
    await this.update(id, { updated_at: debt.updated_at });
    return { success: true };
  }

  async deleteAllTodayDebts(): Promise<number> {
    // Sử dụng timezone Việt Nam (UTC+7)
    const now = new Date();
    const vietnamTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = vietnamTime.toISOString().split('T')[0]; // Format: YYYY-MM-DD

    // Tìm tất cả phiếu có updated_at = ngày hôm nay
    const debtsToDelete = await this.debtRepository.find({
      where: {
        updated_at: Raw((alias) => `DATE(${alias}) = :today`, {
          today: todayStr,
        }),
      },
    });

    if (debtsToDelete.length === 0) {
      return 0;
    }

    // Xóa mềm tất cả phiếu
    const ids = debtsToDelete.map((debt) => debt.id);
    await this.debtRepository.softDelete(ids);

    return debtsToDelete.length;
  }

  // STATISTICS METHODS

  async getStatsOverview(query: any = {}, currentUser?: User) {
    const { data: debts } = await this.findAll(query, currentUser, 1, 1000000);

    const total = debts.length;
    const paid = debts.filter((d) => d.status === 'paid').length;
    const payLater = debts.filter((d) => d.status === 'pay_later').length;
    const noInfo = debts.filter(
      (d) => d.status === 'no_information_available',
    ).length;

    const totalAmount = debts.reduce(
      (sum, d) => sum + (Number(d.total_amount) || 0),
      0,
    );
    const remainingAmount = debts.reduce(
      (sum, d) => sum + (Number(d.remaining) || 0),
      0,
    );
    const collectedAmount = totalAmount - remainingAmount;

    const collectionRate =
      totalAmount > 0 ? (collectedAmount / totalAmount) * 100 : 0;

    return {
      total,
      paid,
      payLater,
      noInfo,
      totalAmount,
      remainingAmount,
      collectedAmount,
      collectionRate: Math.round(collectionRate * 100) / 100,
      avgDebtAmount: total > 0 ? Math.round(totalAmount / total) : 0,
    };
  }

  async getAgingAnalysis(query: any = {}, currentUser?: User) {
    const { data: debts } = await this.findAll(query, currentUser, 1, 1000000);
    const today = new Date();

    const aging = {
      current: { count: 0, amount: 0, label: '0-30 ngày' },
      days30: { count: 0, amount: 0, label: '31-60 ngày' },
      days60: { count: 0, amount: 0, label: '61-90 ngày' },
      days90: { count: 0, amount: 0, label: '>90 ngày' },
    };

    debts.forEach((debt) => {
      if (debt.status === 'paid') return;

      const dueDate = new Date(debt.due_date);
      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const amount = Number(debt.remaining) || 0;

      if (diffDays <= 30) {
        aging.current.count++;
        aging.current.amount += amount;
      } else if (diffDays <= 60) {
        aging.days30.count++;
        aging.days30.amount += amount;
      } else if (diffDays <= 90) {
        aging.days60.count++;
        aging.days60.amount += amount;
      } else {
        aging.days90.count++;
        aging.days90.amount += amount;
      }
    });

    return Object.values(aging);
  }

  async getTrends(query: any = {}, currentUser?: User) {
    const endDate = query.to ? new Date(query.to) : new Date();
    const startDate = query.from
      ? new Date(query.from)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const trends: any[] = [];
    const dayMs = 24 * 60 * 60 * 1000;

    for (
      let date = new Date(startDate);
      date <= endDate;
      date.setTime(date.getTime() + dayMs)
    ) {
      const dateStr = date.toISOString().split('T')[0];

      const dayQuery = { ...query, singleDate: dateStr };
      const { data: dayDebts } = await this.findAll(
        dayQuery,
        currentUser,
        1,
        1000000,
      );

      const paid = dayDebts.filter((d) => d.status === 'paid').length;
      const payLater = dayDebts.filter((d) => d.status === 'pay_later').length;
      const noInfo = dayDebts.filter(
        (d) => d.status === 'no_information_available',
      ).length;
      const total = dayDebts.length;
      const totalAmount = dayDebts.reduce(
        (sum, d) => sum + (Number(d.total_amount) || 0),
        0,
      );

      trends.push({
        date: dateStr,
        name: date.toLocaleDateString('vi-VN'),
        paid,
        pay_later: payLater,
        no_info: noInfo,
        total,
        totalAmount,
        collectionRate:
          total > 0 ? Math.round((paid / total) * 100 * 100) / 100 : 0,
      });
    }

    return trends;
  }

  async getEmployeePerformance(query: any = {}, currentUser?: User) {
    const { data: debts } = await this.findAll(query, currentUser, 1, 1000000);

    const employeeStats = new Map();

    debts.forEach((debt) => {
      const employeeCode = debt.employee_code_raw || 'Unknown';

      if (!employeeStats.has(employeeCode)) {
        employeeStats.set(employeeCode, {
          employeeCode,
          totalAssigned: 0,
          totalCollected: 0,
          totalAmount: 0,
          collectedAmount: 0,
          avgDaysToCollect: 0,
        });
      }

      const stats = employeeStats.get(employeeCode);
      stats.totalAssigned++;
      stats.totalAmount += Number(debt.total_amount) || 0;

      if (debt.status === 'paid') {
        stats.totalCollected++;
        stats.collectedAmount += Number(debt.total_amount) || 0;
      }
    });

    return Array.from(employeeStats.values())
      .map((stats) => ({
        ...stats,
        collectionRate:
          stats.totalAssigned > 0
            ? Math.round(
                (stats.totalCollected / stats.totalAssigned) * 100 * 100,
              ) / 100
            : 0,
        avgDebtAmount:
          stats.totalAssigned > 0
            ? Math.round(stats.totalAmount / stats.totalAssigned)
            : 0,
      }))
      .sort((a, b) => b.collectionRate - a.collectionRate);
  }

  async getDepartmentBreakdown(query: any = {}, currentUser?: User) {
    const { data: debts } = await this.findAll(query, currentUser, 1, 1000000);

    // Lấy thông tin departments từ users
    const employeeCodes = [
      ...new Set(debts.map((d) => d.employee_code_raw).filter(Boolean)),
    ];
    const users = await this.userRepository.find({
      where:
        employeeCodes.length > 0 ? { employeeCode: In(employeeCodes) } : {},
      relations: ['departments'],
    });

    const userDeptMap = new Map();
    users.forEach((user) => {
      if (user.departments && user.departments.length > 0) {
        userDeptMap.set(user.employeeCode, user.departments[0].name);
      }
    });

    const deptStats = new Map();

    debts.forEach((debt) => {
      const deptName =
        userDeptMap.get(debt.employee_code_raw) || 'Chưa phân bộ phận';

      if (!deptStats.has(deptName)) {
        deptStats.set(deptName, {
          department: deptName,
          total: 0,
          paid: 0,
          payLater: 0,
          noInfo: 0,
          totalAmount: 0,
          collectedAmount: 0,
        });
      }

      const stats = deptStats.get(deptName);
      stats.total++;
      stats.totalAmount += Number(debt.total_amount) || 0;

      if (debt.status === 'paid') {
        stats.paid++;
        stats.collectedAmount += Number(debt.total_amount) || 0;
      } else if (debt.status === 'pay_later') {
        stats.payLater++;
      } else {
        stats.noInfo++;
      }
    });

    return Array.from(deptStats.values())
      .map((stats) => ({
        ...stats,
        collectionRate:
          stats.total > 0
            ? Math.round((stats.paid / stats.total) * 100 * 100) / 100
            : 0,
      }))
      .sort((a, b) => b.collectionRate - a.collectionRate);
  }

  // Lấy danh sách các session import trong ngày
  async getImportHistory(date?: string) {
    const filterDate = date || new Date().toISOString().slice(0, 10);

    const sessions = await this.debtImportBackupRepo
      .createQueryBuilder('backup')
      .select([
        'backup.import_session_id',
        'MIN(backup.created_at) as created_at',
        'COUNT(*) as total_records',
      ])
      .where('DATE(backup.created_at) = :date', { date: filterDate })
      .groupBy('backup.import_session_id')
      .orderBy('MIN(backup.created_at)', 'DESC')
      .getRawMany();

    return sessions.map((session) => ({
      import_session_id: session.backup_import_session_id,
      created_at: session.created_at,
      total_records: parseInt(session.total_records),
    }));
  }

  // Rollback một session import
  async rollbackImport(sessionId: string) {
    return await this.dataSource.transaction(async (manager) => {
      const debtRepo = manager.getRepository(Debt);
      const debtStatisticRepo = manager.getRepository(DebtStatistic);
      const backupRepo = manager.getRepository(DebtImportBackup);

      // Lấy tất cả backup records của session này
      const backups = await backupRepo.find({
        where: { import_session_id: sessionId },
        order: { created_at: 'DESC' }, // Rollback theo thứ tự ngược lại
      });

      if (backups.length === 0) {
        throw new BadRequestException(
          `Không tìm thấy session import: ${sessionId}`,
        );
      }

      let rollbackCount = 0;

      for (const backup of backups) {
        try {
          if (backup.action_type === 'CREATE') {
            // Xóa mềm record đã tạo
            await debtRepo.softDelete(backup.original_debt_id);
            rollbackCount++;
          } else if (backup.action_type === 'UPDATE') {
            // Khôi phục dữ liệu cũ
            const originalData = backup.original_data;
            await debtRepo.update(backup.original_debt_id, {
              customer_raw_code: originalData.customer_raw_code,
              invoice_code: originalData.invoice_code,
              bill_code: originalData.bill_code,
              issue_date: originalData.issue_date
                ? new Date(originalData.issue_date)
                : undefined,
              due_date: originalData.due_date
                ? new Date(originalData.due_date)
                : undefined,
              total_amount: originalData.total_amount,
              remaining: originalData.remaining,
              status: originalData.status,
              updated_at: originalData.updated_at
                ? new Date(originalData.updated_at)
                : new Date(),
              pay_later: originalData.pay_later
                ? new Date(originalData.pay_later)
                : undefined,
              sale: originalData.sale,
              sale_name_raw: originalData.sale_name_raw,
              employee_code_raw: originalData.employee_code_raw,
              note: originalData.note,
              debt_config: originalData.debt_config,
            });
            rollbackCount++;
          } else if (backup.action_type === 'MARK_PAID') {
            // Khôi phục trạng thái từ PAID về trạng thái cũ
            const originalData = backup.original_data;
            await debtRepo.update(backup.original_debt_id, {
              status: originalData.status,
              updated_at: originalData.updated_at
                ? new Date(originalData.updated_at)
                : new Date(),
              pay_later: originalData.pay_later
                ? new Date(originalData.pay_later)
                : null,
            });

            // Khôi phục debt_statistics
            if (originalData.updated_at) {
              await debtStatisticRepo
                .createQueryBuilder()
                .update()
                .set({ status: originalData.status })
                .where('original_debt_id = :id', {
                  id: backup.original_debt_id,
                })
                .andWhere('DATE(statistic_date) = :date', {
                  date: new Date(originalData.updated_at)
                    .toISOString()
                    .slice(0, 10),
                })
                .execute();
            }
            rollbackCount++;
          }
        } catch (error) {
          console.error(
            `Lỗi khi rollback record ${backup.original_debt_id}:`,
            error,
          );
          // Tiếp tục rollback các record khác
        }
      }

      // Xóa các bản ghi backup sau khi rollback thành công
      await backupRepo.delete({ import_session_id: sessionId });

      return {
        success: true,
        rollback_count: rollbackCount,
        session_id: sessionId,
        message: `Đã rollback thành công ${rollbackCount} bản ghi từ session ${sessionId}`,
      };
    });
  }
}
