import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Role } from '../roles/role.entity';
import { User } from '../users/user.entity';
import { UserStatus } from '../users/user-status.enum';
import { SystemConfig } from '../system_config/system_config.entity';
import { SeedDebtTriggerService } from './seed-debt-trigger.service';
import { SeedCampaignTriggerService } from './seed-campaign-trigger.service';
import { SeedUserTriggerService } from './seed-user-trigger.service';
import { SeedCustomerPermissionService } from './seed-customer-permission.service';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepo: Repository<SystemConfig>,
    private readonly seedDebtTriggerService: SeedDebtTriggerService,
    private readonly seedCampaignTriggerService: SeedCampaignTriggerService,
    private readonly seedUserTriggerService: SeedUserTriggerService,
    private readonly seedCustomerPermissionService: SeedCustomerPermissionService,
  ) {}

  async onModuleInit() {
    await this.seedDebtTriggerService.seedTriggers();
    await this.seedCampaignTriggerService.seedTriggers();
    await this.seedUserTriggerService.seedTriggers();
    await this.seedCustomerPermissionService.seedCustomerPermissions();

    // Ensure default roles exist
    const defaultRoleNames = ['admin', 'user', 'manager', 'view'];
    const roleMap: Record<string, Role> = {};

    for (const roleName of defaultRoleNames) {
      let role = await this.roleRepo.findOne({ where: { name: roleName } });
      if (!role) {
        role = new Role();
        role.name = roleName;
        role = await this.roleRepo.save(role);
        console.log(`✅ Seeder: Đã tạo role: ${roleName}`);
      }
      roleMap[roleName] = role;
    }

    const existed = await this.userRepo.findOne({
      where: { username: 'admin' },
    });
    if (existed) {
      console.log('⚠️ Seeder skipped - admin already exists.');
    } else {
      // 2. Tạo user admin
      const now = new Date();
      const adminUser = new User();
      adminUser.username = 'admin';
      adminUser.fullName = 'Quản trị viên hệ thống';
      adminUser.email = 'admin@example.com';
      adminUser.status = UserStatus.ACTIVE;
      adminUser.isBlock = false;
      adminUser.employeeCode = 'EMP-ADMIN';
      adminUser.password = await bcrypt.hash('admin', 10);
      adminUser.roles = [roleMap['admin']];
      adminUser.departments = [];
      adminUser.lastLogin = now;

      await this.userRepo.save(adminUser);

      console.log('✅ Seeder: Đã tạo user admin thành công!');
      console.log('👉 Tài khoản test: admin / admin');
    }

    // Seed system_config nếu chưa có bản ghi nào
    const systemConfigCount = await this.systemConfigRepo.count();
    if (systemConfigCount === 0) {
      const configs = [
        // system (chung)
        {
          name: 'system_stopToolConfig',
          display_name: 'Cấu hình thời gian dừng tool',
          value:
            '{"monday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"17:45","end":"23:59"}],"tuesday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"17:45","end":"23:59"}],"wednesday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"17:45","end":"23:59"}],"thursday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"17:45","end":"23:59"}],"friday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"17:45","end":"23:59"}],"saturday":[{"start":"00:00","end":"07:50"},{"start":"12:00","end":"13:30"},{"start":"16:00","end":"23:59"}],"sunday":[{"start":"00:00","end":"23:59"}]}',
          type: 'json',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_apiRetry',
          display_name: 'Số lần thử lại api',
          value: '5',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_apiInterval',
          display_name: 'Thời gian xử lý api lặp lại',
          value: '5',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_scheduleHoliday',
          display_name: 'Lịch nghỉ',
          value: '1',
          type: 'toggle',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_processOrder',
          display_name: 'Xử lý giao dịch',
          value: '1',
          type: 'toggle',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_processDebt',
          display_name: 'Xử lý công nợ',
          value: '1',
          type: 'toggle',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_aiModelName',
          display_name: 'Model AI xử lý tin nhắn',
          value: 'gpt-4o-mini-2024-07-18',
          type: 'text',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_aiMaxOutputTokens',
          display_name: 'Giới hạn token đầu ra AI xử lý',
          value: '4000',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_aiTemperature',
          display_name: 'Temperature Model AI',
          value: '0.0',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_aiTimeout',
          display_name: 'Thời gian timeout xử lý AI',
          value: '30',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_aiRetry',
          display_name: 'Số lần thử lại xử lý AI',
          value: '3',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'system_processCampaign',
          display_name: 'Xử lý chiến dịch',
          value: '1',
          type: 'toggle',
          section: 'system',
          status: 1,
        },

        // transaction
        {
          name: 'transaction_threads',
          display_name: 'Tổng luồng chạy Giao dịch',
          value: '3',
          type: 'number',
          section: 'transaction',
          status: 1,
        },
        {
          name: 'total_conversation_segments',
          display_name: 'Tổng số đoạn hội thoại phân tích',
          value: '1500',
          type: 'number',
          section: 'transaction',
          status: 1,
        },
        {
          name: 'transaction_batch',
          display_name: 'Tổng xử lý số lượng hội thoại 1 lần Giao dịch ',
          value: '300',
          type: 'number',
          section: 'transaction',
          status: 1,
        },
        {
          name: 'transaction_rest',
          display_name: 'Thời gian nghỉ khi xử lý Giao dịch ',
          value: '300',
          type: 'number',
          section: 'transaction',
          status: 1,
        },
        {
          name: 'transaction_timeout',
          display_name: 'Thời gian timeout của luồng Giao dịch ',
          value: '30',
          type: 'number',
          section: 'transaction',
          status: 1,
        },

        // holiday
        {
          name: 'holiday_multi_days',
          display_name: 'Lịch nghỉ nhiều ngày liên tục',
          value: '[]',
          type: 'json',
          section: 'holiday',
          status: 1,
        },
        {
          name: 'holiday_single_day',
          display_name: 'Lịch nghỉ 1 ngày',
          value: '[]',
          type: 'json',
          section: 'holiday',
          status: 1,
        },
        {
          name: 'holiday_separated_days',
          display_name: 'Lịch nghỉ các ngày không liên tục',
          value: '[]',
          type: 'json',
          section: 'holiday',
          status: 1,
        },

        // debt (các config khác)
        {
          name: 'debt_firstReminderSentence',
          display_name: 'Câu nhắc nợ lần 1',
          value:
            '{you} ơi, em xin phép nhắc lần nữa nội dung đã gửi trước đó về khoản thanh toán đến hạn. Rất mong {you} sớm phản hồi để em tiện cập nhật và hỗ trợ kịp thời. Em chân thành cảm ơn!',
          type: 'text',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_secondReminderSentence',
          display_name: 'Câu nhắc nợ lần 2',
          value:
            'Dạ, em xin phép nhắc lần nữa thông tin công nợ gửi {you} cách đây ít phút ạ. Mong {you} sắp xếp thời gian xem giúp và phản hồi sớm lịch thanh toán để em tiện theo dõi và hỗ trợ tiếp theo ạ. Em cảm ơn {you} nhiều!',
          type: 'text',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_firstReminderDelayTime',
          display_name: 'Thời gian trì hoãn nhắc nợ lần 1',
          value: '1',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_secondReminderDelayTime',
          display_name: 'Thời gian trì hoãn nhắc nợ lần 2',
          value: '1',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_reminderForSale',
          display_name: 'Câu nhắc báo cho sale',
          value:
            'Nhờ KD hỗ trợ nhắc lại với khách hàng {customer_code} hiện còn nợ số tiền {amount} đến hạn. Kế toán đã nhắc vài lần nhưng chưa thấy phản hồi. Mong KD hỗ trợ giúp để thu hồi công nợ đúng hạn. Em cảm ơn KD nhiều!',
          type: 'text',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_runTime',
          display_name: 'Thời gian chạy công nợ',
          value: '08:00',
          type: 'time',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_rest',
          display_name: 'Thời gian nghỉ công nợ',
          value: '5',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_timeout',
          display_name: 'Thời gian timeout công nợ',
          value: '30',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_max_workers',
          display_name: 'Số lượng worker tối đa cho công nợ',
          value: '5',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_batch',
          display_name: 'Tổng xử lý số lượng hội thoại 1 lần Công nợ',
          value: '300',
          type: 'number',
          section: 'debt',
          status: 1,
        },
        {
          name: 'debt_report',
          display_name: 'Cấu hình gửi mail báo cáo công nợ',
          value:
            '{"time_start":"15:00","time_end":"17:00","mail":["mail1@gmail.com","mail2@gmail.com","mail3@gmail.com"]}',
          type: 'json',
          section: 'debt',
          status: 1,
        },

        // campaign
        {
          name: 'campaign_runTime',
          display_name: 'Thời gian chạy chiến dịch',
          value: '08:00',
          type: 'time',
          section: 'campaign',
          status: 1,
        },
        {
          name: 'campaign_rest',
          display_name: 'Thời gian nghỉ chiến dịch',
          value: '5',
          type: 'number',
          section: 'campaign',
          status: 1,
        },
        {
          name: 'campaign_timeout',
          display_name: 'Thời gian timeout chiến dịch',
          value: '3001',
          type: 'number',
          section: 'campaign',
          status: 1,
        },
        {
          name: 'campaign_max_workers',
          display_name: 'Số lượng worker tối đa cho chiến dịch',
          value: '5',
          type: 'number',
          section: 'campaign',
          status: 1,
        },
        {
          name: 'campaign_batch',
          display_name: 'Tổng xử lý số lượng hội thoại 1 lần Chiến dịch',
          value: '300',
          type: 'number',
          section: 'campaign',
          status: 1,
        },
        {
          name: 'campaign_minimum_reminder_delay',
          display_name: 'Thời gian trì hoãn nhắc nhở tối thiểu cho chiến dịch',
          value: '2',
          type: 'number',
          section: 'campaign',
          status: 1,
        },

        // zalo
        {
          name: 'zalo_conversation_name_updater_enabled',
          display_name: 'Zalo Conversation Name Updater Enabled',
          value: '1',
          type: 'toggle',
          section: 'system',
          status: 1,
        },
        {
          name: 'zalo_conversation_name_updater_rest_time',
          display_name: 'Zalo Conversation Name Updater Rest Time (seconds)',
          value: '300',
          type: 'number',
          section: 'system',
          status: 1,
        },
        {
          name: 'zalo_chat_auto_refresh_interval',
          display_name: 'Thời gian tự động làm mới chat (giây)',
          value: '10',
          type: 'number',
          section: 'zalo_chat',
          status: 1,
        },
      ];
      for (const config of configs) {
        await this.systemConfigRepo.save(this.systemConfigRepo.create(config));
      }
      console.log('✅ Seeder: Đã tạo system_config thành công!');
    } else {
      console.log('⚠️ Seeder skipped - system_config đã có dữ liệu.');

      // Vẫn kiểm tra và thêm các config mới nếu chưa có
      const configsToCheck = [
        {
          name: 'zalo_chat_auto_refresh_interval',
          display_name: 'Thời gian tự động làm mới chat (giây)',
          value: '10',
          type: 'number',
          section: 'zalo_chat',
          status: 1,
        },
      ];

      for (const config of configsToCheck) {
        const existing = await this.systemConfigRepo.findOne({
          where: { name: config.name },
        });
        if (!existing) {
          await this.systemConfigRepo.save(
            this.systemConfigRepo.create(config),
          );
          console.log(`✅ Đã thêm config mới: ${config.name}`);
        }
      }
    }
  }
}
