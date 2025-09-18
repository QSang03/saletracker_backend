import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  Headers,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { PermissionGuard } from '../common/guards/permission.guard';
import { Permission } from '../common/guards/permission.decorator';
import { AutoGreetingService, AutoGreetingConfig } from './auto_greeting.service';
import * as ExcelJS from 'exceljs';

@Controller('auto-greeting')
@UseGuards(AuthGuard('jwt'))
export class AutoGreetingController {
  constructor(private readonly autoGreetingService: AutoGreetingService) {  }

  /**
   * Cập nhật hàng loạt khách hàng
   */
  @Patch('customers/bulk-update')
  async bulkUpdateCustomers(
    @Body() body: { customerIds: string[]; updateData: { salutation?: string; greetingMessage?: string } },
    @Req() req: any,
    @Headers('x-master-key') masterKey: string,
  ): Promise<{ message: string; updatedCount: number }> {
    // Kiểm tra X-Master-Key
    const expectedMasterKey = process.env.MASTER_KEY || 'nkcai';
    if (!masterKey || masterKey !== expectedMasterKey) {
      throw new HttpException('Unauthorized: Invalid or missing X-Master-Key', HttpStatus.UNAUTHORIZED);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Đảm bảo userId là number
    const userIdNumber = typeof userId === 'string' ? parseInt(userId) : userId;
    
    console.log('Bulk update request received:', {
      userId: userIdNumber,
      userIdType: typeof userIdNumber,
      customerIds: body.customerIds,
      updateData: body.updateData,
      userInfo: req.user
    });

    const { customerIds, updateData } = body;
    const updatedCount = await this.autoGreetingService.bulkUpdateCustomers(customerIds, userIdNumber, updateData);
    return { 
      message: `Đã cập nhật ${updatedCount} khách hàng thành công`,
      updatedCount 
    };
  }

  /**
   * Cập nhật thông tin khách hàng
   */
  @Patch('customers/:customerId')
  async updateCustomer(
    @Param('customerId') customerId: string,
    @Body() updateData: { zaloDisplayName?: string; salutation?: string; greetingMessage?: string },
    @Req() req: any,
  ): Promise<{ message: string }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Đảm bảo userId là number
    const userIdNumber = typeof userId === 'string' ? parseInt(userId) : userId;
    
    console.log('Update customer request received:', {
      customerId,
      userId: userIdNumber,
      userIdType: typeof userIdNumber,
      updateData,
      userInfo: req.user
    });

    await this.autoGreetingService.updateCustomer(customerId, userIdNumber, updateData);
    return { message: 'Thông tin khách hàng đã được cập nhật thành công' };
  }

  /**
   * Xóa hàng loạt khách hàng
   */
  @Delete('customers/bulk-delete')
  async bulkDeleteCustomers(
    @Body() body: { customerIds: string[] },
    @Req() req: any,
    @Headers('x-master-key') masterKey: string,
  ): Promise<{ message: string; deletedCount: number }> {
    // Kiểm tra X-Master-Key
    const expectedMasterKey = process.env.MASTER_KEY || 'nkcai';
    if (!masterKey || masterKey !== expectedMasterKey) {
      throw new HttpException('Unauthorized: Invalid or missing X-Master-Key', HttpStatus.UNAUTHORIZED);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    // Đảm bảo userId là number
    const userIdNumber = typeof userId === 'string' ? parseInt(userId) : userId;

    const { customerIds } = body;
    const deletedCount = await this.autoGreetingService.bulkDeleteCustomers(customerIds, userIdNumber);
    return { 
      message: `Đã xóa ${deletedCount} khách hàng thành công`,
      deletedCount 
    };
  }

  /**
   * Cập nhật lời chào của khách hàng
   */
  @Patch('customers/:customerId/greeting-message')
  async updateCustomerGreetingMessage(
    @Param('customerId') customerId: string,
    @Body('greetingMessage') greetingMessage: string,
    @Req() req: any,
  ): Promise<{ message: string }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    await this.autoGreetingService.updateCustomerGreetingMessage(customerId, userId, greetingMessage);
    return { message: 'Lời chào đã được cập nhật thành công' };
  }

  /**
   * Xóa khách hàng
   */
  @Delete('customers/:customerId')
  async deleteCustomer(
    @Param('customerId') customerId: string,
    @Req() req: any,
    @Headers('x-master-key') masterKey: string,
  ): Promise<{ message: string }> {
    // Kiểm tra X-Master-Key
    const expectedMasterKey = process.env.MASTER_KEY || 'nkcai';
    if (!masterKey || masterKey !== expectedMasterKey) {
      throw new HttpException('Unauthorized: Invalid or missing X-Master-Key', HttpStatus.UNAUTHORIZED);
    }

    const userId = req.user?.id;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    await this.autoGreetingService.deleteCustomer(customerId, userId);
    return { message: 'Khách hàng đã được xóa thành công' };
  }

  /**
   * Lấy cấu hình auto-greeting
   */
  @Get('config')
  async getConfig(): Promise<AutoGreetingConfig> {
    return this.autoGreetingService.getConfig();
  }

  /**
   * Lưu cấu hình auto-greeting
   */
  @Patch('config')
  async saveConfig(@Body() config: Partial<AutoGreetingConfig>): Promise<{ message: string }> {
    await this.autoGreetingService.saveConfig(config);
    return { message: 'Cấu hình đã được lưu thành công' };
  }

  /**
   * Lấy danh sách khách hàng cần gửi tin nhắn
   */
  @Get('customers')
  async getCustomers(@Query('userId') userId?: string, @Req() req?: any) {
    let parsedUserId: number | undefined;
    
    if (userId) {
      // Nếu có userId parameter thì dùng parameter đó
      parsedUserId = parseInt(userId);
    } else {
      // Kiểm tra nếu user là admin
      const userRoles = req.user?.roles || [];
      const isAdmin = userRoles.some((role: any) => role.name === 'admin' || role.name === 'Admin');
      
      if (isAdmin) {
        // Admin thấy tất cả customers
        parsedUserId = undefined;
      } else {
        // User thường chỉ thấy customers của mình
        parsedUserId = req.user?.id;
      }
    }
    
    return this.autoGreetingService.getCustomersForGreeting(parsedUserId);
  }

  /**
   * Gửi tin nhắn chào cho một khách hàng cụ thể
   */
  @Post('send/:customerId')
  async sendGreetingToCustomer(
    @Param('customerId') customerId: string,
    @Body('message') customMessage?: string,
  ): Promise<{ success: boolean; message: string }> {
    const result = await this.autoGreetingService.sendGreetingToCustomer(customerId, customMessage);
    return {
      success: result,
      message: result ? 'Tin nhắn đã được gửi thành công' : 'Gửi tin nhắn thất bại',
    };
  }

  /**
   * Gửi tin nhắn chào cho tất cả khách hàng cần gửi
   */
  @Post('send-all')
  async sendGreetingsToAllCustomers(
    @Query('userId') userId?: string,
    @Req() req?: any,
  ): Promise<{ success: number; failed: number; message: string }> {
    const parsedUserId = userId ? parseInt(userId) : req.user?.id;
    const result = await this.autoGreetingService.sendGreetingsToAllCustomers(parsedUserId);
    return {
      ...result,
      message: `Đã gửi ${result.success} tin nhắn thành công, ${result.failed} tin nhắn thất bại`,
    };
  }

  /**
   * Upload file Excel để import danh sách khách hàng
   */
  @Post('import-customers')
  @UseInterceptors(FileInterceptor('file'))
  async importCustomers(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
    @Headers('x-master-key') masterKey: string,
  ): Promise<{ success: number; failed: number; errors: string[]; message: string }> {
    // Kiểm tra X-Master-Key
    const expectedMasterKey = process.env.MASTER_KEY || 'nkcai';
    if (!masterKey || masterKey !== expectedMasterKey) {
      throw new HttpException('Unauthorized: Invalid or missing X-Master-Key', HttpStatus.UNAUTHORIZED);
    }
    if (!file) {
      return {
        success: 0,
        failed: 0,
        errors: ['Không có file được upload'],
        message: 'Upload thất bại',
      };
    }

    try {
      // Kiểm tra file type
      if (!file.originalname.match(/\.(xlsx|xls)$/i)) {
        return {
          success: 0,
          failed: 0,
          errors: ['File phải có định dạng .xlsx hoặc .xls'],
          message: 'Định dạng file không hợp lệ',
        };
      }

      // Đọc file Excel sử dụng ExcelJS
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as any);
      
      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        return {
          success: 0,
          failed: 0,
          errors: ['File Excel không có worksheet'],
          message: 'File Excel không hợp lệ',
        };
      }

      const data: any[] = [];
      const headers: { [key: number]: string } = {};

      // Helper: extract plain text from ExcelJS cell value
      const getText = (val: any): string => {
        if (val === null || val === undefined) return '';
        if (typeof val === 'string' || typeof val === 'number') return String(val).trim();
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'object') {
          if (typeof (val as any).text === 'string') return String((val as any).text).trim();
          if (Array.isArray((val as any).richText)) {
            return (val as any).richText.map((t: any) => t.text || '').join('').trim();
          }
          if ((val as any).result !== undefined) return String((val as any).result).trim();
        }
        return String(val).trim();
      };

      // Detect header row by scanning first 10 rows
      let headerRowIndex = 1;
      const expectedHeaders = ['Tên hiển thị Zalo', 'Xưng hô', 'Tin nhắn chào'];
      const maxScan = Math.min(10, worksheet.rowCount);
      for (let r = 1; r <= maxScan; r++) {
        const row = worksheet.getRow(r);
        const values: string[] = [];
        row.eachCell((cell) => values.push(getText(cell.value)));
        const hit = expectedHeaders.every((h) => values.includes(h));
        if (hit) {
          headerRowIndex = r;
          break;
        }
      }

      // Build headers map from detected header row
      const headerRow = worksheet.getRow(headerRowIndex);
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = getText(cell.value);
      });

      // Process data rows after header
      for (let r = headerRowIndex + 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        let hasData = false;
        const rowData: any = {};
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const headerName = headers[colNumber];
          const text = getText(cell.value);
          if (headerName && text) {
            rowData[headerName] = text;
            hasData = true;
          }
        });

        // Skip empty rows and footer line
        const name = rowData['Tên hiển thị Zalo'];
        if (
          hasData &&
          name &&
          !String(name).toLowerCase().startsWith('tổng số khách hàng')
        ) {
          data.push(rowData);
        }
      }

      if (!data || data.length === 0) {
        return {
          success: 0,
          failed: 0,
          errors: ['File Excel không có dữ liệu'],
          message: 'File Excel trống',
        };
      }

      // Chuyển đổi dữ liệu theo format của campaign
      const customers = data.map((row: any) => ({
        zaloDisplayName: row['Tên hiển thị Zalo'] || row['zalo_display_name'] || row['name'] || row['Họ và tên'],
        salutation: row['Xưng hô'] || row['salutation'] || row['title'],
        greetingMessage: row['Tin nhắn chào'] || row['greeting_message'] || row['message'],
      })).filter(customer => customer.zaloDisplayName); // Chỉ lấy những dòng có tên

      const result = await this.autoGreetingService.importCustomersFromExcel(req.user?.id || 1, customers);

      return {
        ...result,
        message: `Import hoàn tất: ${result.success} thành công, ${result.failed} thất bại`,
      };
    } catch (error) {
      return {
        success: 0,
        failed: 0,
        errors: [`Lỗi đọc file: ${error.message}`],
        message: 'Lỗi xử lý file Excel',
      };
    }
  }

  /**
   * Lấy lịch sử tin nhắn của khách hàng
   */
  @Get('customers/:customerId/message-history')
  async getCustomerMessageHistory(
    @Param('customerId') customerId: string,
    @Headers('x-master-key') masterKey: string,
  ) {
    // Kiểm tra X-Master-Key
    const expectedMasterKey = process.env.MASTER_KEY || 'nkcai';
    if (!masterKey || masterKey !== expectedMasterKey) {
      throw new HttpException('Unauthorized: Invalid or missing X-Master-Key', HttpStatus.UNAUTHORIZED);
    }

    const history = await this.autoGreetingService.getCustomerMessageHistory(customerId);
    return history.map(h => ({
      id: Number(h.id),
      customer_id: Number(h.customerId),
      message: h.content,
      created_at: h.created_at,
      sent_at: h.sentAt,
    }));
  }

  /**
   * Chạy auto-greeting ngay lập tức (cho testing)
   */
  @Post('run-now')
  async runNow(@Query('userId') userId?: string, @Req() req?: any) {
    const parsedUserId = userId ? parseInt(userId) : req.user?.id;
    const result = await this.autoGreetingService.sendGreetingsToAllCustomers(parsedUserId);
    return {
      ...result,
      message: `Chạy auto-greeting hoàn tất: ${result.success} thành công, ${result.failed} thất bại`,
    };
  }

  /**
   * Xuất danh sách khách hàng ra file Excel (tất cả)
   */
  @Get('export-customers')
  async exportCustomers(@Query('userId') userId?: string, @Req() req?: any) {
    const customers = await this.autoGreetingService.getCustomersForGreeting(
      userId ? parseInt(userId) : undefined
    );

    // Tạo workbook mới
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Danh sách khách hàng');

    // Định nghĩa columns
    worksheet.columns = [
      { header: 'STT', key: 'index', width: 5 },
      { header: 'Mã Khách Hàng', key: 'id', width: 15 },
      { header: 'Tên Zalo Khách', key: 'zaloDisplayName', width: 25 },
      { header: 'Xưng hô', key: 'salutation', width: 10 },
      { header: 'Lời Chào', key: 'greetingMessage', width: 40 },
      { header: 'Loại Hội Thoại', key: 'conversationType', width: 15 },
      { header: 'Tin Nhắn Cuối', key: 'customerLastMessageDate', width: 20 },
      { header: 'Lần Cuối Gửi', key: 'lastMessageDate', width: 20 },
      { header: 'Số Ngày', key: 'daysSinceLastMessage', width: 10 },
      { header: 'Trạng Thái', key: 'customerStatus', width: 15 },
    ];

    // Style cho header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Thêm dữ liệu
    customers.forEach((customer, index) => {
      const row = worksheet.addRow({
        index: index + 1,
        id: customer.id,
        zaloDisplayName: customer.zaloDisplayName,
        salutation: customer.salutation || '',
        greetingMessage: customer.greetingMessage || '',
        conversationType: customer.conversationType === 'group' ? 'Nhóm' : 
                         customer.conversationType === 'private' ? 'Cá nhân' : 'Chưa xác định',
        customerLastMessageDate: customer.customerLastMessageDate 
          ? new Date(customer.customerLastMessageDate).toLocaleString('vi-VN')
          : 'Chưa có',
        lastMessageDate: customer.lastMessageDate 
          ? new Date(customer.lastMessageDate).toLocaleString('vi-VN')
          : 'Chưa gửi',
        daysSinceLastMessage: customer.daysSinceLastMessage === 999 ? '∞' : customer.daysSinceLastMessage,
        customerStatus: this.getCustomerStatusText(customer.customerStatus || 'normal'),
      });

      // Style cho từng row
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F8FF' }
        };
      }
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      if (column.width) {
        column.width = Math.max(column.width, 10);
      }
    });

    // Tạo buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: buffer,
      filename: `danh-sach-khach-hang-${new Date().toISOString().split('T')[0]}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    };
  }

  /**
   * Xuất danh sách khách hàng ra file Excel (theo bộ lọc)
   */
  @Post('export-customers-filtered')
  async exportCustomersFiltered(@Body() filters: {
    searchTerm?: string;
    statusFilter?: string;
    conversationTypeFilter?: string;
    dateFilter?: string;
  }, @Query('userId') userId?: string, @Req() req?: any) {
    // Lấy tất cả customers trước
    let customers = await this.autoGreetingService.getCustomersForGreeting(
      userId ? parseInt(userId) : undefined
    );

    // Áp dụng bộ lọc
    if (filters.searchTerm?.trim()) {
      const searchLower = filters.searchTerm.toLowerCase();
      customers = customers.filter((customer) => {
        return (
          customer.id.toLowerCase().includes(searchLower) ||
          customer.zaloDisplayName.toLowerCase().includes(searchLower) ||
          (customer.salutation && customer.salutation.toLowerCase().includes(searchLower)) ||
          (customer.greetingMessage && customer.greetingMessage.toLowerCase().includes(searchLower)) ||
          customer.userId.toString().includes(searchLower) ||
          (customer.conversationType && customer.conversationType.toLowerCase().includes(searchLower)) ||
          (customer.customerStatus && customer.customerStatus.toLowerCase().includes(searchLower))
        );
      });
    }

    if (filters.statusFilter && filters.statusFilter !== 'all') {
      customers = customers.filter((customer) => customer.customerStatus === filters.statusFilter);
    }

    if (filters.conversationTypeFilter && filters.conversationTypeFilter !== 'all') {
      customers = customers.filter((customer) => customer.conversationType === filters.conversationTypeFilter);
    }

    if (filters.dateFilter) {
      const filterDate = new Date(filters.dateFilter);
      customers = customers.filter((customer) => {
        if (customer.lastMessageDate) {
          const messageDate = new Date(customer.lastMessageDate);
          return messageDate.toDateString() === filterDate.toDateString();
        }
        return false;
      });
    }

    // Tạo workbook mới
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Danh sách khách hàng (đã lọc)');

    // Định nghĩa columns
    worksheet.columns = [
      { header: 'STT', key: 'index', width: 5 },
      { header: 'Mã Khách Hàng', key: 'id', width: 15 },
      { header: 'Tên Zalo Khách', key: 'zaloDisplayName', width: 25 },
      { header: 'Xưng hô', key: 'salutation', width: 10 },
      { header: 'Lời Chào', key: 'greetingMessage', width: 40 },
      { header: 'Loại Hội Thoại', key: 'conversationType', width: 15 },
      { header: 'Tin Nhắn Cuối', key: 'customerLastMessageDate', width: 20 },
      { header: 'Lần Cuối Gửi', key: 'lastMessageDate', width: 20 },
      { header: 'Số Ngày', key: 'daysSinceLastMessage', width: 10 },
      { header: 'Trạng Thái', key: 'customerStatus', width: 15 },
    ];

    // Style cho header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE6E6FA' }
    };

    // Thêm dữ liệu
    customers.forEach((customer, index) => {
      const row = worksheet.addRow({
        index: index + 1,
        id: customer.id,
        zaloDisplayName: customer.zaloDisplayName,
        salutation: customer.salutation || '',
        greetingMessage: customer.greetingMessage || '',
        conversationType: customer.conversationType === 'group' ? 'Nhóm' : 
                         customer.conversationType === 'private' ? 'Cá nhân' : 'Chưa xác định',
        customerLastMessageDate: customer.customerLastMessageDate 
          ? new Date(customer.customerLastMessageDate).toLocaleString('vi-VN')
          : 'Chưa có',
        lastMessageDate: customer.lastMessageDate 
          ? new Date(customer.lastMessageDate).toLocaleString('vi-VN')
          : 'Chưa gửi',
        daysSinceLastMessage: customer.daysSinceLastMessage === 999 ? '∞' : customer.daysSinceLastMessage,
        customerStatus: this.getCustomerStatusText(customer.customerStatus || 'normal'),
      });

      // Style cho từng row
      if (index % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8F8FF' }
        };
      }
    });

    // Auto-fit columns
    worksheet.columns.forEach(column => {
      if (column.width) {
        column.width = Math.max(column.width, 10);
      }
    });

    // Tạo buffer
    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: buffer,
      filename: `danh-sach-khach-hang-loc-${new Date().toISOString().split('T')[0]}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      data: customers // Thêm dữ liệu raw cho CSVExportPanel
    };
  }

  private getStatusText(status: string): string {
    switch (status) {
      case 'urgent':
        return 'Cần gửi ngay';
      case 'ready':
        return 'Sẵn sàng';
      case 'stable':
        return 'Ổn định';
      default:
        return 'Không xác định';
    }
  }

  private getCustomerStatusText(status: string): string {
    switch (status) {
      case 'urgent':
        return 'Cần báo gấp';
      case 'reminder':
        return 'Cần nhắc nhở';
      case 'normal':
        return 'Bình thường';
      default:
        return 'Bình thường';
    }
  }

  /**
   * Nhập khách hàng từ danh bạ contacts và tạo file Excel
   */
  @Post('import-from-contacts')
  @UseGuards(AuthGuard('jwt'))
  async importFromContacts(@Req() req: any, @Res() res: any) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new Error('User ID not found');
      }

      const authHeader = req.headers?.authorization || req.headers?.Authorization;
      const result = await this.autoGreetingService.importFromContacts(userId, authHeader);
      
      console.log('Import result:', result);
      console.log('Data count:', result.count);
      console.log('Data sample:', result.data.slice(0, 2));
      
      // Tạo file Excel từ dữ liệu contacts
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Danh sách khách hàng từ danh bạ');

      // Định nghĩa columns với formatting đẹp
      worksheet.columns = [
        { header: 'Tên hiển thị Zalo', key: 'name', width: 30 },
        { header: 'Xưng hô', key: 'salutation', width: 20 },
        { header: 'Tin nhắn chào', key: 'greeting', width: 50 },
      ];

      // Style cho header row (chỉ 3 ô A-C, tránh tô màu dư cột)
      const headerRow = worksheet.getRow(1);
      for (let col = 1; col <= 3; col++) {
        const cell = headerRow.getCell(col);
        cell.font = {
          name: 'Arial',
          size: 12,
          bold: true,
          color: { argb: 'FFFFFF' },
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: '4472C4' }, // Blue background
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
        };
        cell.border = {
          top: { style: 'thin', color: { argb: '000000' } },
          left: { style: 'thin', color: { argb: '000000' } },
          bottom: { style: 'thin', color: { argb: '000000' } },
          right: { style: 'thin', color: { argb: '000000' } },
        };
      }
      headerRow.height = 25;

      // Thêm dữ liệu với formatting đẹp
      result.data.forEach((row: any, index: number) => {
        const excelRow = worksheet.addRow({
          name: row['Tên hiển thị Zalo'],
          salutation: row['Xưng hô'],
          greeting: row['Tin nhắn chào']
        });

        // Font + alignment cho 3 ô đầu (A-C)
        for (let col = 1; col <= 3; col++) {
          const cell = excelRow.getCell(col);
          cell.font = { name: 'Arial', size: 10 };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
          cell.border = {
            top: { style: 'thin', color: { argb: 'D3D3D3' } },
            left: { style: 'thin', color: { argb: 'D3D3D3' } },
            bottom: { style: 'thin', color: { argb: 'D3D3D3' } },
            right: { style: 'thin', color: { argb: 'D3D3D3' } },
          };
          // Alternating row colors (zebra) chỉ áp cho 3 cột
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: index % 2 === 0 ? 'F2F2F2' : 'FFFFFF' },
          };
        }

        // Đảm bảo các cột sau C không bị tô
        excelRow.eachCell({ includeEmpty: true }, (c, col) => {
          if (col > 3) {
            c.fill = undefined as any;
            c.border = undefined as any;
            c.font = { name: 'Arial', size: 10 };
            c.alignment = { vertical: 'middle', horizontal: 'left' };
          }
        });

        // Row height
        excelRow.height = 20;
      });

      // Thêm title cho worksheet (merge đúng 3 cột A-C)
      worksheet.insertRow(1, ['']);
      const titleRow = worksheet.getRow(1);
      worksheet.mergeCells('A1:C1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'DANH SÁCH KHÁCH HÀNG TỪ DANH BẠ ZALO';
      titleCell.font = { 
        name: 'Arial', 
        size: 16, 
        bold: true, 
        color: { argb: '2F4F4F' }
      };
      titleCell.alignment = { 
        vertical: 'middle', 
        horizontal: 'center' 
      };
      titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'E6F3FF' } // Light blue background
      };
      titleRow.height = 30;

      // Thêm thông tin ngày tạo (merge đúng 3 cột A-C)
      worksheet.insertRow(2, ['']);
      const dateRow = worksheet.getRow(2);
      worksheet.mergeCells('A2:C2');
      const dateCell = worksheet.getCell('A2');
      dateCell.value = `Ngày tạo: ${new Date().toLocaleDateString('vi-VN')} ${new Date().toLocaleTimeString('vi-VN')}`;
      dateCell.font = { 
        name: 'Arial', 
        size: 10, 
        italic: true,
        color: { argb: '666666' }
      };
      dateCell.alignment = { 
        vertical: 'middle', 
        horizontal: 'center' 
      };
      dateRow.height = 20;

      // Thêm row trống
      worksheet.insertRow(3, ['']);
      
      // Freeze header row (bây giờ là row 4)
      worksheet.views = [
        { 
          state: 'frozen', 
          ySplit: 4 // Freeze first 4 rows (title, date, empty, header)
        }
      ];

      // Auto-fit columns nhưng giữ minimum width
      worksheet.columns.forEach(column => {
        if (column.width) {
          column.width = Math.max(column.width, 15);
        }
      });

      // Thêm footer với tổng số records (merge đúng 3 cột A-C)
      const lastRowNum = worksheet.rowCount + 1;
      worksheet.addRow(['']);
      const footerRow = worksheet.getRow(lastRowNum);
      worksheet.mergeCells(`A${lastRowNum}:C${lastRowNum}`);
      const footerCell = worksheet.getCell(`A${lastRowNum}`);
      footerCell.value = `Tổng số khách hàng: ${result.count}`;
      footerCell.font = { 
        name: 'Arial', 
        size: 10, 
        bold: true,
        color: { argb: '4472C4' }
      };
      footerCell.alignment = { 
        vertical: 'middle', 
        horizontal: 'center' 
      };
      footerCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'F0F8FF' } // Very light blue
      };
      footerRow.height = 25;

      // Tạo buffer
      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `danh-sach-khach-hang-tu-danh-ba-${new Date().toISOString().split('T')[0]}.xlsx`;

      // Set headers cho file download
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(buffer));

      // Gửi buffer trực tiếp
      return res.send(buffer);
    } catch (error) {
      console.error('Error importing from contacts:', error);
      throw new HttpException(
        error.message || 'Failed to import from contacts',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
