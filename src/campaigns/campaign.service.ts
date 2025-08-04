import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Campaign, CampaignStatus, CampaignType } from './campaign.entity';
import { Department } from '../departments/department.entity';
import {
  CreateCampaignDto,
  CustomerDto,
  ScheduleConfigDto,
} from './campaign.dto';
import { User } from '../users/user.entity';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignContent } from '../campaign_contents/campaign_content.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { CampaignEmailReport } from '../campaign_email_reports/campaign_email_report.entity';
import { CampaignCustomer } from '../campaign_customers/campaign_customer.entity';
import {
  PromoMessageFlow,
  InitialMessage,
  ReminderMessage,
} from '../campaign_config/promo_message';
import * as ExcelJS from 'exceljs';

export interface CampaignWithDetails extends Campaign {
  customer_count?: number;

  messages: {
    type: 'initial';
    text: string;
    attachment?: {
      type: 'image' | 'link' | 'file';
      url?: string;
      base64?: string;
      filename?: string;
    } | null;
  };

  schedule_config: {
    type: 'hourly' | '3_day' | 'weekly';
    start_time?: string;
    end_time?: string;
    remind_after_minutes?: number;
    days_of_week?: number[];
    day_of_week?: number;
    time_of_day?: string;
  };

  reminders: Array<{
    content: string;
    minutes: number;
  }>;

  email_reports?: {
    recipients_to: string;
    recipients_cc?: string[];
    report_interval_minutes?: number;
    stop_sending_at_time?: string;
    is_active: boolean;
    send_when_campaign_completed: boolean;
  };

  customers: Array<{
    phone_number: string;
    full_name: string;
    salutation?: string;
  }>;

  // Thêm start_date và end_date lấy từ campaign schedule
  start_date?: string;
  end_date?: string;
}

export interface CampaignResponse {
  data: CampaignWithDetails[];
  total: number;
  stats: {
    totalCampaigns: number;
    draftCampaigns: number;
    runningCampaigns: number;
    completedCampaigns: number;
  };
}

// Interface cho filters
export interface CampaignFilters {
  search?: string;
  campaignTypes?: string[];
  statuses?: string[];
  createdBy?: number[];
  page?: number;
  pageSize?: number;
  employees?: string[]; // Thay đổi từ createdBy
  departments?: string[]; // Thêm mới
  singleDate?: string; // Thêm mới - format YYYY-MM-DD
}

@Injectable()
export class CampaignService {
  constructor(
    @InjectRepository(Campaign)
    private readonly campaignRepository: Repository<Campaign>,
    @InjectRepository(CampaignCustomerMap)
    private readonly campaignCustomerMapRepository: Repository<CampaignCustomerMap>,
    @InjectRepository(CampaignInteractionLog)
    private readonly campaignLogRepository: Repository<CampaignInteractionLog>,
    @InjectRepository(CampaignContent)
    private readonly campaignContentRepository: Repository<CampaignContent>,
    @InjectRepository(CampaignSchedule)
    private readonly campaignScheduleRepository: Repository<CampaignSchedule>,
    @InjectRepository(CampaignEmailReport)
    private readonly campaignEmailReportRepository: Repository<CampaignEmailReport>,
    @InjectRepository(CampaignCustomer)
    private readonly campaignCustomerRepository: Repository<CampaignCustomer>,
  ) {}

  private async checkCampaignAccess(
    campaignId: string,
    user: User,
  ): Promise<Campaign> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.id = :id', { id: campaignId });

    if (isAdmin) {
      // Admin: có thể truy cập tất cả campaign
    } else if (isManager) {
      // Manager: chỉ truy cập campaign của phòng ban có server_ip
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department.id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        // Manager không có department với server_ip thì không truy cập được gì
        qb.andWhere('1 = 0');
      }
    } else {
      // User thường: chỉ truy cập campaign do chính họ tạo
      qb.andWhere('campaign.created_by.id = :userId', {
        userId: user.id,
      });
    }

    const campaign = await qb.getOne();
    if (!campaign) {
      throw new NotFoundException(
        'Không tìm thấy chiến dịch hoặc bạn không có quyền truy cập',
      );
    }

    return campaign;
  }

  async findAll(query: any = {}, user: User): Promise<CampaignResponse> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );

    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(DISTINCT customer_map.customer_id)', 'customer_count')
      .groupBy('campaign.id, created_by.id, department.id')
      // ✅ THÊM: Loại trừ campaign có status = "archived"
      .where('campaign.status != :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply user-based filtering first
    if (isAdmin) {
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    } else {
      qb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply search filter
    if (query.search && query.search.trim()) {
      qb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Apply campaign types filter - Handle both string and array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Apply statuses filter - Handle both string and array
    if (query.statuses) {
      const statusInput = Array.isArray(query.statuses)
        ? query.statuses
        : [query.statuses];
      const validStatuses = statusInput.filter((s) => s && String(s).trim());

      if (validStatuses.length > 0) {
        qb.andWhere('campaign.status IN (:...statuses)', {
          statuses: validStatuses,
        });
      }
    }

    // Apply single date filter
    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    // Apply employee filter - Handle both string and array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          qb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        qb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    // THÊM DEBUG: In ra SQL query
    const sql = qb.getQuery();
    const parameters = qb.getParameters();

    const rawResults = await qb.getRawMany();

    // ✅ SỬA: Count query with same fixes
    const countQb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by')
      // ✅ THÊM: Loại trừ campaign có status = "archived" cho count query
      .where('campaign.status != :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply same user-based filtering for count
    if (isAdmin) {
      // Admin: lấy tất cả
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) => dept.server_ip && dept.server_ip.trim() !== '',
      );

      if (userDepartment) {
        countQb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        countQb.andWhere('1 = 0');
      }
    } else {
      countQb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply same filters for count
    if (query.search && query.search.trim()) {
      countQb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Campaign types filter for count - Handle string/array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        countQb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Status filter for count - Handle string/array
    if (query.statuses) {
      const statusInput = Array.isArray(query.statuses)
        ? query.statuses
        : [query.statuses];
      const validStatuses = statusInput.filter((s) => s && String(s).trim());

      if (validStatuses.length > 0) {
        countQb.andWhere('campaign.status IN (:...statuses)', {
          statuses: validStatuses,
        });
      }
    }

    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      countQb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        countQb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Employee filter for count - Handle string/array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          countQb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    const total = await countQb.getCount();

    // Rest of the method remains the same...
    const campaignIds = rawResults.map((result) => result.campaign_id);

    const allCustomerMaps =
      campaignIds.length > 0
        ? await this.campaignCustomerMapRepository
            .createQueryBuilder('map')
            .leftJoinAndSelect('map.campaign_customer', 'customer')
            .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
            .getMany()
        : [];

    const customersByCampaign = allCustomerMaps.reduce(
      (acc, map) => {
        if (!acc[map.campaign_id]) acc[map.campaign_id] = [];
        acc[map.campaign_id].push({
          phone_number: map.campaign_customer.phone_number,
          full_name: map.full_name,
          salutation: map.salutation,
        });
        return acc;
      },
      {} as Record<
        string,
        Array<{
          phone_number: string;
          full_name: string;
          salutation?: string;
        }>
      >,
    );

    const data: CampaignWithDetails[] = rawResults.map((result: any) => {
      const messages = result.content_messages || [];
      const initialMessage = Array.isArray(messages)
        ? messages.find((msg) => msg.type === 'initial') || messages[0]
        : null;

      const reminderMessages = Array.isArray(messages)
        ? messages.filter((msg) => msg.type === 'reminder')
        : [];

      const scheduleConfig = result.schedule_config || {};

      let start_date: string | undefined = undefined;
      let end_date: string | undefined = undefined;

      if (result.schedule_start_date) {
        start_date =
          result.schedule_start_date instanceof Date
            ? result.schedule_start_date.toISOString()
            : result.schedule_start_date;
      }

      if (result.schedule_end_date) {
        end_date =
          result.schedule_end_date instanceof Date
            ? result.schedule_end_date.toISOString()
            : result.schedule_end_date;
      }

      return {
        id: result.campaign_id,
        name: result.campaign_name,
        campaign_type: result.campaign_campaign_type,
        status: result.campaign_status,
        send_method: result.campaign_send_method,
        created_at: result.campaign_created_at,
        updated_at: result.campaign_updated_at,
        department: {
          id: result.department_id,
          name: result.department_name,
          slug: result.department_slug,
          server_ip: result.department_server_ip,
          createdAt: result.department_createdAt,
          updatedAt: result.department_updatedAt,
          deletedAt: result.department_deletedAt,
        },
        created_by: {
          id: result.created_by_id,
          username: result.created_by_username,
          fullName: result.created_by_fullName,
          email: result.created_by_email,
          isBlock: result.created_by_isBlock,
          employeeCode: result.created_by_employeeCode,
          status: result.created_by_status,
          lastLogin: result.created_by_lastLogin,
          nickName: result.created_by_nickName,
          deletedAt: result.created_by_deletedAt,
          createdAt: result.created_by_createdAt,
          updatedAt: result.created_by_updatedAt,
          zaloLinkStatus: result.created_by_zaloLinkStatus,
          zaloName: result.created_by_zaloName,
          avatarZalo: result.created_by_avatarZalo,
          zaloGender: result.created_by_zaloGender,
          lastOnlineAt: result.created_by_lastOnlineAt,
        } as any,
        customer_count: customersByCampaign[result.campaign_id]?.length || 0,
        messages: {
          type: 'initial' as const,
          text: initialMessage?.text || '',
          attachment: initialMessage?.attachment || null,
        },
        schedule_config: {
          type: scheduleConfig.type || 'hourly',
          start_time: scheduleConfig.start_time,
          end_time: scheduleConfig.end_time,
          remind_after_minutes: scheduleConfig.remind_after_minutes,
          days_of_week: scheduleConfig.days_of_week,
          day_of_week: scheduleConfig.day_of_week,
          time_of_day: scheduleConfig.time_of_day,
        },
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text,
          minutes: reminder.offset_minutes,
        })),
        email_reports: result.email_recipient_to
          ? {
              recipients_to: result.email_recipient_to,
              recipients_cc: result.email_recipients_cc,
              report_interval_minutes: result.email_report_interval_minutes,
              stop_sending_at_time: result.email_stop_sending_at_time,
              is_active: result.email_is_active,
              send_when_campaign_completed:
                result.email_send_when_campaign_completed,
            }
          : undefined,
        customers: customersByCampaign[result.campaign_id] || [],
        start_date,
        end_date,
      } as CampaignWithDetails;
    });

    const stats = await this.getStats(user);
    return { data, total, stats };
  }

  async findOne(id: string, user: User): Promise<CampaignWithDetails> {
    // Kiểm tra quyền truy cập trước - thay thế logic filter department cũ
    await this.checkCampaignAccess(id, user);

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      // Join với các entity riêng biệt để lấy full data
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customers',
        'customer',
        'customer.id = customer_map.customer_id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(customer_map.customer_id)', 'customer_count')
      .where('campaign.id = :id', { id })
      .groupBy(
        'campaign.id, created_by.id, department.id, content.id, schedule.id, email_report.id',
      );

    const rawResult = await qb.getRawOne();

    if (!rawResult) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Parse messages để lấy initial message và reminders
    const messages = rawResult.content_messages || [];
    const initialMessage = Array.isArray(messages)
      ? messages.find((msg) => msg.type === 'initial') || messages[0]
      : null;
    const reminderMessages = Array.isArray(messages)
      ? messages.filter((msg) => msg.type === 'reminder')
      : [];

    // Parse schedule config
    const scheduleConfig = rawResult.schedule_config || {};

    // Parse start_date và end_date từ rawResult
    let start_date: string | undefined = undefined;
    let end_date: string | undefined = undefined;
    if (rawResult.schedule_start_date) {
      start_date =
        rawResult.schedule_start_date instanceof Date
          ? rawResult.schedule_start_date.toISOString()
          : rawResult.schedule_start_date;
    }
    if (rawResult.schedule_end_date) {
      end_date =
        rawResult.schedule_end_date instanceof Date
          ? rawResult.schedule_end_date.toISOString()
          : rawResult.schedule_end_date;
    }

    // Get customers for this campaign
    const customers = await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id = :campaignId', { campaignId: id })
      .getMany();

    const campaignWithDetails: CampaignWithDetails = {
      id: rawResult.campaign_id,
      name: rawResult.campaign_name,
      campaign_type: rawResult.campaign_campaign_type,
      status: rawResult.campaign_status,
      send_method: rawResult.campaign_send_method,
      created_at: rawResult.campaign_created_at,
      updated_at: rawResult.campaign_updated_at,
      deleted_at: rawResult.campaign_deleted_at || null,
      department: {
        id: rawResult.department_id,
        name: rawResult.department_name,
        slug: rawResult.department_slug,
        server_ip: rawResult.department_server_ip,
        createdAt: rawResult.department_createdAt,
        updatedAt: rawResult.department_updatedAt,
        deletedAt: rawResult.department_deletedAt,
      },
      created_by: {
        id: rawResult.created_by_id,
        username: rawResult.created_by_username,
        fullName: rawResult.created_by_fullName,
        email: rawResult.created_by_email,
        isBlock: rawResult.created_by_isBlock,
        employeeCode: rawResult.created_by_employeeCode,
        status: rawResult.created_by_status,
        lastLogin: rawResult.created_by_lastLogin,
        nickName: rawResult.created_by_nickName,
        deletedAt: rawResult.created_by_deletedAt,
        createdAt: rawResult.created_by_createdAt,
        updatedAt: rawResult.created_by_updatedAt,
        zaloLinkStatus: rawResult.created_by_zaloLinkStatus,
        zaloName: rawResult.created_by_zaloName,
        avatarZalo: rawResult.created_by_avatarZalo,
        zaloGender: rawResult.created_by_zaloGender,
        lastOnlineAt: rawResult.created_by_lastOnlineAt,
      } as any,
      customer_count: customers.length,
      messages: {
        type: 'initial' as const,
        text: initialMessage?.text || '',
        attachment: initialMessage?.attachment || null,
      },
      schedule_config: {
        type: scheduleConfig.type || 'hourly',
        start_time: scheduleConfig.start_time,
        end_time: scheduleConfig.end_time,
        remind_after_minutes: scheduleConfig.remind_after_minutes,
        days_of_week: scheduleConfig.days_of_week,
        day_of_week: scheduleConfig.day_of_week,
        time_of_day: scheduleConfig.time_of_day,
      },
      reminders: reminderMessages.map((reminder: any) => ({
        content: reminder.text,
        minutes: reminder.offset_minutes,
      })),
      email_reports: rawResult.email_recipient_to
        ? {
            recipients_to: rawResult.email_recipient_to,
            recipients_cc: rawResult.email_recipients_cc,
            report_interval_minutes: rawResult.email_report_interval_minutes,
            stop_sending_at_time: rawResult.email_stop_sending_at_time,
            is_active: rawResult.email_is_active,
            send_when_campaign_completed:
              rawResult.email_send_when_campaign_completed,
          }
        : undefined,
      customers: customers.map((map) => ({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.full_name,
        salutation: map.salutation,
      })),
      start_date,
      end_date,
    };

    return campaignWithDetails;
  }

  async create(data: any, user: User): Promise<CampaignWithDetails> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy department
      let department: Department | undefined;
      if (data.department_id) {
        const foundDepartment = await queryRunner.manager.findOne(Department, {
          where: { id: Number(data.department_id) },
        });
        department = foundDepartment === null ? undefined : foundDepartment;
        if (!department) {
          throw new BadRequestException('Phòng ban không tồn tại');
        }
      } else {
        // Lấy phòng ban đầu tiên của user có server_ip khác NULL
        department = user.departments?.find(
          (dept: Department) => !!dept.server_ip,
        );
        if (!department) {
          throw new BadRequestException(
            'Người dùng phải thuộc về một phòng ban có server_ip',
          );
        }
      }

      // 2. Lấy created_by
      let createdBy: User;
      if (data.created_by) {
        const foundUser = await queryRunner.manager.findOne(User, {
          where: { id: Number(data.created_by) },
        });
        if (!foundUser) {
          throw new BadRequestException('Người tạo không tồn tại');
        }
        createdBy = foundUser;
      } else {
        createdBy = user;
      }

      // 3. Tạo campaign chính
      const campaign = queryRunner.manager.create(Campaign, {
        name: data.name,
        campaign_type: data.campaign_type,
        status: data.status || CampaignStatus.DRAFT,
        send_method: data.send_method,
        department: department,
        created_by: createdBy,
      });

      const savedCampaign = await queryRunner.manager.save(Campaign, campaign);

      // 4. Tạo campaign content (messages)
      if (data.messages) {
        let messages: PromoMessageFlow;

        // Thêm reminders vào messages
        if (data.reminders && Array.isArray(data.reminders)) {
          const reminderMessages: ReminderMessage[] = data.reminders.map(
            (reminder: any) => ({
              type: 'reminder' as const,
              offset_minutes: reminder.minutes,
              text: reminder.content,
              attachment: null,
            }),
          );
          messages = [data.messages, ...reminderMessages] as PromoMessageFlow;
        } else {
          messages = [data.messages] as PromoMessageFlow;
        }

        const campaignContent = queryRunner.manager.create(CampaignContent, {
          campaign: savedCampaign,
          messages: messages,
        });

        await queryRunner.manager.save(CampaignContent, campaignContent);
      }

      // 5. Tạo campaign schedule
      if (data.schedule_config) {
        const campaignSchedule = queryRunner.manager.create(CampaignSchedule, {
          campaign: savedCampaign,
          schedule_config: data.schedule_config,
          is_active: true,
        });

        await queryRunner.manager.save(CampaignSchedule, campaignSchedule);
      }

      // 6. Tạo email reports
      if (data.email_reports) {
        const campaignEmailReport = queryRunner.manager.create(
          CampaignEmailReport,
          {
            campaign: savedCampaign,
            recipient_to: data.email_reports.recipients_to,
            recipients_cc: data.email_reports.recipients_cc,
            report_interval_minutes: data.email_reports.report_interval_minutes,
            stop_sending_at_time: data.email_reports.stop_sending_at_time,
            is_active: data.email_reports.is_active,
            send_when_campaign_completed:
              data.email_reports.send_when_campaign_completed,
          },
        );

        await queryRunner.manager.save(
          CampaignEmailReport,
          campaignEmailReport,
        );
      }

      // 7. Tạo customers và mapping
      if (data.customers && Array.isArray(data.customers)) {
        for (const customerData of data.customers) {
          // Kiểm tra customer đã tồn tại chưa
          let customer = await queryRunner.manager.findOne(CampaignCustomer, {
            where: { phone_number: customerData.phone_number },
          });

          // Nếu chưa tồn tại thì tạo mới
          if (!customer) {
            customer = queryRunner.manager.create(CampaignCustomer, {
              phone_number: customerData.phone_number,
              // Bỏ full_name và salutation ở đây
            });
            customer = await queryRunner.manager.save(
              CampaignCustomer,
              customer,
            );
          }

          // Tạo mapping với full_name và salutation
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(savedCampaign.id),
            customer_id: Number(customer.id),
            full_name: customerData.full_name, // Lưu vào map
            salutation: customerData.salutation, // Lưu vào map
            campaign: savedCampaign,
            campaign_customer: customer,
          });
          await queryRunner.manager.save(CampaignCustomerMap, customerMap);
        }
      }

      await queryRunner.commitTransaction();

      // Trả về campaign với đầy đủ thông tin
      return await this.findOne(savedCampaign.id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(
    id: string,
    data: any,
    user: User,
  ): Promise<CampaignWithDetails> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Kiểm tra quyền truy cập trước khi update
      const campaign = await this.checkCampaignAccess(id, user);

      // ✅ 2. KIỂM TRA TRẠNG THÁI - CHỈ CHO PHÉP SỬA DRAFT VÀ PAUSED
      if (
        ![CampaignStatus.DRAFT, CampaignStatus.PAUSED].includes(campaign.status)
      ) {
        throw new BadRequestException(
          `Không thể chỉnh sửa chiến dịch ở trạng thái ${campaign.status}. Chỉ có thể sửa chiến dịch ở trạng thái bản nháp hoặc tạm dừng.`,
        );
      }

      // 3. Lấy campaign hiện tại (đã được verify quyền)
      const existingCampaign = await this.findOne(id, user);

      // 4. Cập nhật campaign chính
      const updatedCampaign = await queryRunner.manager.save(Campaign, {
        ...existingCampaign,
        name: data.name || existingCampaign.name,
        campaign_type: data.campaign_type || existingCampaign.campaign_type,
        status: data.status || existingCampaign.status,
        send_method: data.send_method || existingCampaign.send_method,
      });

      // 5. Cập nhật campaign content (messages)
      if (data.messages) {
        // Xóa content cũ
        await queryRunner.manager.delete(CampaignContent, { campaign: { id } });

        let messages: PromoMessageFlow;

        // Thêm reminders vào messages
        if (data.reminders && Array.isArray(data.reminders)) {
          const reminderMessages: ReminderMessage[] = data.reminders.map(
            (reminder: any) => ({
              type: 'reminder' as const,
              offset_minutes: reminder.minutes,
              text: reminder.content,
              attachment: null,
            }),
          );

          messages = [data.messages, ...reminderMessages] as PromoMessageFlow;
        } else {
          messages = [data.messages] as PromoMessageFlow;
        }

        const campaignContent = queryRunner.manager.create(CampaignContent, {
          campaign: updatedCampaign,
          messages: messages,
        });

        await queryRunner.manager.save(CampaignContent, campaignContent);
      }

      // 6. Cập nhật campaign schedule
      if (data.schedule_config) {
        // Xóa schedule cũ
        await queryRunner.manager.delete(CampaignSchedule, {
          campaign: { id },
        });

        const campaignSchedule = queryRunner.manager.create(CampaignSchedule, {
          campaign: updatedCampaign,
          schedule_config: data.schedule_config,
          is_active: true,
        });

        await queryRunner.manager.save(CampaignSchedule, campaignSchedule);
      }

      // 7. ✅ Cập nhật email reports - BẢO TOÀN is_active và last_sent_at
      if (data.email_reports) {
        // Tìm email report hiện tại trước khi xóa/tạo mới
        const existingEmailReport = await queryRunner.manager.findOne(
          CampaignEmailReport,
          {
            where: { campaign: { id: String(id) } },
            select: {
              id: true,
              is_active: true,
              last_sent_at: true,
            },
          },
        );

        if (existingEmailReport) {
          // ✅ Nếu đã tồn tại, chỉ update các field cho phép
          await queryRunner.manager.update(
            CampaignEmailReport,
            existingEmailReport.id,
            {
              recipient_to: data.email_reports.recipients_to,
              recipients_cc: data.email_reports.recipients_cc,
              report_interval_minutes:
                data.email_reports.report_interval_minutes,
              stop_sending_at_time: data.email_reports.stop_sending_at_time,
              send_when_campaign_completed:
                data.email_reports.send_when_campaign_completed,
              // ✅ KHÔNG update is_active và last_sent_at - bảo toàn giá trị cũ
              // updated_at sẽ tự động update do @UpdateDateColumn
            },
          );
        } else {
          // ✅ Nếu chưa tồn tại, tạo mới với giá trị từ data
          const campaignEmailReport = queryRunner.manager.create(
            CampaignEmailReport,
            {
              campaign: updatedCampaign,
              recipient_to: data.email_reports.recipients_to,
              recipients_cc: data.email_reports.recipients_cc,
              report_interval_minutes:
                data.email_reports.report_interval_minutes,
              stop_sending_at_time: data.email_reports.stop_sending_at_time,
              is_active: data.email_reports.is_active ?? true, // Giá trị mặc định cho record mới
              send_when_campaign_completed:
                data.email_reports.send_when_campaign_completed,
              // last_sent_at sẽ là undefined theo entity definition
            },
          );

          await queryRunner.manager.save(
            CampaignEmailReport,
            campaignEmailReport,
          );
        }
      }

      // 8. Cập nhật customers và mapping
      if (data.customers && Array.isArray(data.customers)) {
        // Xóa mappings cũ
        await queryRunner.manager.delete(CampaignCustomerMap, {
          campaign: { id },
        });

        for (const customerData of data.customers) {
          let customer = await queryRunner.manager.findOne(CampaignCustomer, {
            where: { phone_number: customerData.phone_number },
          });

          if (!customer) {
            customer = queryRunner.manager.create(CampaignCustomer, {
              phone_number: customerData.phone_number,
              // Bỏ full_name và salutation
            });
            customer = await queryRunner.manager.save(
              CampaignCustomer,
              customer,
            );
          }

          // Tạo mapping mới với full_name và salutation
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(id),
            customer_id: Number(customer.id),
            full_name: customerData.full_name,
            salutation: customerData.salutation,
            campaign: updatedCampaign,
            campaign_customer: customer,
          });
          await queryRunner.manager.save(CampaignCustomerMap, customerMap);
        }
      }

      await queryRunner.commitTransaction();

      // Trả về campaign đã được cập nhật
      return await this.findOne(id, user);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async updateStatus(
    id: string,
    status: CampaignStatus,
    user: User,
  ): Promise<CampaignWithDetails> {
    // Kiểm tra quyền truy cập và lấy campaign
    const campaign = await this.checkCampaignAccess(id, user);

    // Validate status transitions
    this.validateStatusTransition(campaign.status, status);

    // Update campaign status
    await this.campaignRepository.update(id, { status });

    // Return updated campaign with full details
    return await this.findOne(id, user);
  }

  async delete(id: string, user: User): Promise<void> {
    // Kiểm tra quyền truy cập
    const campaign = await this.checkCampaignAccess(id, user);

    // ✅ CHỈ CHO PHÉP XÓA CAMPAIGN Ở TRẠNG THÁI DRAFT
    if (campaign.status !== CampaignStatus.DRAFT) {
      throw new BadRequestException(
        `Không thể xóa chiến dịch ở trạng thái ${campaign.status}. Chỉ có thể xóa chiến dịch ở trạng thái bản nháp.`,
      );
    }

    // Xóa mềm (soft delete)
    await this.campaignRepository.softRemove(campaign);
  }

  async archive(id: string, user: User): Promise<CampaignWithDetails> {
    // Kiểm tra quyền truy cập trước khi archive
    const campaign = await this.checkCampaignAccess(id, user);

    // ✅ CHỈ CHO PHÉP ARCHIVE CAMPAIGN Ở TRẠNG THÁI COMPLETED
    if (campaign.status !== CampaignStatus.COMPLETED) {
      throw new BadRequestException(
        `Không thể lưu trữ chiến dịch ở trạng thái ${campaign.status}. Chỉ có thể lưu trữ chiến dịch đã hoàn thành.`,
      );
    }

    return this.updateStatus(id, CampaignStatus.ARCHIVED, user);
  }

  private validateStatusTransition(
    currentStatus: CampaignStatus,
    newStatus: CampaignStatus,
  ): void {
    // ✅ LOGIC MỚI - PHÙ HỢP VỚI BOT PYTHON TỰ ĐỘNG XỬ LÝ
    const validTransitions: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED], // Chỉ chuyển thành đã lên lịch
      [CampaignStatus.SCHEDULED]: [CampaignStatus.DRAFT], // Chỉ chuyển về bản nháp (không chuyển thành đang chạy)
      [CampaignStatus.RUNNING]: [CampaignStatus.PAUSED], // Chỉ tạm dừng (không chuyển thành hoàn thành - bot Python sẽ làm)
      [CampaignStatus.PAUSED]: [CampaignStatus.RUNNING], // Chỉ chạy lại
      [CampaignStatus.COMPLETED]: [CampaignStatus.ARCHIVED], // Chỉ lưu trữ
      [CampaignStatus.ARCHIVED]: [], // Không thể chuyển từ ARCHIVED
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển từ trạng thái ${currentStatus} sang ${newStatus}. ` +
          `Bot Python sẽ tự động xử lý một số chuyển đổi trạng thái.`,
      );
    }
  }

  async getStats(user: User): Promise<any> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );
    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by');

    if (isAdmin) {
      // Admin: thống kê tất cả campaign
    } else if (isManager) {
      // Manager: thống kê campaign của phòng ban có server_ip
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department.id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        // Nếu manager không có department với server_ip thì không thống kê gì
        qb.andWhere('1 = 0');
      }
    } else {
      // User thường: chỉ thống kê campaign do chính họ tạo
      qb.andWhere('campaign.created_by.id = :userId', {
        userId: user.id,
      });
    }

    const [
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
      archivedCampaigns,
      scheduledCampaigns,
    ] = await Promise.all([
      qb.getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', { status: CampaignStatus.DRAFT })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.RUNNING,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.COMPLETED,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.ARCHIVED,
        })
        .getCount(),
      qb
        .clone()
        .andWhere('campaign.status = :status', {
          status: CampaignStatus.SCHEDULED,
        })
        .getCount(),
    ]);

    return {
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
      archivedCampaigns,
      scheduledCampaigns,
    };
  }

  async getCampaignCustomers(campaignId: string, query: any = {}, user: User) {
    // Kiểm tra quyền truy cập campaign
    await this.checkCampaignAccess(campaignId, user);

    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoin('map.campaign_customer', 'customer')
      .leftJoin('map.campaign', 'campaign')
      .leftJoin(
        'campaign_interaction_logs',
        'log',
        'log.customer_id = customer.id AND log.campaign_id = map.campaign_id',
      )
      .select([
        'map.campaign_id as campaign_id',
        'map.customer_id as customer_id',
        'map.full_name as full_name',
        'map.salutation as salutation',
        'map.added_at as added_at',
        'customer.id as customer_id',
        'customer.phone_number as phone_number',
        'customer.created_at as customer_created_at',
        'customer.updated_at as customer_updated_at',
        'log.status as interaction_status',
        'log.conversation_metadata as conversation_metadata',
        'log.sent_at as sent_at',
      ])
      .where('map.campaign_id = :campaignId', { campaignId });

    // Filter by search
    if (query.search) {
      qb.andWhere(
        '(map.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    // Filter by status
    if (query.status) {
      qb.andWhere('log.status = :status', {
        status: query.status,
      });
    }

    // Sắp xếp theo sent_at để đảm bảo thứ tự đúng
    qb.orderBy('map.added_at', 'DESC').addOrderBy('log.sent_at', 'ASC');

    // Count query for pagination - đếm số customer unique, không phải số log
    const countQb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoin('map.campaign_customer', 'customer')
      .select('COUNT(DISTINCT map.customer_id)', 'count')
      .where('map.campaign_id = :campaignId', { campaignId });

    // Apply same filters to count query
    if (query.search) {
      countQb.andWhere(
        '(map.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    if (query.status) {
      countQb.leftJoin(
        'campaign_interaction_logs',
        'log',
        'log.customer_id = customer.id AND log.campaign_id = map.campaign_id',
      );
      countQb.andWhere('log.status = :status', {
        status: query.status,
      });
    }

    // Lấy tất cả raw results trước
    const rawResults = await qb.getRawMany();

    // Define interface for grouped data
    interface GroupedCustomer {
      id: string;
      phone_number: string;
      full_name: string;
      salutation: string;
      created_at: Date;
      updated_at: Date;
      added_at: Date;
      logs: Array<{
        status: string;
        conversation_metadata: any;
        sent_at: Date;
      }>;
    }

    // Group theo customer_id và sắp xếp logs theo sent_at
    const groupedData: Record<string, GroupedCustomer> = rawResults.reduce(
      (acc, row) => {
        const customerId = row.customer_id;

        if (!acc[customerId]) {
          acc[customerId] = {
            id: row.customer_id,
            phone_number: row.phone_number,
            full_name: row.full_name,
            salutation: row.salutation,
            created_at: row.customer_created_at,
            updated_at: row.customer_updated_at,
            added_at: row.added_at,
            logs: [],
          };
        }

        // Chỉ thêm log nếu có dữ liệu log
        if (row.sent_at) {
          acc[customerId].logs.push({
            status: row.interaction_status,
            conversation_metadata: row.conversation_metadata,
            sent_at: new Date(row.sent_at),
          });
        }

        return acc;
      },
      {},
    );

    // Convert thành array và tạo một entry cho mỗi log
    const expandedResults: any[] = [];
    Object.values(groupedData).forEach((customer: GroupedCustomer) => {
      if (customer.logs.length > 0) {
        // Sắp xếp logs theo sent_at
        customer.logs.sort((a, b) => a.sent_at.getTime() - b.sent_at.getTime());

        // Tạo một entry cho mỗi log
        customer.logs.forEach((log) => {
          expandedResults.push({
            id: customer.id,
            phone_number: customer.phone_number,
            full_name: customer.full_name,
            salutation: customer.salutation,
            created_at: customer.created_at,
            updated_at: customer.updated_at,
            added_at: customer.added_at,
            status: log.status,
            conversation_metadata: log.conversation_metadata,
            sent_at: log.sent_at,
          });
        });
      } else {
        // Customer không có log
        expandedResults.push({
          id: customer.id,
          phone_number: customer.phone_number,
          full_name: customer.full_name,
          salutation: customer.salutation,
          created_at: customer.created_at,
          updated_at: customer.updated_at,
          added_at: customer.added_at,
          status: null,
          conversation_metadata: null,
          sent_at: null,
        });
      }
    });

    // Pagination trên kết quả đã expand
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const skip = (page - 1) * limit;

    const paginatedResults = expandedResults.slice(skip, skip + limit);

    // Lấy total count
    const countResult = await countQb.getRawOne();
    const total = parseInt(countResult.count) || 0;

    return {
      data: paginatedResults,
      total: expandedResults.length, // Total số entries (bao gồm cả multiple logs)
      page,
      limit,
    };
  }

  async exportCustomers(campaignId: string, query: any = {}, user: User) {
    // Kiểm tra quyền truy cập campaign - thay thế việc gọi findOne
    await this.checkCampaignAccess(campaignId, user);

    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id = :campaignId', { campaignId });

    // Apply filters
    if (query.search) {
      qb.andWhere(
        '(customer.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    if (query.status) {
      qb.leftJoin('customer.logs', 'log').andWhere('log.status = :status', {
        status: query.status,
      });
    }

    qb.orderBy('map.added_at', 'DESC');

    const customers = await qb.getMany();

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Khách hàng');

    // Add headers
    worksheet.columns = [
      { header: 'Số điện thoại', key: 'phone_number', width: 15 },
      { header: 'Họ tên', key: 'full_name', width: 25 },
      { header: 'Xưng hô', key: 'salutation', width: 10 },
      { header: 'Ngày thêm', key: 'added_at', width: 20 },
    ];

    // Add data
    customers.forEach((map) => {
      worksheet.addRow({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.full_name,
        salutation: map.salutation || '',
        added_at: map.added_at.toLocaleDateString('vi-VN'),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const { Readable } = require('stream');
    return Readable.from(buffer);
  }

  async getCustomerLogs(
    campaignId: string,
    customerId: string,
    user: User,
    sentDate?: string, // Thêm parameter này
  ) {
    // Kiểm tra quyền truy cập campaign
    await this.checkCampaignAccess(campaignId, user);

    let query = this.campaignLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.campaign', 'campaign')
      .leftJoinAndSelect('log.customer', 'customer')
      .leftJoinAndSelect('log.staff_handler', 'staff_handler')
      .addSelect('staff_handler.avatar_zalo', 'staff_avatar_zalo')
      .where('log.campaign_id = :campaignId', { campaignId })
      .andWhere('log.customer_id = :customerId', { customerId });

    // 🔥 THÊM ĐIỀU KIỆN SENT_AT
    if (sentDate) {
      // Chuyển sent_date thành range của ngày đó
      const startOfDay = `${sentDate} 00:00:00`;
      const endOfDay = `${sentDate} 23:59:59`;

      query = query
        .andWhere('log.sent_at >= :startOfDay', { startOfDay })
        .andWhere('log.sent_at <= :endOfDay', { endOfDay });
    }

    const rawLogs = await query
      .orderBy('log.sent_at', 'DESC')
      .getRawAndEntities();

    // Map để thêm avatar_zalo vào response
    return rawLogs.entities.map((log, index) => ({
      ...log,
      staff_handler_avatar_zalo: rawLogs.raw[index]?.staff_avatar_zalo || null,
    }));
  }

  async updateCampaignCustomer(
    campaignId: string,
    customerId: string,
    data: CustomerDto,
    user: User,
  ): Promise<{ success: boolean; message: string }> {
    const queryRunner =
      this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Kiểm tra quyền truy cập campaign
      const campaign = await this.checkCampaignAccess(campaignId, user);

      // 2. Kiểm tra campaign phải ở trạng thái DRAFT
      if (campaign.status !== CampaignStatus.DRAFT) {
        throw new BadRequestException(
          'Chỉ có thể chỉnh sửa khách hàng trong chiến dịch ở trạng thái bản nháp',
        );
      }

      // 3. Kiểm tra customer mapping tồn tại
      const customerMap = await queryRunner.manager.findOne(
        CampaignCustomerMap,
        {
          where: {
            campaign_id: Number(campaignId),
            customer_id: Number(customerId),
          },
          relations: ['campaign_customer'],
        },
      );

      if (!customerMap) {
        throw new NotFoundException(
          'Không tìm thấy khách hàng trong chiến dịch này',
        );
      }

      // 4. Kiểm tra số điện thoại mới có trùng với customer khác không
      if (data.phone_number !== customerMap.campaign_customer.phone_number) {
        const existingCustomer = await queryRunner.manager.findOne(
          CampaignCustomer,
          {
            where: { phone_number: data.phone_number.trim() },
          },
        );

        if (
          existingCustomer &&
          existingCustomer.id !== customerMap.campaign_customer.id
        ) {
          throw new BadRequestException(
            'Số điện thoại này đã tồn tại trong hệ thống',
          );
        }
      }

      // 5. Cập nhật thông tin customer
      await queryRunner.manager.update(
        CampaignCustomer,
        customerMap.campaign_customer.id,
        {
          phone_number: data.phone_number.trim(),
        },
      );

      // 6. Cập nhật thông tin mapping
      await queryRunner.manager.update(
        CampaignCustomerMap,
        {
          campaign_id: Number(campaignId),
          customer_id: Number(customerId),
        },
        {
          full_name: data.full_name.trim(),
          salutation: data.salutation?.trim() || undefined,
        },
      );

      await queryRunner.commitTransaction();

      return {
        success: true,
        message: 'Cập nhật thông tin khách hàng thành công',
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAllArchived(
    query: any = {},
    user: User,
  ): Promise<CampaignResponse> {
    const roleNames = (user?.roles || []).map((r: any) =>
      typeof r === 'string'
        ? r.toLowerCase()
        : (r.code || r.name || '').toLowerCase(),
    );

    const isAdmin = roleNames.includes('admin');
    const isManager = roleNames.includes('manager-chien-dich');

    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      .leftJoin(
        'campaign_contents',
        'content',
        'content.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_schedules',
        'schedule',
        'schedule.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_email_reports',
        'email_report',
        'email_report.campaign_id = campaign.id',
      )
      .leftJoin(
        'campaign_customer_map',
        'customer_map',
        'customer_map.campaign_id = campaign.id',
      )
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('schedule.start_date', 'schedule_start_date')
      .addSelect('schedule.end_date', 'schedule_end_date')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect(
        'email_report.report_interval_minutes',
        'email_report_interval_minutes',
      )
      .addSelect(
        'email_report.stop_sending_at_time',
        'email_stop_sending_at_time',
      )
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect(
        'email_report.send_when_campaign_completed',
        'email_send_when_campaign_completed',
      )
      .addSelect('COUNT(DISTINCT customer_map.customer_id)', 'customer_count')
      .groupBy('campaign.id, created_by.id, department.id')
      // ✅ CHỈ LẤY CÁC CAMPAIGN ARCHIVED
      .where('campaign.status = :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply user-based filtering first
    if (isAdmin) {
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) =>
          dept.server_ip !== null &&
          dept.server_ip !== undefined &&
          String(dept.server_ip).trim() !== '',
      );

      if (userDepartment) {
        qb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        qb.andWhere('1 = 0');
      }
    } else {
      qb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply search filter
    if (query.search && query.search.trim()) {
      qb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    // Apply campaign types filter - Handle both string and array
    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    // Apply single date filter
    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      qb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    // Apply employee filter - Handle both string and array
    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          qb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        qb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    const rawResults = await qb.getRawMany();

    // Count query with same logic
    const countQb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department')
      .leftJoin('campaign.created_by', 'created_by')
      // ✅ CHỈ ĐẾM CÁC CAMPAIGN ARCHIVED
      .where('campaign.status = :archivedStatus', {
        archivedStatus: 'archived',
      });

    // Apply same user-based filtering for count
    if (isAdmin) {
      // Admin: lấy tất cả
    } else if (isManager) {
      const userDepartment = user.departments?.find(
        (dept: any) => dept.server_ip && dept.server_ip.trim() !== '',
      );

      if (userDepartment) {
        countQb.andWhere('campaign.department_id = :deptId', {
          deptId: userDepartment.id,
        });
      } else {
        countQb.andWhere('1 = 0');
      }
    } else {
      countQb.andWhere('campaign.created_by_id = :userId', {
        userId: user.id,
      });
    }

    // Apply same filters for count
    if (query.search && query.search.trim()) {
      countQb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    }

    if (query.campaign_types) {
      const typeInput = Array.isArray(query.campaign_types)
        ? query.campaign_types
        : [query.campaign_types];
      const validTypes = typeInput.filter((t) => t && String(t).trim());

      if (validTypes.length > 0) {
        countQb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
          campaignTypes: validTypes,
        });
      }
    }

    if (query.singleDate) {
      const date = new Date(query.singleDate);
      const startOfDay = new Date(date.setHours(0, 0, 0, 0));
      const endOfDay = new Date(date.setHours(23, 59, 59, 999));
      countQb.andWhere('campaign.created_at BETWEEN :startDate AND :endDate', {
        startDate: startOfDay,
        endDate: endOfDay,
      });
    }

    if (query.departments && isAdmin) {
      const departmentInput = Array.isArray(query.departments)
        ? query.departments
        : [query.departments];

      const departmentIds = departmentInput
        .map((id) => parseInt(String(id), 10))
        .filter((id) => !isNaN(id));

      if (departmentIds.length > 0) {
        countQb.andWhere('department.id IN (:...departments)', {
          departments: departmentIds,
        });
      }
    }

    if (query.employees) {
      if (isAdmin || isManager) {
        const employeeInput = Array.isArray(query.employees)
          ? query.employees
          : [query.employees];
        const employeeIds = employeeInput
          .map((id) => parseInt(String(id), 10))
          .filter((id) => !isNaN(id));

        if (employeeIds.length > 0) {
          countQb.andWhere('campaign.created_by_id IN (:...employees)', {
            employees: employeeIds,
          });
        }
      }
    }

    const total = await countQb.getCount();

    // Process data same as findAll method
    const campaignIds = rawResults.map((result) => result.campaign_id);

    const allCustomerMaps =
      campaignIds.length > 0
        ? await this.campaignCustomerMapRepository
            .createQueryBuilder('map')
            .leftJoinAndSelect('map.campaign_customer', 'customer')
            .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
            .getMany()
        : [];

    const customersByCampaign = allCustomerMaps.reduce(
      (acc, map) => {
        if (!acc[map.campaign_id]) acc[map.campaign_id] = [];
        acc[map.campaign_id].push({
          phone_number: map.campaign_customer.phone_number,
          full_name: map.full_name,
          salutation: map.salutation,
        });
        return acc;
      },
      {} as Record<
        string,
        Array<{
          phone_number: string;
          full_name: string;
          salutation?: string;
        }>
      >,
    );

    const data: CampaignWithDetails[] = rawResults.map((result: any) => {
      const messages = result.content_messages || [];
      const initialMessage = Array.isArray(messages)
        ? messages.find((msg) => msg.type === 'initial') || messages[0]
        : null;

      const reminderMessages = Array.isArray(messages)
        ? messages.filter((msg) => msg.type === 'reminder')
        : [];

      const scheduleConfig = result.schedule_config || {};

      let start_date: string | undefined = undefined;
      let end_date: string | undefined = undefined;

      if (result.schedule_start_date) {
        start_date =
          result.schedule_start_date instanceof Date
            ? result.schedule_start_date.toISOString()
            : result.schedule_start_date;
      }

      if (result.schedule_end_date) {
        end_date =
          result.schedule_end_date instanceof Date
            ? result.schedule_end_date.toISOString()
            : result.schedule_end_date;
      }

      return {
        id: result.campaign_id,
        name: result.campaign_name,
        campaign_type: result.campaign_campaign_type,
        status: result.campaign_status,
        send_method: result.campaign_send_method,
        created_at: result.campaign_created_at,
        updated_at: result.campaign_updated_at,
        department: {
          id: result.department_id,
          name: result.department_name,
          slug: result.department_slug,
          server_ip: result.department_server_ip,
          createdAt: result.department_createdAt,
          updatedAt: result.department_updatedAt,
          deletedAt: result.department_deletedAt,
        },
        created_by: {
          id: result.created_by_id,
          username: result.created_by_username,
          fullName: result.created_by_fullName,
          email: result.created_by_email,
          isBlock: result.created_by_isBlock,
          employeeCode: result.created_by_employeeCode,
          status: result.created_by_status,
          lastLogin: result.created_by_lastLogin,
          nickName: result.created_by_nickName,
          deletedAt: result.created_by_deletedAt,
          createdAt: result.created_by_createdAt,
          updatedAt: result.created_by_updatedAt,
          zaloLinkStatus: result.created_by_zaloLinkStatus,
          zaloName: result.created_by_zaloName,
          avatarZalo: result.created_by_avatarZalo,
          zaloGender: result.created_by_zaloGender,
          lastOnlineAt: result.created_by_lastOnlineAt,
        } as any,
        customer_count: customersByCampaign[result.campaign_id]?.length || 0,
        messages: {
          type: 'initial' as const,
          text: initialMessage?.text || '',
          attachment: initialMessage?.attachment || null,
        },
        schedule_config: {
          type: scheduleConfig.type || 'hourly',
          start_time: scheduleConfig.start_time,
          end_time: scheduleConfig.end_time,
          remind_after_minutes: scheduleConfig.remind_after_minutes,
          days_of_week: scheduleConfig.days_of_week,
          day_of_week: scheduleConfig.day_of_week,
          time_of_day: scheduleConfig.time_of_day,
        },
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text,
          minutes: reminder.offset_minutes,
        })),
        email_reports: result.email_recipient_to
          ? {
              recipients_to: result.email_recipient_to,
              recipients_cc: result.email_recipients_cc,
              report_interval_minutes: result.email_report_interval_minutes,
              stop_sending_at_time: result.email_stop_sending_at_time,
              is_active: result.email_is_active,
              send_when_campaign_completed:
                result.email_send_when_campaign_completed,
            }
          : undefined,
        customers: customersByCampaign[result.campaign_id] || [],
        start_date,
        end_date,
      } as CampaignWithDetails;
    });

    // Generate stats for archived campaigns only
    const stats = {
      totalCampaigns: total,
      draftCampaigns: 0,
      runningCampaigns: 0,
      completedCampaigns: 0,
      scheduledCampaigns: 0,
      archivedCampaigns: total,
    };

    return { data, total, stats };
  }

  async getCopyData(id: string, user: User): Promise<CreateCampaignDto> {
    // Tìm campaign với full data
    const campaign = await this.findOne(id, user);

    if (!campaign) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // ✅ SỬA: Chuyển campaign_id thành số
    const campaignIdNum = parseInt(id, 10);

    // ✅ SỬA: Sử dụng relation thay vì campaign_id trực tiếp
    const content = await this.campaignContentRepository
      .createQueryBuilder('content')
      .innerJoin('content.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    const schedule = await this.campaignScheduleRepository
      .createQueryBuilder('schedule')
      .innerJoin('schedule.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    const emailReport = await this.campaignEmailReportRepository
      .createQueryBuilder('email_report')
      .innerJoin('email_report.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId: campaignIdNum })
      .getOne();

    // Lấy danh sách customers
    const customerMaps = await this.campaignCustomerMapRepository.find({
      where: { campaign_id: campaignIdNum }, // ✅ OK: campaign_id là number trong entity
      relations: ['campaign_customer'],
    });

    // ✅ SỬA: Helper function để xử lý date an toàn
    const formatDateToISO = (date: any): string | undefined => {
      if (!date) return undefined;

      // Nếu đã là string thì return luôn
      if (typeof date === 'string') {
        // Validate xem có phải ISO string không
        const dateObj = new Date(date);
        return isNaN(dateObj.getTime()) ? undefined : date;
      }

      // Nếu là Date object thì convert
      if (date instanceof Date && !isNaN(date.getTime())) {
        return date.toISOString();
      }

      return undefined;
    };

    // ✅ SỬA: Xử lý schedule_config với proper type checking
    const createValidScheduleConfig = (
      scheduleConfig: any,
    ): ScheduleConfigDto => {
      // Default config cho trường hợp không có data hoặc data không hợp lệ
      const defaultConfig: ScheduleConfigDto = {
        type: 'hourly',
        start_time: undefined,
        end_time: undefined,
        remind_after_minutes: undefined,
        days_of_week: undefined,
        day_of_week: undefined,
        time_of_day: undefined,
      };

      if (!scheduleConfig || typeof scheduleConfig !== 'object') {
        return defaultConfig;
      }

      // Validate type field
      const validTypes = ['hourly', '3_day', 'weekly'];
      const type = validTypes.includes(scheduleConfig.type)
        ? scheduleConfig.type
        : 'hourly';

      return {
        type: type as 'hourly' | '3_day' | 'weekly',
        start_time: scheduleConfig.start_time || undefined,
        end_time: scheduleConfig.end_time || undefined,
        remind_after_minutes:
          typeof scheduleConfig.remind_after_minutes === 'number'
            ? scheduleConfig.remind_after_minutes
            : undefined,
        days_of_week: Array.isArray(scheduleConfig.days_of_week)
          ? scheduleConfig.days_of_week
          : undefined,
        day_of_week:
          typeof scheduleConfig.day_of_week === 'number'
            ? scheduleConfig.day_of_week
            : undefined,
        time_of_day: scheduleConfig.time_of_day || undefined,
      };
    };

    // ✅ SỬA: Process messages để extract initial message và reminders
    const processMessages = (messages: any) => {
      if (!Array.isArray(messages) || messages.length === 0) {
        return {
          initialMessage: undefined,
          reminders: [],
        };
      }

      const initialMessage = messages.find(
        (msg: any) => msg.type === 'initial',
      );
      const reminderMessages = messages.filter(
        (msg: any) => msg.type === 'reminder',
      );

      return {
        initialMessage,
        reminders: reminderMessages.map((reminder: any) => ({
          content: reminder.text || '',
          minutes: reminder.offset_minutes || 0,
        })),
      };
    };

    // Process messages
    const { initialMessage, reminders } = processMessages(content?.messages);

    // Process schedule config
    const validScheduleConfig = createValidScheduleConfig(
      schedule?.schedule_config,
    );

    // ✅ SỬA: Format data theo CreateCampaignDto với proper type handling
    const copyData: CreateCampaignDto = {
      name: `Copy of ${campaign.name}`, // Thêm prefix "Copy of"
      campaign_type: campaign.campaign_type,
      send_method: campaign.send_method,
      department_id: String(campaign.department.id), // ✅ Convert number to string

      // Content data - chỉ gửi initial message
      messages: initialMessage || undefined,

      // Schedule data với proper type checking
      schedule_config: validScheduleConfig,
      start_date: formatDateToISO(schedule?.start_date),
      end_date: formatDateToISO(schedule?.end_date),

      // Reminders được extract từ messages
      reminders: reminders.length > 0 ? reminders : undefined,

      // Email report data với proper validation
      email_reports: emailReport
        ? {
            recipients_to: emailReport.recipient_to,
            recipients_cc: Array.isArray(emailReport.recipients_cc)
              ? emailReport.recipients_cc
              : [],
            report_interval_minutes:
              typeof emailReport.report_interval_minutes === 'number'
                ? emailReport.report_interval_minutes
                : undefined,
            stop_sending_at_time: emailReport.stop_sending_at_time || undefined,
            is_active: Boolean(emailReport.is_active),
            send_when_campaign_completed: Boolean(
              emailReport.send_when_campaign_completed,
            ),
          }
        : undefined,

      // Customer data với validation
      customers:
        customerMaps.length > 0
          ? customerMaps.map((map) => ({
              phone_number: map.campaign_customer.phone_number,
              full_name: map.full_name,
              salutation: map.salutation || undefined,
            }))
          : undefined,
    };

    return copyData;
  }

  async exportCampaignSummary(campaignId: string, user: User) {
    // Kiểm tra quyền truy cập campaign
    const campaign = await this.checkCampaignAccess(campaignId, user);

    // ✅ SỬA: Lấy campaign với join User entity đúng cách
    const campaignWithCreator = await this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'creator')
      .leftJoinAndSelect('campaign.department', 'department')
      .where('campaign.id = :campaignId', { campaignId })
      .getOne();

    if (!campaignWithCreator) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Lấy thống kê khách hàng theo status
    const customerStats = await this.getCampaignCustomerStats(campaignId);

    // Lấy chi tiết tất cả khách hàng và logs
    const customersWithLogs =
      await this.getCampaignCustomersWithLogs(campaignId);

    // Tạo Excel workbook với metadata
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Campaign Management System';
    workbook.created = new Date();
    workbook.company = 'NKC Auto Zalo';

    // ===== ĐỊNH NGHĨA COLOR PALETTE HỢP LÝ =====

    // 🎨 Minimalist Professional Colors
    const colors = {
      primary: '2563EB', // Clean Blue
      secondary: '64748B', // Slate Gray
      success: '059669', // Emerald
      warning: 'D97706', // Amber
      danger: 'DC2626', // Red
      info: '0891B2', // Cyan
      light: 'F8FAFC', // Very Light Gray
      lighter: 'F1F5F9', // Light Gray
      dark: '334155', // Dark Slate
      white: 'FFFFFF',
    };

    // 📝 Clean Typography
    const fontStyles = {
      title: {
        name: 'Segoe UI',
        size: 16,
        bold: true,
        color: { argb: colors.white },
      },
      heading: {
        name: 'Segoe UI',
        size: 13,
        bold: true,
        color: { argb: colors.dark },
      },
      subheading: {
        name: 'Segoe UI',
        size: 11,
        bold: true,
        color: { argb: colors.primary },
      },
      body: { name: 'Segoe UI', size: 10, color: { argb: colors.dark } },
      small: { name: 'Segoe UI', size: 9, color: { argb: colors.secondary } },
    };

    // 🎯 Clean Styles
    const styles = {
      titleBox: {
        font: fontStyles.title,
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.primary },
        },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin', color: { argb: colors.primary } },
          bottom: { style: 'thin', color: { argb: colors.primary } },
          left: { style: 'thin', color: { argb: colors.primary } },
          right: { style: 'thin', color: { argb: colors.primary } },
        },
      },
      infoLabel: {
        font: fontStyles.subheading,
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.lighter },
        },
        alignment: { horizontal: 'right', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        },
      },
      infoValue: {
        font: fontStyles.body,
        alignment: { horizontal: 'left', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        },
      },
      tableHeader: {
        font: fontStyles.subheading,
        fill: {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: colors.secondary },
        },
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'medium' },
          bottom: { style: 'medium' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        },
      },
      tableCell: {
        font: fontStyles.body,
        alignment: { horizontal: 'center', vertical: 'middle' },
        border: {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        },
      },
    };

    // ===== SHEET 1: DASHBOARD TỔNG QUAN =====
    const summarySheet = workbook.addWorksheet('📊 Tổng Quan', {
      properties: { tabColor: { argb: colors.primary } },
    });

    // 🏆 TITLE SECTION
    summarySheet.mergeCells('A1:E2');
    const titleCell = summarySheet.getCell('A1');
    titleCell.value = `📊 BÁO CÁO CHIẾN DỊCH\n${campaignWithCreator.name}`;
    Object.assign(titleCell, styles.titleBox);

    // 📅 Timestamp
    summarySheet.mergeCells('F1:F2');
    const timestampCell = summarySheet.getCell('F1');
    timestampCell.value = `📅 ${this.formatDateTime(new Date())}`;
    timestampCell.font = fontStyles.small;
    timestampCell.alignment = { horizontal: 'center', vertical: 'middle' };
    timestampCell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.light },
    };

    summarySheet.addRow([]); // Spacing

    // 🎯 THÔNG TIN CHIẾN DỊCH
    const infoStartRow = 4;
    const infoData = [
      ['🏷️ Tên Chiến Dịch', campaignWithCreator.name],
      [
        '📂 Loại Chiến Dịch',
        this.getCampaignTypeLabel(campaignWithCreator.campaign_type),
      ],
      [
        '🎮 Trạng Thái',
        this.getCampaignStatusLabel(campaignWithCreator.status),
      ],
      ['📅 Ngày Tạo', this.formatDateTime(campaignWithCreator.created_at)],
      ['👤 Người Tạo', campaignWithCreator.created_by?.fullName || 'N/A'],
      ['🏢 Phòng Ban', campaignWithCreator.department?.name || 'N/A'],
      [
        '👥 Tổng Khách Hàng',
        (await this.getTotalCustomerCount(campaignId)).toLocaleString(),
      ],
    ];

    infoData.forEach((row, index) => {
      const rowNum = infoStartRow + index;

      const labelCell = summarySheet.getCell(`A${rowNum}`);
      labelCell.value = row[0];
      Object.assign(labelCell, styles.infoLabel);

      const valueCell = summarySheet.getCell(`B${rowNum}`);
      valueCell.value = row[1];
      Object.assign(valueCell, styles.infoValue);

      summarySheet.mergeCells(`B${rowNum}:D${rowNum}`);
    });

    summarySheet.addRow([]); // Spacing

    // 📊 THỐNG KÊ SECTION
    const statsStartRow = infoStartRow + infoData.length + 2;

    summarySheet.mergeCells(`A${statsStartRow}:D${statsStartRow}`);
    const statsTitle = summarySheet.getCell(`A${statsStartRow}`);
    statsTitle.value = '📊 THỐNG KÊ THEO TRẠNG THÁI';
    statsTitle.font = fontStyles.heading;
    statsTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    statsTitle.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: colors.success },
    };

    summarySheet.addRow([]); // Spacing

    // Stats table headers
    const statsHeaderRow = statsStartRow + 2;
    const statsHeaders = [
      '📈 Trạng Thái',
      '👥 Số Lượng',
      '📊 Tỷ Lệ (%)',
      '📋 Ghi Chú',
    ];
    statsHeaders.forEach((header, index) => {
      const cell = summarySheet.getCell(
        String.fromCharCode(65 + index) + statsHeaderRow,
      );
      cell.value = header;
      Object.assign(cell, styles.tableHeader);
    });

    // ✅ SỬA: Status colors theo logic UI thực tế
    const totalCustomers = Math.max(
      await this.getTotalCustomerCount(campaignId),
      1,
    );
    const statusColors = {
      pending: colors.warning, // Chờ gửi - Amber
      sent: colors.info, // Đã gửi - Cyan
      failed: colors.danger, // Gửi lỗi - Red
      customer_replied: colors.success, // KH phản hồi - Green
      staff_handled: colors.primary, // Đã xử lý - Blue
      reminder_sent: colors.secondary, // Đã nhắc lại - Gray
      no_log: 'E2E8F0', // Chưa gửi - Light Gray
    };

    const statusIcons = {
      pending: '⏳',
      sent: '✅',
      failed: '❌',
      customer_replied: '💬',
      staff_handled: '🎯',
      reminder_sent: '🔄',
      no_log: '⚪',
    };

    Object.entries(customerStats).forEach(([status, count], index) => {
      const rowNum = statsHeaderRow + 1 + index;
      const percentage = (((count as number) / totalCustomers) * 100).toFixed(
        1,
      );

      // Status column
      const statusCell = summarySheet.getCell(`A${rowNum}`);
      statusCell.value = `${statusIcons[status]} ${this.getLogStatusLabel(status)}`;
      Object.assign(statusCell, styles.tableCell);
      statusCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: statusColors[status] + '30' },
      };

      // Count column
      const countCell = summarySheet.getCell(`B${rowNum}`);
      countCell.value = count;
      Object.assign(countCell, styles.tableCell);
      countCell.font = { ...fontStyles.body, bold: true };

      // Percentage column
      const percentCell = summarySheet.getCell(`C${rowNum}`);
      percentCell.value = `${percentage}%`;
      Object.assign(percentCell, styles.tableCell);

      // Notes column
      const noteCell = summarySheet.getCell(`D${rowNum}`);
      const notes = {
        pending: 'Đang chờ xử lý',
        sent: 'Đã gửi thành công',
        failed: 'Gửi thất bại',
        customer_replied: 'KH đã phản hồi',
        staff_handled: 'Staff đã xử lý',
        reminder_sent: 'Đã gửi nhắc nhở',
        no_log: 'Chưa có tương tác',
      };
      noteCell.value = notes[status] || '';
      Object.assign(noteCell, styles.tableCell);
      noteCell.font = fontStyles.small;
    });

    // Column widths
    summarySheet.getColumn('A').width = 25;
    summarySheet.getColumn('B').width = 20;
    summarySheet.getColumn('C').width = 15;
    summarySheet.getColumn('D').width = 30;
    summarySheet.getColumn('E').width = 15;
    summarySheet.getColumn('F').width = 20;

    summarySheet.views = [{ state: 'frozen', ySplit: 3 }];

    // ===== SHEET 2: CHI TIẾT KHÁCH HÀNG =====
    const detailSheet = workbook.addWorksheet('👥 Chi Tiết Khách Hàng', {
      properties: { tabColor: { argb: colors.secondary } },
    });

    // Title cho sheet 2
    detailSheet.mergeCells('A1:I2');
    const detailTitle = detailSheet.getCell('A1');
    detailTitle.value = '👥 DANH SÁCH KHÁCH HÀNG CHI TIẾT';
    Object.assign(detailTitle, styles.titleBox);

    detailSheet.addRow([]); // Spacing

    // ✅ SỬA: Headers theo đúng logic CampaignCustomersModal
    const detailHeaders = [
      '#',
      'Khách hàng',
      'Số điện thoại',
      'Ngày tạo DSKH',
      'Ngày Gửi',
      'Trạng thái gửi',
      'Tương tác',
      'Lần cuối',
      'Ghi chú',
    ];

    const detailHeaderRow = detailSheet.addRow(detailHeaders);
    detailHeaderRow.eachCell((cell, colNumber) => {
      Object.assign(cell, styles.tableHeader);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: colors.secondary },
      };
      cell.font = { ...fontStyles.subheading, color: { argb: colors.white } };
    });

    // ✅ SỬA: Data rows theo đúng logic UI
    customersWithLogs.forEach((customer, index) => {
      const isEvenRow = index % 2 === 0;

      const row = detailSheet.addRow([
        index + 1,
        customer.salutation
          ? `${customer.salutation} ${customer.full_name}`
          : customer.full_name,
        customer.phone_number,
        customer.added_at ? this.formatDateTime(customer.added_at) : 'N/A',
        customer.sent_at ? this.formatDateTime(customer.sent_at) : 'Chưa Gửi',
        customer.latestLog
          ? this.getLogStatusLabel(customer.latestLog.status)
          : 'Chưa gửi',
        `${customer.interactionCount} lần`,
        customer.lastInteractionTime
          ? this.formatDateTime(customer.lastInteractionTime)
          : 'Chưa có',
        customer.latestLog?.error_details ? 'Có lỗi xảy ra' : 'Bình thường',
      ]);

      // ✅ SỬA: Clean styling
      row.eachCell((cell, colNumber) => {
        Object.assign(cell, styles.tableCell);

        // Alternating row colors - subtle
        if (isEvenRow) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: colors.light },
          };
        }

        // Status column color coding - subtle
        if (colNumber === 6 && customer.latestLog) {
          const statusColor =
            statusColors[customer.latestLog.status] || 'E2E8F0';
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: statusColor + '20' },
          };
        }

        // Error highlighting - subtle
        if (colNumber === 9 && customer.latestLog?.error_details) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: colors.danger + '20' },
          };
          cell.font = { ...fontStyles.body, color: { argb: colors.danger } };
        }
      });
    });

    // ✅ SỬA: Column widths tối ưu cho headers mới
    const columnWidths = [8, 25, 18, 20, 20, 18, 12, 20, 15];
    columnWidths.forEach((width, index) => {
      detailSheet.getColumn(index + 1).width = width;
    });

    // Freeze panes và filters
    detailSheet.views = [{ state: 'frozen', ySplit: 3 }];
    detailSheet.autoFilter = {
      from: { row: 3, column: 1 },
      to: { row: customersWithLogs.length + 3, column: detailHeaders.length },
    };

    // ===== FINISHING TOUCHES =====

    // Print settings
    [summarySheet, detailSheet].forEach((sheet) => {
      sheet.pageSetup = {
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        paperSize: 9, // A4
        orientation: 'landscape',
        margins: {
          left: 0.5,
          right: 0.5,
          top: 0.5,
          bottom: 0.5,
          header: 0.3,
          footer: 0.3,
        },
      };
    });

    // Generate buffer
    const buffer = await workbook.xlsx.writeBuffer();
    const { Readable } = require('stream');
    return Readable.from(buffer);
  }

  private truncateText(text: string, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength
      ? `${text.substring(0, maxLength)}...`
      : text;
  }

  // Helper methods remain the same...
  private getCampaignTypeLabel(type: string): string {
    const typeLabels = {
      hourly_km: '⏰ Khuyến mãi theo giờ',
      daily_km: '📅 Khuyến mãi hàng ngày',
      '3_day_km': '📆 Khuyến mãi 3 ngày',
      weekly_sp: '🛍️ Sản phẩm hàng tuần',
      weekly_bbg: '💎 BBG hàng tuần',
    };
    return typeLabels[type] || type;
  }

  private async getCustomerInteractionCount(
    customerId: string,
    campaignId: string,
  ): Promise<number> {
    const count = await this.campaignLogRepository
      .createQueryBuilder('log')
      .innerJoin('log.campaign', 'campaign')
      .innerJoin('log.customer', 'customer')
      .where('campaign.id = :campaignId', { campaignId })
      .andWhere('customer.id = :customerId', { customerId })
      .andWhere('log.status IN (:...statuses)', {
        statuses: ['customer_replied', 'staff_handled'],
      })
      .getCount();

    return count;
  }

  private async getLastCustomerInteractionTime(
    customerId: string,
    campaignId: string,
  ): Promise<string | null> {
    const lastLog = await this.campaignLogRepository
      .createQueryBuilder('log')
      .innerJoin('log.campaign', 'campaign')
      .innerJoin('log.customer', 'customer')
      .where('campaign.id = :campaignId', { campaignId })
      .andWhere('customer.id = :customerId', { customerId })
      .andWhere('log.customer_replied_at IS NOT NULL')
      .orderBy('log.customer_replied_at', 'DESC')
      .getOne();

    return lastLog?.customer_replied_at?.toISOString() || null;
  }

  private async getTotalCustomerCount(campaignId: string): Promise<number> {
    const result = await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .select('COUNT(map.customer_id)', 'count')
      .where('map.campaign_id = :campaignId', { campaignId })
      .getRawOne();

    return parseInt(result.count) || 0;
  }

  private getCampaignStatusLabel(status: string): string {
    const statusLabels = {
      draft: '📝 Bản nháp',
      scheduled: '⏰ Đã lên lịch',
      running: '🚀 Đang chạy',
      paused: '⏸️ Tạm dừng',
      completed: '✅ Hoàn thành',
      archived: '📦 Đã lưu trữ',
    };
    return statusLabels[status] || status;
  }

  private getLogStatusLabel(status: string): string {
    const statusLabels = {
      pending: '⏳ Chờ gửi',
      sent: '✅ Đã gửi',
      failed: '❌ Gửi lỗi',
      customer_replied: '💬 KH phản hồi',
      staff_handled: '🎯 Đã xử lý',
      reminder_sent: '🔄 Đã nhắc lại',
    };
    return statusLabels[status] || status;
  }

  private formatDateTime(date: string | Date): string {
    try {
      return new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(date));
    } catch {
      return 'N/A';
    }
  }

  private async getCampaignCustomerStats(
    campaignId: string,
  ): Promise<Record<string, number>> {
    const stats = await this.campaignLogRepository
      .createQueryBuilder('log')
      .innerJoin('log.campaign', 'campaign')
      .select('log.status', 'status')
      .addSelect('COUNT(DISTINCT log.customer)', 'count')
      .where('campaign.id = :campaignId', { campaignId })
      .groupBy('log.status')
      .getRawMany();

    const result: Record<string, number> = {
      pending: 0,
      sent: 0,
      failed: 0,
      customer_replied: 0,
      staff_handled: 0,
      reminder_sent: 0,
    };

    stats.forEach((stat) => {
      result[stat.status] = parseInt(stat.count);
    });

    // Đếm số khách hàng chưa có log (chưa gửi)
    const totalCustomers = await this.getTotalCustomerCount(campaignId);
    const customersWithLogs = Object.values(result).reduce(
      (sum, count) => sum + count,
      0,
    );
    result['no_log'] = Math.max(0, totalCustomers - customersWithLogs);

    return result;
  }

  private async getCampaignCustomersWithLogs(campaignId: string) {
    // Lấy customer maps với proper joins
    const customerMaps = await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id = :campaignId', { campaignId })
      .orderBy('map.added_at', 'DESC')
      .getMany();

    // Lấy logs riêng biệt với proper joins
    const logs = await this.campaignLogRepository
      .createQueryBuilder('log')
      .leftJoinAndSelect('log.staff_handler', 'staff')
      .leftJoinAndSelect('log.customer', 'customer')
      .innerJoin('log.campaign', 'campaign')
      .where('campaign.id = :campaignId', { campaignId })
      .orderBy('log.sent_at', 'DESC')
      .getMany();

    // Group logs by customer_id
    const logsByCustomer: Record<string, any[]> = {};
    logs.forEach((log) => {
      const customerId = log.customer.id.toString();
      if (!logsByCustomer[customerId]) {
        logsByCustomer[customerId] = [];
      }
      logsByCustomer[customerId].push({
        id: log.id,
        status: log.status,
        sent_at: log.sent_at,
        message_content_sent: log.message_content_sent,
        customer_reply_content: log.customer_reply_content,
        customer_replied_at: log.customer_replied_at,
        staff_reply_content: log.staff_reply_content,
        staff_handled_at: log.staff_handled_at,
        error_details: log.error_details,
        staff_handler: log.staff_handler
          ? {
              fullName: log.staff_handler.fullName,
            }
          : null,
      });
    });

    // ✅ SỬA: Khai báo type explicit để tránh lỗi TypeScript
    const results: any[] = [];

    for (const map of customerMaps) {
      const customerId = map.customer_id.toString();
      const customerLogs = logsByCustomer[customerId] || [];

      // Sắp xếp logs theo thời gian và lấy latest
      customerLogs.sort(
        (a, b) =>
          new Date(b.sent_at || 0).getTime() -
          new Date(a.sent_at || 0).getTime(),
      );

      // Lấy interaction count và last interaction time từ database
      const interactionCount = await this.getCustomerInteractionCount(
        customerId,
        campaignId,
      );
      const lastInteractionTime = await this.getLastCustomerInteractionTime(
        customerId,
        campaignId,
      );

      results.push({
        id: customerId,
        phone_number: map.campaign_customer.phone_number,
        full_name: map.full_name,
        salutation: map.salutation,
        added_at: map.added_at,
        sent_at: customerLogs[0]?.sent_at || null,
        latestLog: customerLogs[0] || null,
        totalInteractions: customerLogs.length,
        interactionCount: interactionCount,
        lastInteractionTime: lastInteractionTime,
      });
    }

    return results;
  }
}
