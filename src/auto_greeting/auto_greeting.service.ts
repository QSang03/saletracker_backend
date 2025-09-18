import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AutoGreetingCustomer } from './auto_greeting_customer.entity';
import { AutoGreetingCustomerMessageHistory } from './auto_greeting_customer_message_history.entity';
import { SystemConfig } from '../system_config/system_config.entity';
import { User } from '../users/user.entity';

export interface AutoGreetingConfig {
  enabled: boolean;
  cycleDays: number;
  executionTime: string;
  messageTemplate: string;
  allowCustomMessage: boolean;
}

export interface CustomerWithLastMessage {
  id: string;
  userId: number;
  zaloDisplayName: string;
  salutation?: string;
  greetingMessage?: string;
  conversationType?: 'group' | 'private';
  lastMessageDate?: string; // ISO string format - từ customer_message_history
  customerLastMessageDate?: string; // ISO string format - từ customers.last_message_date
  customerStatus?: 'urgent' | 'reminder' | 'normal'; // Trạng thái từ bảng customers
  daysSinceLastMessage: number | null;
  status: 'ready' | 'urgent' | 'stable'; // Trạng thái tính toán dựa trên ngày
}

@Injectable()
export class AutoGreetingService {
  private readonly logger = new Logger(AutoGreetingService.name);

  constructor(
    @InjectRepository(AutoGreetingCustomer)
    private readonly autoGreetingCustomerRepo: Repository<AutoGreetingCustomer>,
    @InjectRepository(AutoGreetingCustomerMessageHistory)
    private readonly autoGreetingMessageHistoryRepo: Repository<AutoGreetingCustomerMessageHistory>,
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepo: Repository<SystemConfig>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Lấy cấu hình auto-greeting từ system_config
   */
  async getConfig(): Promise<AutoGreetingConfig> {
    const configs = await this.systemConfigRepo.find({
      where: { section: 'customer_greeting' },
    });

    const configMap = new Map();
    configs.forEach(config => {
      configMap.set(config.name, config.value);
    });

    return {
      enabled: configMap.get('customer_greeting_enabled') === '1',
      cycleDays: parseInt(configMap.get('customer_greeting_inactive_days') || '7'),
      executionTime: configMap.get('customer_greeting_run_time') || '08:00',
      messageTemplate: configMap.get('customer_greeting_default_message') || 'Chúc bạn buổi sáng tốt lành!',
      allowCustomMessage: configMap.get('customer_greeting_allow_custom') === '1',
    };
  }

  /**
   * Lưu cấu hình auto-greeting vào system_config
   */
  async saveConfig(config: Partial<AutoGreetingConfig>): Promise<void> {
    const configs = [
      { name: 'customer_greeting_enabled', value: config.enabled ? '1' : '0', type: 'toggle', section: 'customer_greeting' },
      { name: 'customer_greeting_inactive_days', value: config.cycleDays?.toString() || '7', type: 'number', section: 'customer_greeting' },
      { name: 'customer_greeting_run_time', value: config.executionTime || '08:00', type: 'text', section: 'customer_greeting' },
      { name: 'customer_greeting_default_message', value: config.messageTemplate || 'Chúc bạn buổi sáng tốt lành!', type: 'text', section: 'customer_greeting' },
      { name: 'customer_greeting_allow_custom', value: config.allowCustomMessage ? '1' : '0', type: 'toggle', section: 'customer_greeting' },
    ];

    for (const configItem of configs) {
      await this.systemConfigRepo.upsert(
        {
          name: configItem.name,
          display_name: this.getDisplayName(configItem.name),
          value: configItem.value,
          type: configItem.type,
          section: configItem.section,
          status: 1,
        },
        ['name']
      );
    }

    this.logger.log('Auto-greeting config saved successfully');
  }

  private getDisplayName(name: string): string {
    const displayNames = {
      'customer_greeting_enabled': 'Customer Greeting Service Enabled',
      'customer_greeting_inactive_days': 'Customer Greeting Inactive Days Threshold',
      'customer_greeting_run_time': 'Customer Greeting Run Time (HH:MM)',
      'customer_greeting_default_message': 'Default Greeting Message',
      'customer_greeting_allow_custom': 'Allow Custom Greeting Messages',
    };
    return displayNames[name] || name;
  }

  /**
   * Lấy danh sách khách hàng cần gửi tin nhắn
   */
  async getCustomersForGreeting(userId?: number): Promise<CustomerWithLastMessage[]> {
    const config = await this.getConfig();
    if (!config.enabled) {
      return [];
    }

    // Sử dụng raw query để lấy dữ liệu chính xác
    let sql = `
      SELECT 
        c.id as customer_id,
        c.user_id as customer_user_id,
        c.zalo_display_name as customer_zalo_display_name,
        c.salutation as customer_salutation,
        c.greeting_message as customer_greeting_message,
        c.conversation_type as customer_conversation_type,
        c.last_message_date as customer_last_message_date,
        c.status as customer_status,
        (SELECT MAX(h.sent_at) FROM auto_greeting_customer_message_history h WHERE h.customer_id = c.id) as lastMessageDate
      FROM auto_greeting_customers c
      WHERE c.deleted_at IS NULL
    `;
    
    const params: any[] = [];
    if (userId) {
      sql += ` AND c.user_id = ?`;
      params.push(userId);
    }
    
    const customers = await this.autoGreetingCustomerRepo.query(sql, params);

    const now = new Date();
    const result: CustomerWithLastMessage[] = [];

    for (const customer of customers) {
      let customerLastMessageDate: Date | undefined = undefined;
      
      // Sử dụng customer_last_message_date thay vì lastMessageDate
      if (customer.customer_last_message_date) {
        // Parse date string thành Date object
        customerLastMessageDate = new Date(customer.customer_last_message_date);
        
        // Kiểm tra nếu date không hợp lệ
        if (isNaN(customerLastMessageDate.getTime())) {
          customerLastMessageDate = undefined;
        }
      }
      let daysSinceLastMessage: number | null;
      if (!customerLastMessageDate) {
        daysSinceLastMessage = null; // Nếu chưa có tin nhắn nào từ khách hàng
      } else {
        const diffTime = now.getTime() - customerLastMessageDate.getTime();
        daysSinceLastMessage = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        
        // Nếu ngày trong tương lai (có thể lỗi dữ liệu), coi như 0 ngày
        if (daysSinceLastMessage < 0) {
          daysSinceLastMessage = 0;
        }
      }

      let status: 'ready' | 'urgent' | 'stable' = 'stable';
      if (daysSinceLastMessage === null) {
        status = 'urgent'; // Nếu chưa có tin nhắn nào, coi như urgent
      } else if (daysSinceLastMessage >= config.cycleDays * 2) {
        status = 'urgent';
      } else if (daysSinceLastMessage >= config.cycleDays) {
        status = 'ready';
      }

      result.push({
        id: customer.customer_id,
        userId: customer.customer_user_id,
        zaloDisplayName: customer.customer_zalo_display_name || 'Khách hàng',
        salutation: customer.customer_salutation,
        greetingMessage: customer.customer_greeting_message,
        conversationType: customer.customer_conversation_type,
        lastMessageDate: customer.lastMessageDate ? new Date(customer.lastMessageDate).toISOString() : undefined,
        customerLastMessageDate: customerLastMessageDate ? customerLastMessageDate.toISOString() : undefined,
        customerStatus: customer.customer_status,
        daysSinceLastMessage,
        status,
      });
    }

    return result.sort((a, b) => {
      // Ưu tiên urgent trước, sau đó ready, cuối cùng stable
      const statusOrder = { urgent: 0, ready: 1, stable: 2 };
      return statusOrder[a.status] - statusOrder[b.status];
    });
  }

  /**
   * Gửi tin nhắn chào cho một khách hàng
   */
  async sendGreetingToCustomer(customerId: string, customMessage?: string): Promise<boolean> {
    try {
      const autoGreetingCustomer = await this.autoGreetingCustomerRepo.findOne({
        where: { id: customerId },
        relations: ['user'],
      });

      if (!autoGreetingCustomer) {
        this.logger.warn(`AutoGreetingCustomer with ID ${customerId} not found`);
        return false;
      }

      const config = await this.getConfig();
      const message = customMessage || autoGreetingCustomer.greetingMessage || config.messageTemplate;

      // Lưu tin nhắn vào lịch sử
      const messageHistory = this.autoGreetingMessageHistoryRepo.create({
        customerId,
        content: message,
        sentAt: new Date(),
      });

      await this.autoGreetingMessageHistoryRepo.save(messageHistory);

      // TODO: Tích hợp với Zalo API để gửi tin nhắn thực tế
      this.logger.log(`Greeting message sent to customer ${autoGreetingCustomer.zaloDisplayName}: ${message}`);

      return true;
    } catch (error) {
      this.logger.error(`Error sending greeting to customer ${customerId}:`, error);
      return false;
    }
  }

  /**
   * Gửi tin nhắn chào cho tất cả khách hàng cần gửi
   */
  async sendGreetingsToAllCustomers(userId?: number): Promise<{ success: number; failed: number }> {
    const customers = await this.getCustomersForGreeting(userId);
    const readyCustomers = customers.filter(c => c.status === 'ready' || c.status === 'urgent');

    let success = 0;
    let failed = 0;

    for (const customer of readyCustomers) {
      const result = await this.sendGreetingToCustomer(customer.id);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    this.logger.log(`Auto-greeting completed: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  /**
   * Import danh sách khách hàng từ Excel
   */
  async importCustomersFromExcel(userId: number, customers: Array<{
    zaloDisplayName: string;
    salutation?: string;
    greetingMessage?: string;
  }>): Promise<{ success: number; failed: number; errors: string[] }> {
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const customerData of customers) {
        try {
          // Kiểm tra xem khách hàng đã tồn tại chưa
          const existingAutoGreetingCustomer = await this.autoGreetingCustomerRepo.findOne({
            where: {
              userId,
              zaloDisplayName: customerData.zaloDisplayName,
            },
          });

          if (existingAutoGreetingCustomer) {
            // Cập nhật thông tin
            await this.autoGreetingCustomerRepo.update(existingAutoGreetingCustomer.id, {
              salutation: customerData.salutation,
              greetingMessage: customerData.greetingMessage,
            });
          } else {
            // Tạo mới
            const newAutoGreetingCustomer = this.autoGreetingCustomerRepo.create({
              userId,
              zaloDisplayName: customerData.zaloDisplayName,
              salutation: customerData.salutation,
              greetingMessage: customerData.greetingMessage,
            });
            await this.autoGreetingCustomerRepo.save(newAutoGreetingCustomer);
          }
        success++;
      } catch (error) {
        failed++;
        errors.push(`Error processing ${customerData.zaloDisplayName}: ${error.message}`);
      }
    }

    return { success, failed, errors };
  }

  /**
   * Lấy lịch sử tin nhắn của khách hàng
   */
  async getCustomerMessageHistory(customerId: string): Promise<AutoGreetingCustomerMessageHistory[]> {
    return this.autoGreetingMessageHistoryRepo.find({
      where: { customerId },
      order: { created_at: 'DESC' },
      take: 100,
    });
  }

  /**
   * Nhập khách hàng từ danh bạ contacts và tạo file Excel
   */
  async importFromContacts(userId: number, authHeader?: string): Promise<{ count: number; data: any[] }> {
    try {
      // Gọi đúng API swagger: /contacts?page=1&limit=...&user_id=...
      const primaryBase = process.env.CONTACTS_API_BASE_URL || process.env.API_BASE_URL;
      if (!primaryBase) {
        throw new Error('CONTACTS_API_BASE_URL is not set. Please set the external contacts API base URL.');
      }
      const limit = 1000;

      // Attempt 1: /contacts (swagger style)
      const urlSwagger = `${primaryBase}/contacts?page=1&limit=${limit}&user_id=${userId}`;
      let contacts: any[] = [];
      const headers: any = { Accept: 'application/json' };
      if (authHeader) headers.Authorization = authHeader;
      const res = await fetch(urlSwagger, { headers });
      if (!res.ok) {
        throw new Error(`Failed to fetch contacts: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      contacts = json?.data || [];

      console.log('Contacts fetched, sample:', contacts.slice(0, 2));
      console.log('Contacts array:', contacts);
      console.log('Contacts length:', contacts.length);

      if (!contacts || contacts.length === 0) {
        return { count: 0, data: [] };
      }

      // Tạo dữ liệu Excel theo format yêu cầu
      const excelData = contacts.map((contact: any) => ({
        'Tên hiển thị Zalo': contact.display_name || contact.name || contact.zaloName || 'Chưa có tên',
        'Xưng hô': '', // Để trống như yêu cầu
        'Tin nhắn chào': '', // Để trống như yêu cầu
      }));

      console.log('Excel data created:', excelData);
      console.log('Excel data length:', excelData.length);
      console.log('First excel row:', excelData[0]);

      this.logger.log(`Successfully processed ${contacts.length} contacts for user ${userId}`);
      
      return {
        count: contacts.length,
        data: excelData,
      };
    } catch (error) {
      this.logger.error('Error importing from contacts:', error);
      throw error;
    }
  }

  /**
   * Cập nhật thông tin khách hàng
   */
  async updateCustomer(
    customerId: string, 
    userId: number, 
    updateData: { zaloDisplayName?: string; salutation?: string; greetingMessage?: string }
  ): Promise<void> {
    this.logger.log(`Update customer request: customerId=${customerId}, userId=${userId}, updateData=${JSON.stringify(updateData)}`);
    
    // Kiểm tra xem khách hàng có tồn tại không
    const customer = await this.autoGreetingCustomerRepo.findOne({
      where: {
        id: customerId,
      },
    });

    if (!customer) {
      this.logger.error(`Customer ${customerId} not found in database`);
      throw new Error('Khách hàng không tồn tại');
    }

    // Kiểm tra quyền sở hữu
    if (customer.userId !== userId) {
      this.logger.error(`Customer ${customerId} owned by user ${customer.userId}, but request from user ${userId}`);
      throw new Error('Khách hàng không thuộc về bạn');
    }

    // Chuẩn bị dữ liệu cập nhật
    const updateFields: any = {};
    if (updateData.zaloDisplayName !== undefined) {
      updateFields.zaloDisplayName = updateData.zaloDisplayName;
    }
    if (updateData.salutation !== undefined) {
      updateFields.salutation = updateData.salutation;
    }
    if (updateData.greetingMessage !== undefined) {
      updateFields.greetingMessage = updateData.greetingMessage;
    }

    // Cập nhật thông tin
    await this.autoGreetingCustomerRepo.update(customerId, updateFields);

    this.logger.log(`Customer ${customerId} updated by user ${userId}: ${JSON.stringify(updateFields)}`);
  }

  /**
   * Cập nhật lời chào của khách hàng
   */
  async updateCustomerGreetingMessage(customerId: string, userId: number, greetingMessage: string): Promise<void> {
    // Kiểm tra xem khách hàng có thuộc về user này không
    const customer = await this.autoGreetingCustomerRepo.findOne({
      where: {
        id: customerId,
        userId: userId,
      },
    });

    if (!customer) {
      throw new Error('Khách hàng không tồn tại hoặc không thuộc về bạn');
    }

    // Cập nhật lời chào
    await this.autoGreetingCustomerRepo.update(customerId, {
      greetingMessage: greetingMessage,
    });

    this.logger.log(`Customer ${customerId} greeting message updated by user ${userId}`);
  }

  /**
   * Cập nhật hàng loạt khách hàng
   */
  async bulkUpdateCustomers(
    customerIds: string[], 
    userId: number, 
    updateData: { salutation?: string; greetingMessage?: string }
  ): Promise<number> {
    this.logger.log(`Bulk update request: customerIds=${JSON.stringify(customerIds)}, userId=${userId}, updateData=${JSON.stringify(updateData)}`);
    
    if (customerIds.length === 0) {
      return 0;
    }

    // Kiểm tra tất cả khách hàng có tồn tại không
    const allCustomers = await this.autoGreetingCustomerRepo.find({
      where: {
        id: In(customerIds),
      },
    });

    this.logger.log(`Found ${allCustomers.length} customers out of ${customerIds.length} requested`);
    this.logger.log(`All customers found: ${JSON.stringify(allCustomers.map(c => ({ id: c.id, userId: c.userId, zaloDisplayName: c.zaloDisplayName })))}`);

    if (allCustomers.length !== customerIds.length) {
      const foundIds = allCustomers.map(c => c.id);
      const missingIds = customerIds.filter(id => !foundIds.includes(id));
      this.logger.error(`Missing customers: ${JSON.stringify(missingIds)}`);
      throw new Error(`Một số khách hàng không tồn tại: ${missingIds.join(', ')}`);
    }

    // Kiểm tra quyền sở hữu
    const ownedCustomers = allCustomers.filter(c => c.userId === userId);
    this.logger.log(`Owned customers: ${ownedCustomers.length}, Requested: ${customerIds.length}, UserId: ${userId}`);
    this.logger.log(`Customer ownership details: ${JSON.stringify(allCustomers.map(c => ({ id: c.id, userId: c.userId, isOwned: c.userId === userId })))}`);
    
    if (ownedCustomers.length !== customerIds.length) {
      const notOwnedIds = allCustomers.filter(c => c.userId !== userId).map(c => c.id);
      this.logger.error(`Not owned customers: ${JSON.stringify(notOwnedIds)}`);
      throw new Error(`Một số khách hàng không thuộc về bạn: ${notOwnedIds.join(', ')}`);
    }

    // Chuẩn bị dữ liệu cập nhật
    const updateFields: any = {};
    if (updateData.salutation !== undefined) {
      updateFields.salutation = updateData.salutation;
    }
    if (updateData.greetingMessage !== undefined) {
      updateFields.greetingMessage = updateData.greetingMessage;
    }

    this.logger.log(`Update fields: ${JSON.stringify(updateFields)}`);

    // Cập nhật hàng loạt
    const result = await this.autoGreetingCustomerRepo.update(
      { id: In(customerIds), userId: userId },
      updateFields
    );

    this.logger.log(`Bulk updated ${result.affected} customers by user ${userId}: ${JSON.stringify(updateFields)}`);
    return result.affected || 0;
  }

  /**
   * Xóa hàng loạt khách hàng
   */
  async bulkDeleteCustomers(customerIds: string[], userId: number): Promise<number> {
    if (customerIds.length === 0) {
      return 0;
    }

    // Kiểm tra quyền sở hữu cho tất cả khách hàng
    const customers = await this.autoGreetingCustomerRepo.find({
      where: {
        id: In(customerIds),
        userId: userId,
      },
    });

    if (customers.length !== customerIds.length) {
      throw new Error('Một số khách hàng không tồn tại hoặc không thuộc về bạn');
    }

    // Xóa hàng loạt (soft delete)
    const result = await this.autoGreetingCustomerRepo.update(
      { id: In(customerIds), userId: userId },
      { deleted_at: new Date() }
    );

    this.logger.log(`Bulk deleted ${result.affected} customers by user ${userId}`);
    return result.affected || 0;
  }

  /**
   * Xóa khách hàng
   */
  async deleteCustomer(customerId: string, userId: number): Promise<void> {
    // Kiểm tra xem khách hàng có thuộc về user này không
    const customer = await this.autoGreetingCustomerRepo.findOne({
      where: {
        id: customerId,
        userId: userId,
      },
    });

    if (!customer) {
      throw new Error('Khách hàng không tồn tại hoặc không thuộc về bạn');
    }

    // Xóa khách hàng (soft delete)
    await this.autoGreetingCustomerRepo.update(customerId, {
      deleted_at: new Date(),
    });

    this.logger.log(`Customer ${customerId} deleted by user ${userId}`);
  }
}
