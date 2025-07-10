import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In } from 'typeorm';
import { Debt } from './debt.entity';
import { DebtConfig, CustomerType } from '../debt_configs/debt_configs.entity';
import { User } from '../users/user.entity';
import { Request } from 'express';

@Injectable()
export class DebtService {
  constructor(
    @InjectRepository(Debt)
    private readonly debtRepository: Repository<Debt>,
    @InjectRepository(DebtConfig)
    private readonly debtConfigRepository: Repository<DebtConfig>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findAll(query: any = {}, currentUser?: User) {
    const roleNames = (currentUser?.roles || []).map(
      (r: any) =>
        typeof r === 'string'
          ? r.toLowerCase()
          : (r.code || r.name || '').toLowerCase()
    );
    const isAdminOrManager = roleNames.includes('admin') || roleNames.includes('manager-cong-no');
    const qb = this.debtRepository.createQueryBuilder('debt')
      .leftJoinAndSelect('debt.sale', 'sale')
      .leftJoinAndSelect('debt.debt_config', 'debt_config')
      .leftJoinAndSelect('debt_config.employee', 'employee');

    let filterDate: string | undefined = query.singleDate;
    if (!filterDate && query.date) {
      filterDate = query.date;
    }
    if (!filterDate) {
      const today = new Date();
      filterDate = today.toISOString().slice(0, 10);
    }
    qb.andWhere('DATE(debt.updated_at) = :filterDate', { filterDate });

    if (!isAdminOrManager) {
      qb.andWhere(
        `(
          TRIM(LEFT(debt.employee_code_raw, CASE WHEN LOCATE('-', debt.employee_code_raw) > 0 THEN LOCATE('-', debt.employee_code_raw) - 1 ELSE CHAR_LENGTH(debt.employee_code_raw) END)) = :empCode
          OR debt_config.employee = :userId
        )`,
        {
          empCode: currentUser?.employeeCode,
          userId: currentUser?.id,
        }
      );
    }
    return qb.getMany();
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

  async importExcelRows(rows: any[]) {
    type ImportResult = { row: number; error?: string; success?: boolean };
    const errors: ImportResult[] = [];
    const imported: ImportResult[] = [];
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return { imported, errors: [{ row: 0, error: 'Không có dữ liệu để import' }] };
    }
    const excelInvoiceCodes = rows.map(row => row['Số chứng từ']).filter(Boolean);
    const existingDebts = excelInvoiceCodes.length > 0
      ? await this.debtRepository.find({ where: { invoice_code: In(excelInvoiceCodes) } })
      : [];
    const existingDebtsMap = new Map(existingDebts.map(d => [d.invoice_code, d]));
    const debtsNotInExcel = excelInvoiceCodes.length > 0
      ? await this.debtRepository.find({ where: { invoice_code: Not(In(excelInvoiceCodes)) } })
      : [];
    for (const debt of debtsNotInExcel) {
      debt.status = 'paid' as any;
      debt.updated_at = new Date();
      await this.debtRepository.save(debt);
    }
    // Map customer_code -> pay_later (Date) từ DB
    const customerCodes = rows.map(row => row['Mã đối tác']).filter(Boolean);
    let payLaterMap = new Map<string, Date>();
    if (customerCodes.length > 0) {
      const debtsWithPayLater = await this.debtRepository.find({
        where: { customer_raw_code: In(customerCodes) },
        select: ['customer_raw_code', 'pay_later'],
      });
      for (const d of debtsWithPayLater) {
        if (d.customer_raw_code && d.pay_later) {
          // Lấy ngày gần nhất nếu có nhiều phiếu cùng mã
          const old = payLaterMap.get(d.customer_raw_code);
          if (!old || (d.pay_later > old)) {
            payLaterMap.set(d.customer_raw_code, d.pay_later);
          }
        }
      }
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const keys = Object.keys(row).filter(k => k !== 'Còn lại');
      const onlyHasConLai = keys.every(k => !row[k] || row[k] === '' || row[k] === null);
      if (onlyHasConLai && row['Còn lại']) {
        continue;
      }
      const required = [
        'Mã đối tác', 'Số chứng từ', 'Ngày chứng từ', 'Số hóa đơn',
        'Ngày đến hạn', 'Ngày công nợ', 'Số ngày quá hạn',
        'Số tiền chứng từ', 'Còn lại', 'NVKD', 'Kế toán công nợ'
      ];
      const missing = required.filter((k) => !row[k]);
      if (missing.length) {
        errors.push({ row: i + 2, error: `Thiếu trường: ${missing.join(', ')}` });
        continue;
      }
      let debtConfig = await this.debtConfigRepository.findOne({ where: { customer_code: row['Mã đối tác'] } });
      let sale_id: number | undefined = undefined;
      let sale_name_raw: string = '';
      if (row['NVKD']) {
        const code = row['NVKD'].split('-')[0];
        const user = await this.userRepository.createQueryBuilder('user')
          .where('user.employeeCode LIKE :code', { code: `%${code}%` })
          .getOne();
        if (user && user.employeeCode && user.employeeCode.startsWith(code)) {
          sale_id = user.id;
        } else {
          sale_name_raw = row['NVKD'] || '';
        }
      }
      let employee_code_raw: string = row['Kế toán công nợ'] || '';
      const invoice_code = row['Số chứng từ'];
      const oldDebt = existingDebtsMap.get(invoice_code);
      const parseDate = (val: any): Date | null => {
        const str = this.parseExcelDate(val);
        return str ? new Date(str) : null;
      };
      try {
        let pay_later: Date | undefined = undefined;
        if (oldDebt) {
          pay_later = oldDebt.pay_later || payLaterMap.get(row['Mã đối tác']) || undefined;
        } else {
          pay_later = payLaterMap.get(row['Mã đối tác']) || undefined;
        }
        if (oldDebt) {
          oldDebt.customer_raw_code = row['Mã đối tác'] || '';
          oldDebt.invoice_code = invoice_code;
          oldDebt.issue_date = parseDate(row['Ngày chứng từ']) || oldDebt.issue_date;
          oldDebt.bill_code = row['Số hóa đơn'] || '';
          oldDebt.due_date = parseDate(row['Ngày đến hạn']) || oldDebt.due_date;
          oldDebt.total_amount = row['Số tiền chứng từ'] || 0;
          oldDebt.remaining = row['Còn lại'] || 0;
          oldDebt.sale = sale_id ? { id: sale_id } as any : undefined;
          oldDebt.sale_name_raw = sale_name_raw;
          oldDebt.employee_code_raw = employee_code_raw;
          oldDebt.debt_config = debtConfig ? { id: debtConfig.id } as any : undefined;
          oldDebt.updated_at = new Date();
          oldDebt.pay_later = pay_later ?? null;
          await this.debtRepository.save(oldDebt);
          imported.push({ row: i + 2, success: true });
        } else {
          const debt = this.debtRepository.create({
            customer_raw_code: row['Mã đối tác'] || '',
            invoice_code: invoice_code,
            issue_date: parseDate(row['Ngày chứng từ']) || new Date(),
            bill_code: row['Số hóa đơn'] || '',
            due_date: parseDate(row['Ngày đến hạn']) || new Date(),
            total_amount: row['Số tiền chứng từ'] || 0,
            remaining: row['Còn lại'] || 0,
            sale: sale_id ? { id: sale_id } as any : undefined,
            sale_name_raw,
            employee_code_raw,
            debt_config: debtConfig ? { id: debtConfig.id } as any : undefined,
            created_at: new Date(),
            updated_at: new Date(),
            pay_later: pay_later ?? null,
          });
          await this.debtRepository.save(debt);
          imported.push({ row: i + 2, success: true });
        }
      } catch (err) {
        errors.push({ row: i + 2, error: err?.message || 'Unknown error' });
      }
    }
    return { imported, errors };
  }

  private parseExcelDate(val: any): string | undefined {
    if (!val) return undefined;
    if (typeof val === 'number') {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + (val * 24 * 60 * 60 * 1000));
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, '0');
      const dd = String(date.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    }
    if (typeof val === 'string') {
      const parts = val.split(/[\/-]/);
      if (parts.length === 3) {
        const dd = parts[0].padStart(2, '0');
        const mm = parts[1].padStart(2, '0');
        let yyyy = parts[2];
        if (yyyy.length === 2) yyyy = '20' + yyyy;
        return `${yyyy}-${mm}-${dd}`;
      }
    }
    return undefined;
  }

  async getUniqueCustomerList(currentUser?: User) {
    const roleNames = (currentUser?.roles || []).map(
      (r: any) =>
        typeof r === 'string'
          ? r.toLowerCase()
          : (r.code || r.name || '').toLowerCase()
    );
    const isAdminOrManager = roleNames.includes('admin') || roleNames.includes('manager-cong-no');
    const configs = await this.debtConfigRepository.find({ select: ['customer_code', 'customer_name', 'employee', 'customer_type'] });
    const configMap = new Map<string, string>();
    for (const c of configs) {
      if (
        c.customer_type === 'fixed'
      ) continue;
      if (
        isAdminOrManager ||
        (c.employee && currentUser && c.employee.id === currentUser.id)
      ) {
        configMap.set(c.customer_code, c.customer_name);
      }
    }
    const result: { code: string, name: string }[] = [];
    for (const [code, name] of configMap.entries()) {
      result.push({ code, name });
    }
    let rawDebtsQuery = this.debtRepository.createQueryBuilder('debt')
      .select(['debt.customer_raw_code']);
    if (!isAdminOrManager) {
      rawDebtsQuery = rawDebtsQuery
        .where(
          `TRIM(LEFT(debt.employee_code_raw, CASE WHEN LOCATE('-', debt.employee_code_raw) > 0 THEN LOCATE('-', debt.employee_code_raw) - 1 ELSE CHAR_LENGTH(debt.employee_code_raw) END)) = :empCode`,
          { empCode: currentUser?.employeeCode }
        );
    }
    const rawDebts = await rawDebtsQuery.groupBy('debt.customer_raw_code').getRawMany();
    for (const d of rawDebts) {
      const code = d.debt_customer_raw_code;
      let name = code;
      if (code && !configMap.has(code)) {
        result.push({ code, name });
      } else if (code && configMap.has(code) && !configMap.get(code) && name) {
        const idx = result.findIndex(r => r.code === code);
        if (idx !== -1) result[idx].name = name;
      }
    }
    return result;
  }

  async updatePayLaterForCustomers(customerCodes: string[], payDate: Date) {
    if (!Array.isArray(customerCodes) || !payDate) return 0;
    // Lấy danh sách customer_code fixed
    const fixedConfigs = await this.debtConfigRepository.find({
      where: { customer_code: In(customerCodes), customer_type: CustomerType.FIXED },
      select: ['customer_code']
    });
    const fixedCodes = new Set(fixedConfigs.map(c => c.customer_code));
    // Lọc bỏ các mã thuộc fixed
    const validCodes = customerCodes.filter(code => !fixedCodes.has(code));
    if (!validCodes.length) return 0;
    // Lấy danh sách các phiếu sẽ bị cập nhật và lưu lại updated_at cũ
    const debts = await this.debtRepository.find({
      where: { customer_raw_code: In(validCodes) },
      select: ['id', 'updated_at']
    });
    const updatedAtMap = new Map<number, Date>();
    debts.forEach(d => updatedAtMap.set(d.id, d.updated_at));
    // Cập nhật pay_later
    await this.debtRepository
      .createQueryBuilder()
      .update(Debt)
      .set({ pay_later: payDate })
      .where('customer_raw_code IN (:...codes)', { codes: validCodes })
      .execute();
    // Khôi phục lại updated_at cũ cho các phiếu vừa cập nhật
    for (const d of debts) {
      await this.debtRepository.update(d.id, { updated_at: d.updated_at });
    }
    return validCodes.length;
  }
}
