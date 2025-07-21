import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In, Between } from 'typeorm';
import { DebtConfig } from './debt_configs.entity';
import { instanceToPlain } from 'class-transformer';
import { DebtLogsService } from '../debt_logs/debt_logs.service';
import { ReminderStatus } from '../debt_logs/debt_logs.entity';

interface DebtConfigFilters {
  search?: string;
  employees?: number[];
  singleDate?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class DebtConfigService {
  constructor(
    @InjectRepository(DebtConfig)
    private readonly repo: Repository<DebtConfig>,
    private readonly debtLogsService: DebtLogsService,
  ) {}

  async findAll(filters: DebtConfigFilters = {}): Promise<{
    data: DebtConfig[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.repo.createQueryBuilder('debt_config')
      .leftJoinAndSelect('debt_config.debts', 'debts')
      .leftJoinAndSelect('debt_config.debt_log', 'debt_log')
      .leftJoinAndSelect('debt_config.employee', 'employee')
      .leftJoinAndSelect('debt_config.actor', 'actor');

    // Search filter (tìm theo mã khách hàng hoặc tên khách hàng)
    if (filters.search && filters.search.trim()) {
      queryBuilder.andWhere(
        '(debt_config.customer_code LIKE :search OR debt_config.customer_name LIKE :search)',
        { search: `%${filters.search.trim()}%` }
      );
    }

    // Employee filter
    if (filters.employees && filters.employees.length > 0) {
      queryBuilder.andWhere('employee.id IN (:...employeeIds)', {
        employeeIds: filters.employees
      });
    }

    // Single date filter (lọc theo ngày đã nhắc - send_last_at)
    if (filters.singleDate) {
      const filterDate = new Date(filters.singleDate);
      const startOfDay = new Date(filterDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filterDate);
      endOfDay.setHours(23, 59, 59, 999);

      queryBuilder.andWhere('debt_config.send_last_at BETWEEN :startOfDay AND :endOfDay', {
        startOfDay,
        endOfDay
      });
    }

    // Count total for pagination
    const total = await queryBuilder.getCount();

    // Apply pagination and ordering
    const data = await queryBuilder
      .orderBy('debt_config.id', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: number): Promise<DebtConfig> {
    const config = await this.repo.findOne({
      where: { id },
      relations: ['debts', 'debt_log', 'employee', 'actor'],
    });
    if (!config) throw new Error('DebtConfig not found');
    return config;
  }

  async create(data: Partial<DebtConfig>): Promise<DebtConfig> {
    // Kiểm tra trùng lặp mã khách hàng
    if (data.customer_code) {
      const existingConfig = await this.repo.findOne({
        where: { customer_code: data.customer_code },
      });
      if (existingConfig) {
        return {
          success: false,
          message: `Cấu hình công nợ cho mã khách hàng "${data.customer_code}" đã tồn tại`,
        } as any;
      }
    }

    const entity = this.repo.create(data);

    // Tìm employee dựa trên debts có customer_raw_code trùng với customer_code
    if (data.customer_code) {
      const debt = await this.repo.manager.getRepository('Debt').findOne({
      where: { customer_raw_code: data.customer_code },
      });

      if (debt && debt.employee_code_raw) {
      const empCode = String(debt.employee_code_raw).split('-')[0].trim();
      if (empCode) {
        const user = await this.repo.manager.getRepository('User').findOne({
        where: { employeeCode: empCode },
        });
        if (user) {
        entity.employee = { id: user.id } as any;
        } else {
        entity.employee = undefined;
        }
      } else {
        entity.employee = undefined;
      }
      } else {
      entity.employee = undefined;
      }
    }

    const savedConfig = await this.repo.save(entity);

    // Cập nhật debt_config cho các debts có customer_raw_code trùng với customer_code
    if (data.customer_code) {
      const debtsToUpdate = await this.repo.manager.getRepository('Debt').find({
        where: { customer_raw_code: data.customer_code },
      });

      for (const debt of debtsToUpdate) {
        debt.debt_config = savedConfig;
        await this.repo.manager.getRepository('Debt').save(debt);
      }
    }

    // Tạo debt_log tương ứng (1-1)
    const debtLog = await this.debtLogsService.create({
      debt_config_id: savedConfig.id,
      debt_msg: '',
      remind_status: ReminderStatus.NotSent,
    });
    // Gán debt_log vào debt_config
    savedConfig.debt_log = debtLog;
    await this.repo.save(savedConfig);

    return savedConfig;
  }

  async update(id: number, data: Partial<DebtConfig>): Promise<DebtConfig> {
    // Check if config exists first
    const config = await this.repo.findOne({ where: { id } });
    if (!config) throw new Error('DebtConfig not found');

    // Chỉ cho phép các trường này được update
    const allowedFields = [
      'is_send',
      'is_repeat',
      'gap_day',
      'day_of_week',
      'customer_name',
      'send_last_at',
      'last_update_at',
      'customer_type',
    ];
    const updateData: any = {};
    for (const key of allowedFields) {
      const value = data[key];
      if (
        value !== undefined &&
        !(
          typeof value === 'object' &&
          value !== null &&
          Object.keys(value).length === 0
        )
      ) {
        updateData[key] = value;
      }
    }

    // Handle actor relation separately if provided
    if (data.actor && typeof data.actor === 'object' && data.actor.id) {
      updateData.actor = { id: data.actor.id };
    }

    // Handle employee relation separately if provided
    if (
      data.employee &&
      typeof data.employee === 'object' &&
      data.employee.id
    ) {
      updateData.employee = { id: data.employee.id };
    }

    const result = await this.repo.update(id, updateData);
    if (result.affected === 0) {
      throw new Error('DebtConfig not found');
    }

    const updated = await this.repo.findOne({
      where: { id },
      relations: ['debts', 'debt_log', 'employee', 'actor'],
    });
    if (!updated) throw new Error('DebtConfig not found after update');
    return updated;
  }

  async remove(id: number): Promise<void> {
    // Hard delete debt_config
    await this.repo.delete(id);
  }

  async findByEmployee(employeeId: number): Promise<DebtConfig[]> {
    return this.repo.find({
      where: { employee: { id: employeeId } },
      relations: ['debts', 'debt_log', 'employee', 'actor'],
    });
  }

  async findAllWithRole(currentUser: any, filters: DebtConfigFilters = {}): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const roleNames = (currentUser?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdminOrManager =
      roleNames.includes('admin') || roleNames.includes('manager-cong-no');

    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const queryBuilder = this.repo.createQueryBuilder('debt_config')
      .leftJoinAndSelect('debt_config.debt_log', 'debt_log')
      .leftJoinAndSelect('debt_config.actor', 'actor')
      .leftJoinAndSelect('debt_config.debts', 'debts')
      .leftJoinAndSelect('debt_config.employee', 'employee')
      .select([
        'debt_config.id',
        'debt_config.customer_code',
        'debt_config.customer_name',
        'debt_config.customer_type',
        'debt_config.day_of_week',
        'debt_config.gap_day',
        'debt_config.is_send',
        'debt_config.is_repeat',
        'debt_config.send_last_at',
        'debt_config.last_update_at',
        'debt_log',
        'actor',
        'debts',
        'employee.id',
        'employee.fullName',
        'employee.username'
      ]);

    // Role-based filtering
    if (!isAdminOrManager && roleNames.includes('user-cong-no')) {
      queryBuilder.andWhere('employee.id = :userId', { userId: currentUser?.id });
    } else if (!isAdminOrManager) {
      return {
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
      };
    }

    // Search filter
    if (filters.search && filters.search.trim()) {
      queryBuilder.andWhere(
        '(debt_config.customer_code LIKE :search OR debt_config.customer_name LIKE :search)',
        { search: `%${filters.search.trim()}%` }
      );
    }

    // Employee filter
    if (filters.employees && filters.employees.length > 0) {
      queryBuilder.andWhere('employee.id IN (:...employeeIds)', {
        employeeIds: filters.employees
      });
    }

    // Single date filter
    if (filters.singleDate) {
      const filterDate = new Date(filters.singleDate);
      const startOfDay = new Date(filterDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(filterDate);
      endOfDay.setHours(23, 59, 59, 999);

      queryBuilder.andWhere('debt_config.send_last_at BETWEEN :startOfDay AND :endOfDay', {
        startOfDay,
        endOfDay
      });
    }

    // Count total
    const total = await queryBuilder.getCount();

    // Get data with pagination
    const configs = await queryBuilder
      .orderBy('debt_config.id', 'DESC')
      .skip(skip)
      .take(limit)
      .getMany();

    const data = configs.map((cfg) => {
      const total_bills = Array.isArray(cfg.debts) ? cfg.debts.length : 0;
      const total_debt = Array.isArray(cfg.debts)
        ? cfg.debts.reduce(
            (sum: number, d: any) => sum + (Number(d.remaining) || 0),
            0,
          )
        : 0;

      return {
        id: cfg.id,
        customer_code: cfg.customer_code,
        customer_name: cfg.customer_name,
        customer_type: cfg.customer_type,
        day_of_week: cfg.day_of_week,
        gap_day: cfg.gap_day,
        is_send: cfg.is_send,
        is_repeat: cfg.is_repeat,
        send_last_at: cfg.send_last_at ? cfg.send_last_at.toISOString() : null,
        last_update_at: cfg.last_update_at
          ? cfg.last_update_at.toISOString()
          : null,
        actor: cfg.actor
          ? { fullName: cfg.actor.fullName, username: cfg.actor.username }
          : null,
        employee: cfg.employee
          ? { id: cfg.employee.id, fullName: cfg.employee.fullName }
          : null,
        debt_log: cfg.debt_log
          ? {
              remind_status: cfg.debt_log.remind_status,
              created_at: cfg.debt_log.created_at ? cfg.debt_log.created_at.toISOString() : null,
              send_at: cfg.debt_log.send_at ? cfg.debt_log.send_at.toISOString() : null,
              first_remind_at: cfg.debt_log.first_remind_at ? cfg.debt_log.first_remind_at.toISOString() : null,
              second_remind_at: cfg.debt_log.second_remind_at ? cfg.debt_log.second_remind_at.toISOString() : null,
            }
          : null,
        total_bills,
        total_debt,
      };
    });

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Sửa lại toggleSend
  async toggleSend(
    id: number,
    is_send: boolean,
    user: any,
  ): Promise<DebtConfig> {
    const updateFields: any = {
      is_send,
      is_repeat: is_send,
      last_update_at: new Date(),
    };
    if (user && (user.id || user.userId)) {
      updateFields.actor = { id: user.id || user.userId };
    }
    await this.repo.update(id, updateFields);

    const updated = await this.repo.findOne({
      where: { id },
      relations: ['actor', 'debt_log', 'debts'],
    });
    if (!updated) throw new Error('DebtConfig not found after update');
    return updated;
  }

  // Sửa lại toggleRepeat
  async toggleRepeat(
    id: number,
    is_repeat: boolean,
    user: any,
  ): Promise<DebtConfig> {
    const updateFields: any = {
      is_repeat,
      last_update_at: new Date(),
    };
    if (user && (user.id || user.userId)) {
      updateFields.actor = { id: user.id || user.userId };
    }
    await this.repo.update(id, updateFields);

    const updated = await this.repo.findOne({
      where: { id },
      relations: ['actor', 'debt_log', 'debts'],
    });
    if (!updated) throw new Error('DebtConfig not found after update');
    return updated;
  }

  async importExcelRows(
    rows: any[],
  ): Promise<{ imported: any[]; errors: any[] }> {
    const errors: any[] = [];
    const imported: any[] = [];
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return {
        imported,
        errors: [{ row: 0, error: 'Không có dữ liệu để import' }],
      };
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const customer_code = row['Mã Khách Hàng']?.toString().trim();
      const customer_type_raw = row['Loại Khách Hàng']?.toString().trim();
      const ngay_hen_lap_raw = row['Ngày Hẹn/Lặp']?.toString().trim();
      const customer_name = row['Tên Zalo Khách Hàng']?.toString().trim() || '';
      if (!customer_code || !customer_type_raw || !ngay_hen_lap_raw) {
        errors.push({ row: i + 2, error: 'Thiếu trường bắt buộc' });
        break;
      }
      // Mapping loại khách hàng
      let customer_type: 'fixed' | 'non-fixed' | 'cash' | undefined;
      if (customer_type_raw === 'Cố Định') customer_type = 'fixed';
      else if (customer_type_raw === 'Không Cố Định')
        customer_type = 'non-fixed';
      else if (customer_type_raw === 'Tiền Mặt') customer_type = 'cash';
      else {
        errors.push({
          row: i + 2,
          error: `Loại khách hàng không hợp lệ: ${customer_type_raw}`,
        });
        break;
      }
      // Validate và parse Ngày Hẹn/Lặp
      let gap_day: number | undefined = undefined;
      let day_of_week: number[] | undefined = undefined;
      if (customer_type === 'cash' || customer_type === 'non-fixed') {
        if (ngay_hen_lap_raw.includes(',')) {
          errors.push({
            row: i + 2,
            error:
              'Tiền Mặt/Không Cố Định chỉ được 1 số duy nhất cho Ngày Hẹn/Lặp',
          });
          break;
        }
        const num = Number(ngay_hen_lap_raw);
        if (!Number.isInteger(num) || num < 0 || num > 10) {
          errors.push({
            row: i + 2,
            error: 'Ngày Hẹn/Lặp phải là số nguyên từ 0-10 (0 = Nhắc Mỗi Ngày)',
          });
          break;
        }
        gap_day = num;
      } else if (customer_type === 'fixed') {
        const arr = ngay_hen_lap_raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => !isNaN(n));
        if (
          arr.length === 0 ||
          arr.some((n) => n < 2 || n > 7 || !Number.isInteger(n))
        ) {
          errors.push({
            row: i + 2,
            error:
              'Ngày Hẹn/Lặp cho Cố Định phải là số nguyên từ 2-7, cách nhau dấu phẩy',
          });
          break;
        }
        day_of_week = arr;
      }
      // Tìm employee cho debt_config
      let employee: any = null;
      // Tìm debt có customer_raw_code = customer_code
      const debt = await this.repo.manager
        .getRepository('Debt')
        .findOne({ where: { customer_raw_code: customer_code } });
      if (debt && debt.employee_code_raw) {
        const empCode = String(debt.employee_code_raw).split('-')[0].trim();
        if (empCode) {
          const user = await this.repo.manager
            .getRepository('User')
            .findOne({ where: { employeeCode: empCode } });
          if (user) employee = user;
        }
      }
      // Kiểm tra trùng lặp mã khách hàng
      const existingConfig = await this.repo.findOne({
        where: { customer_code },
      });
      if (existingConfig) {
        errors.push({
          row: i + 2,
          error: `Mã khách hàng "${customer_code}" đã tồn tại trong hệ thống`,
        });
        continue; // Bỏ qua row này và tiếp tục với row tiếp theo
      }

      // Tạo debt_config mới
      const config = this.repo.create({ customer_code });

      // Cập nhật thông tin
      config.customer_type = customer_type as any; // ép kiểu về enum CustomerType
      config.gap_day = typeof gap_day === 'number' ? gap_day : null;
      config.day_of_week = Array.isArray(day_of_week) ? day_of_week : null;
      config.employee = employee || null;
      config.customer_name = customer_name;

      await this.repo.save(config);

      await this.repo.manager.getRepository('Debt').update(
        { customer_raw_code: customer_code },
        { debt_config: config }
      );
      
      imported.push({
        row: i + 2,
        customer_code,
        action: 'created',
      });
    }
    return { imported, errors };
  }

  async getDebtConfigDetail(id: number): Promise<any> {
    const config = await this.repo.findOne({
      where: { id },
      relations: ['debt_log', 'actor', 'employee'],
    });

    if (!config) {
      throw new Error('DebtConfig not found');
    }

    const debtLog = config.debt_log || null;

    return {
      id: config.id,
      customer_code: config.customer_code,
      customer_name: config.customer_name,
      customer_type: config.customer_type,
      // Từ debt_log
      image_url: debtLog?.debt_img || null,
      debt_message: debtLog?.debt_msg || '',
      remind_message_1: debtLog?.first_remind || '',
      remind_message_2: debtLog?.second_remind || '',
      business_remind_message: debtLog?.sale_msg || '',
      remind_status: debtLog?.remind_status || 'Not Sent',
      customer_gender: debtLog?.gender || '',
      send_time: debtLog?.send_at ? debtLog.send_at.toISOString() : null,
      remind_time_1: debtLog?.first_remind_at ? debtLog.first_remind_at.toISOString() : null,
      remind_time_2: debtLog?.second_remind_at ? debtLog.second_remind_at.toISOString() : null,
      // Thông tin bổ sung
      is_send: config.is_send,
      is_repeat: config.is_repeat,
      day_of_week: config.day_of_week,
      gap_day: config.gap_day,
      send_last_at: config.send_last_at ? config.send_last_at.toISOString() : null,
      last_update_at: config.last_update_at ? config.last_update_at.toISOString() : null,
      actor: config.actor ? { fullName: config.actor.fullName, username: config.actor.username } : null,
      employee: config.employee ? { fullName: config.employee.fullName, username: config.employee.username } : null,
    };
  }
}
