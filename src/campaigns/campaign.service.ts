import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, In } from 'typeorm';
import { Campaign, CampaignStatus, CampaignType } from './campaign.entity';
import { Department } from '../departments/department.entity';
import { CreateCampaignDto } from './campaign.dto';
import { User } from '../users/user.entity';
import { CampaignCustomerMap } from '../campaign_customer_map/campaign_customer_map.entity';
import { CampaignInteractionLog } from '../campaign_interaction_logs/campaign_interaction_log.entity';
import { CampaignContent } from '../campaign_contents/campaign_content.entity';
import { CampaignSchedule } from '../campaign_schedules/campaign_schedule.entity';
import { CampaignEmailReport } from '../campaign_email_reports/campaign_email_report.entity';
import { CampaignCustomer } from '../campaign_customers/campaign_customer.entity';
import { PromoMessageFlow, InitialMessage, ReminderMessage } from '../campaign_config/promo_message';
import * as ExcelJS from 'exceljs';

export interface CampaignWithDetails extends Campaign {
  customer_count?: number;
  
  messages: {
    type: "initial";
    text: string;
    attachment?: {
      type: "image" | "link" | "file";
      url?: string;
      base64?: string;
      filename?: string;
    } | null;
  };
  
  schedule_config: {
    type: "hourly" | "3_day" | "weekly";
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

  async findAll(query: any = {}, user: User): Promise<CampaignResponse> {
    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      // Join với các entity riêng biệt để lấy full data
      .leftJoin('campaign_contents', 'content', 'content.campaign_id = campaign.id')
      .leftJoin('campaign_schedules', 'schedule', 'schedule.campaign_id = campaign.id')
      .leftJoin('campaign_email_reports', 'email_report', 'email_report.campaign_id = campaign.id')
      .leftJoin('campaign_customer_map', 'customer_map', 'customer_map.campaign_id = campaign.id')
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect('email_report.report_interval_minutes', 'email_report_interval_minutes')
      .addSelect('email_report.stop_sending_at_time', 'email_stop_sending_at_time')
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect('email_report.send_when_campaign_completed', 'email_send_when_campaign_completed')
      .addSelect('COUNT(customer_map.customer_id)', 'customer_count')
      .groupBy('campaign.id, created_by.id, department.id, content.id, schedule.id, email_report.id');

    // Filter by user's department
    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.andWhere('campaign.department.id = :deptId', {
        deptId: userDepartment.id,
      });
    }

    // Filter by search (campaign name)
    if (query.search) {
      qb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search}%`,
      });
    }

    // Filter by campaign types
    if (query.campaignTypes && Array.isArray(query.campaignTypes)) {
      qb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
        campaignTypes: query.campaignTypes,
      });
    }

    // Filter by status
    if (query.statuses && Array.isArray(query.statuses)) {
      qb.andWhere('campaign.status IN (:...statuses)', {
        statuses: query.statuses,
      });
    }

    // Filter by creators (sales people)
    if (query.createdBy && Array.isArray(query.createdBy)) {
      qb.andWhere('campaign.created_by IN (:...createdBy)', {
        createdBy: query.createdBy,
      });
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('campaign.created_at', 'DESC');

    // Get raw results để có thể parse đúng
    const rawResults = await qb.getRawMany();
    
    // Get total count with a separate query to avoid issues with GROUP BY
    const countQb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department');

    if (userDepartment) {
      countQb.andWhere('campaign.department.id = :deptId', {
        deptId: userDepartment.id,
      });
    }

    if (query.search) {
      countQb.andWhere('campaign.name LIKE :search', {
        search: `%${query.search}%`,
      });
    }

    if (query.campaignTypes && Array.isArray(query.campaignTypes)) {
      countQb.andWhere('campaign.campaign_type IN (:...campaignTypes)', {
        campaignTypes: query.campaignTypes,
      });
    }

    if (query.statuses && Array.isArray(query.statuses)) {
      countQb.andWhere('campaign.status IN (:...statuses)', {
        statuses: query.statuses,
      });
    }

    if (query.createdBy && Array.isArray(query.createdBy)) {
      countQb.andWhere('campaign.created_by IN (:...createdBy)', {
        createdBy: query.createdBy,
      });
    }

    const total = await countQb.getCount();

    // Get all campaign IDs for loading customers
    const campaignIds = rawResults.map(result => result.campaign_id);
    
    // Load customers for all campaigns in one query
    const allCustomerMaps = campaignIds.length > 0 ? await this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .where('map.campaign_id IN (:...campaignIds)', { campaignIds })
      .getMany() : [];
    
    // Group customers by campaign ID
    const customersByCampaign = allCustomerMaps.reduce((acc, map) => {
      if (!acc[map.campaign_id]) acc[map.campaign_id] = [];
      acc[map.campaign_id].push({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.campaign_customer.full_name,
        salutation: map.campaign_customer.salutation,
      });
      return acc;
    }, {} as Record<string, any[]>);

    // Transform data to match CampaignWithDetails interface
    const data: CampaignWithDetails[] = rawResults.map((result: any) => {
      // Parse messages để lấy initial message và reminders
      const messages = result.content_messages || [];
      const initialMessage = Array.isArray(messages) ? messages.find(msg => msg.type === 'initial') || messages[0] : null;
      const reminderMessages = Array.isArray(messages) ? messages.filter(msg => msg.type === 'reminder') : [];

      // Parse schedule config
      const scheduleConfig = result.schedule_config || {};

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
              send_when_campaign_completed: result.email_send_when_campaign_completed,
            }
          : undefined,

        customers: customersByCampaign[result.campaign_id] || [],
      } as CampaignWithDetails;
    });

    // Get stats
    const stats = await this.getStats(user);

    return { data, total, stats };
  }

  async findOne(id: string, user: User): Promise<CampaignWithDetails> {
    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoinAndSelect('campaign.created_by', 'created_by')
      .leftJoinAndSelect('campaign.department', 'department')
      // Join với các entity riêng biệt để lấy full data
      .leftJoin('campaign_contents', 'content', 'content.campaign_id = campaign.id')
      .leftJoin('campaign_schedules', 'schedule', 'schedule.campaign_id = campaign.id')
      .leftJoin('campaign_email_reports', 'email_report', 'email_report.campaign_id = campaign.id')
      .leftJoin('campaign_customer_map', 'customer_map', 'customer_map.campaign_id = campaign.id')
      .leftJoin('campaign_customers', 'customer', 'customer.id = customer_map.customer_id')
      .addSelect('content.messages', 'content_messages')
      .addSelect('schedule.schedule_config', 'schedule_config')
      .addSelect('email_report.recipient_to', 'email_recipient_to')
      .addSelect('email_report.recipients_cc', 'email_recipients_cc')
      .addSelect('email_report.report_interval_minutes', 'email_report_interval_minutes')
      .addSelect('email_report.stop_sending_at_time', 'email_stop_sending_at_time')
      .addSelect('email_report.is_active', 'email_is_active')
      .addSelect('email_report.send_when_campaign_completed', 'email_send_when_campaign_completed')
      .addSelect('COUNT(customer_map.customer_id)', 'customer_count')
      .where('campaign.id = :id', { id })
      .groupBy('campaign.id, created_by.id, department.id, content.id, schedule.id, email_report.id');

    // Filter by user's department for security
    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.andWhere('department.id = :deptId', { deptId: userDepartment.id });
    }

    const rawResult = await qb.getRawOne();

    if (!rawResult) {
      throw new NotFoundException('Không tìm thấy chiến dịch');
    }

    // Parse messages để lấy initial message và reminders
    const messages = rawResult.content_messages || [];
    const initialMessage = Array.isArray(messages) ? messages.find(msg => msg.type === 'initial') || messages[0] : null;
    const reminderMessages = Array.isArray(messages) ? messages.filter(msg => msg.type === 'reminder') : [];

    // Parse schedule config
    const scheduleConfig = rawResult.schedule_config || {};

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
            send_when_campaign_completed: rawResult.email_send_when_campaign_completed,
          }
        : undefined,

      customers: customers.map(map => ({
        phone_number: map.campaign_customer.phone_number,
        full_name: map.campaign_customer.full_name,
        salutation: map.campaign_customer.salutation,
      })),
    };

    return campaignWithDetails;
  }

  async create(data: any, user: User): Promise<CampaignWithDetails> {
    const queryRunner = this.campaignRepository.manager.connection.createQueryRunner();
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
        department = user.departments?.[0];
        if (!department) {
          throw new BadRequestException('Người dùng phải thuộc về một phòng ban');
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
          const reminderMessages: ReminderMessage[] = data.reminders.map((reminder: any) => ({
            type: 'reminder' as const,
            offset_minutes: reminder.minutes,
            text: reminder.content,
            attachment: null,
          }));
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
        const campaignEmailReport = queryRunner.manager.create(CampaignEmailReport, {
          campaign: savedCampaign,
          recipient_to: data.email_reports.recipients_to,
          recipients_cc: data.email_reports.recipients_cc,
          report_interval_minutes: data.email_reports.report_interval_minutes,
          stop_sending_at_time: data.email_reports.stop_sending_at_time,
          is_active: data.email_reports.is_active,
          send_when_campaign_completed: data.email_reports.send_when_campaign_completed,
        });

        await queryRunner.manager.save(CampaignEmailReport, campaignEmailReport);
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
              full_name: customerData.full_name,
              salutation: customerData.salutation,
            });
            customer = await queryRunner.manager.save(CampaignCustomer, customer);
          }

          // Tạo mapping
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(savedCampaign.id),
            customer_id: Number(customer.id),
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
    const queryRunner = this.campaignRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 1. Lấy campaign hiện tại
      const existingCampaign = await this.findOne(id, user);

      // 2. Cập nhật campaign chính
      const updatedCampaign = await queryRunner.manager.save(Campaign, {
        ...existingCampaign,
        name: data.name || existingCampaign.name,
        campaign_type: data.campaign_type || existingCampaign.campaign_type,
        status: data.status || existingCampaign.status,
        send_method: data.send_method || existingCampaign.send_method,
      });

      // 3. Cập nhật campaign content (messages)
      if (data.messages) {
        // Xóa content cũ
        await queryRunner.manager.delete(CampaignContent, { campaign: { id } });

        let messages: PromoMessageFlow;
        
        // Thêm reminders vào messages
        if (data.reminders && Array.isArray(data.reminders)) {
          const reminderMessages: ReminderMessage[] = data.reminders.map((reminder: any) => ({
            type: 'reminder' as const,
            offset_minutes: reminder.minutes,
            text: reminder.content,
            attachment: null,
          }));
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

      // 4. Cập nhật campaign schedule
      if (data.schedule_config) {
        // Xóa schedule cũ
        await queryRunner.manager.delete(CampaignSchedule, { campaign: { id } });

        const campaignSchedule = queryRunner.manager.create(CampaignSchedule, {
          campaign: updatedCampaign,
          schedule_config: data.schedule_config,
          is_active: true,
        });

        await queryRunner.manager.save(CampaignSchedule, campaignSchedule);
      }

      // 5. Cập nhật email reports
      if (data.email_reports) {
        // Xóa email reports cũ
        await queryRunner.manager.delete(CampaignEmailReport, { campaign: { id } });

        const campaignEmailReport = queryRunner.manager.create(CampaignEmailReport, {
          campaign: updatedCampaign,
          recipient_to: data.email_reports.recipients_to,
          recipients_cc: data.email_reports.recipients_cc,
          report_interval_minutes: data.email_reports.report_interval_minutes,
          stop_sending_at_time: data.email_reports.stop_sending_at_time,
          is_active: data.email_reports.is_active,
          send_when_campaign_completed: data.email_reports.send_when_campaign_completed,
        });

        await queryRunner.manager.save(CampaignEmailReport, campaignEmailReport);
      }

      // 6. Cập nhật customers và mapping
      if (data.customers && Array.isArray(data.customers)) {
        // Xóa mappings cũ
        await queryRunner.manager.delete(CampaignCustomerMap, { campaign: { id } });

        for (const customerData of data.customers) {
          // Kiểm tra customer đã tồn tại chưa
          let customer = await queryRunner.manager.findOne(CampaignCustomer, {
            where: { phone_number: customerData.phone_number },
          });

          // Nếu chưa tồn tại thì tạo mới
          if (!customer) {
            customer = queryRunner.manager.create(CampaignCustomer, {
              phone_number: customerData.phone_number,
              full_name: customerData.full_name,
              salutation: customerData.salutation,
            });
            customer = await queryRunner.manager.save(CampaignCustomer, customer);
          }

          // Tạo mapping mới
          const customerMap = queryRunner.manager.create(CampaignCustomerMap, {
            campaign_id: Number(id),
            customer_id: Number(customer.id),
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
    const campaign = await this.findOne(id, user);

    // Validate status transitions
    this.validateStatusTransition(campaign.status, status);

    // Update campaign status
    await this.campaignRepository.update(id, { status });
    
    // Return updated campaign with full details
    return await this.findOne(id, user);
  }

  async delete(id: string, user: User): Promise<void> {
    const campaign = await this.findOne(id, user);

    if (campaign.status === CampaignStatus.RUNNING) {
      throw new BadRequestException('Không thể xóa chiến dịch đang chạy');
    }

    await this.campaignRepository.remove(campaign);
  }

  async archive(id: string, user: User): Promise<CampaignWithDetails> {
    return this.updateStatus(id, CampaignStatus.ARCHIVED, user);
  }

  private validateStatusTransition(
    currentStatus: CampaignStatus,
    newStatus: CampaignStatus,
  ): void {
    const validTransitions: Record<CampaignStatus, CampaignStatus[]> = {
      [CampaignStatus.DRAFT]: [CampaignStatus.SCHEDULED],
      [CampaignStatus.SCHEDULED]: [
        CampaignStatus.RUNNING,
        CampaignStatus.DRAFT,
      ],
      [CampaignStatus.RUNNING]: [
        CampaignStatus.PAUSED,
        CampaignStatus.COMPLETED,
      ],
      [CampaignStatus.PAUSED]: [
        CampaignStatus.RUNNING,
        CampaignStatus.COMPLETED,
      ],
      [CampaignStatus.COMPLETED]: [CampaignStatus.ARCHIVED],
      [CampaignStatus.ARCHIVED]: [],
    };

    if (!validTransitions[currentStatus]?.includes(newStatus)) {
      throw new BadRequestException(
        `Không thể chuyển từ trạng thái ${currentStatus} sang ${newStatus}`,
      );
    }
  }

  async getStats(user: User): Promise<any> {
    const qb = this.campaignRepository
      .createQueryBuilder('campaign')
      .leftJoin('campaign.department', 'department');

    const userDepartment = user.departments?.[0];
    if (userDepartment) {
      qb.where('department.id = :departmentId', {
        departmentId: userDepartment.id,
      });
    }

    const [
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
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
    ]);

    return {
      totalCampaigns,
      draftCampaigns,
      runningCampaigns,
      completedCampaigns,
    };
  }

  async getCampaignCustomers(campaignId: string, query: any = {}, user: User) {
    // Verify campaign exists and user has access
    await this.findOne(campaignId, user);

    const qb = this.campaignCustomerMapRepository
      .createQueryBuilder('map')
      .leftJoinAndSelect('map.campaign_customer', 'customer')
      .leftJoinAndSelect('map.campaign', 'campaign')
      .where('map.campaign_id = :campaignId', { campaignId });

    // Filter by search (customer name or phone)
    if (query.search) {
      qb.andWhere(
        '(customer.full_name LIKE :search OR customer.phone_number LIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    // Filter by status would require joining with interaction logs
    if (query.status) {
      qb.leftJoin('customer.logs', 'log').andWhere('log.status = :status', {
        status: query.status,
      });
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.max(1, parseInt(query.limit) || 10);
    const skip = (page - 1) * limit;

    qb.skip(skip).take(limit);
    qb.orderBy('map.added_at', 'DESC');

    const [data, total] = await qb.getManyAndCount();

    return {
      data: data.map((map) => ({
        ...map.campaign_customer,
        added_at: map.added_at,
      })),
      total,
      page,
      limit,
    };
  }

  async exportCustomers(campaignId: string, query: any = {}, user: User) {
    // Verify campaign exists and user has access
    const campaign = await this.findOne(campaignId, user);

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
        full_name: map.campaign_customer.full_name,
        salutation: map.campaign_customer.salutation || '',
        added_at: map.added_at.toLocaleDateString('vi-VN'),
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const { Readable } = require('stream');
    return Readable.from(buffer);
  }

  async getCustomerLogs(campaignId: string, customerId: string, user: User) {
    // Verify campaign exists and user has access
    await this.findOne(campaignId, user);

    const logs = await this.campaignLogRepository.find({
      where: {
        campaign: { id: campaignId },
        customer: { id: customerId },
      },
      relations: ['campaign', 'customer', 'staff_handler'],
      order: { sent_at: 'DESC' },
    });

    return logs;
  }
}
