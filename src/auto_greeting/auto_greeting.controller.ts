import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
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
  constructor(private readonly autoGreetingService: AutoGreetingService) {}

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
  ): Promise<{ success: number; failed: number; errors: string[]; message: string }> {
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

      console.log('Worksheet found, row count:', worksheet.rowCount);

      const data: any[] = [];
      const headers: { [key: number]: string } = {};
      
      // Get headers from first row
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '');
      });
      
      console.log('Headers:', headers);
      
      // Process data rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row
        
        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const headerName = headers[colNumber];
          if (headerName && cell.value !== null && cell.value !== undefined) {
            rowData[headerName] = cell.value;
          }
        });
        
        // Chỉ thêm row nếu có dữ liệu và có ít nhất tên khách hàng
        if (Object.keys(rowData).length > 0 && rowData['Tên hiển thị Zalo']) {
          data.push(rowData);
        }
      });
      
      console.log('Processed data:', data);

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
  async getCustomerMessageHistory(@Param('customerId') customerId: string) {
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
}
