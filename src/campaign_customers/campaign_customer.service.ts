import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CampaignCustomer } from './campaign_customer.entity';
import * as ExcelJS from 'exceljs';

export interface CustomerImportData {
  phone_number: string;
  full_name: string;
  salutation?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class CampaignCustomerService {
  constructor(
    @InjectRepository(CampaignCustomer)
    private readonly campaignCustomerRepository: Repository<CampaignCustomer>,
  ) {}

  async findAll(query: any): Promise<{ data: CampaignCustomer[]; total: number }> {
    const qb = this.campaignCustomerRepository.createQueryBuilder('customer');

    // Filter by search (phone or name)
    if (query.search) {
      qb.andWhere(
        '(customer.phone_number LIKE :search OR customer.full_name LIKE :search)',
        { search: `%${query.search}%` }
      );
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page) || 1);
    const pageSize = Math.max(1, parseInt(query.pageSize) || 10);
    const skip = (page - 1) * pageSize;

    qb.skip(skip).take(pageSize);
    qb.orderBy('customer.created_at', 'DESC');

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<CampaignCustomer> {
    const customer = await this.campaignCustomerRepository.findOne({ where: { id } });
    if (!customer) {
      throw new BadRequestException('Không tìm thấy khách hàng');
    }
    return customer;
  }

  async create(data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    // Validate phone number format
    if (data.phone_number && !this.isValidPhoneNumber(data.phone_number)) {
      throw new BadRequestException('Số điện thoại không hợp lệ');
    }

    const customer = this.campaignCustomerRepository.create(data);
    return this.campaignCustomerRepository.save(customer);
  }

  async bulkCreate(customersData: CustomerImportData[]): Promise<CampaignCustomer[]> {
    // Validate all phone numbers
    const invalidPhones = customersData.filter(customer => 
      !this.isValidPhoneNumber(customer.phone_number)
    );

    if (invalidPhones.length > 0) {
      throw new BadRequestException(`Có ${invalidPhones.length} số điện thoại không hợp lệ`);
    }

    // Check for duplicates within the batch
    const phoneNumbers = customersData.map(c => c.phone_number);
    const uniquePhones = new Set(phoneNumbers);
    if (phoneNumbers.length !== uniquePhones.size) {
      throw new BadRequestException('Có số điện thoại trùng lặp trong file');
    }

    // Check for existing customers
    const existingCustomers = await this.campaignCustomerRepository
      .createQueryBuilder('customer')
      .where('customer.phone_number IN (:...phones)', { phones: phoneNumbers })
      .getMany();

    if (existingCustomers.length > 0) {
      throw new BadRequestException(
        `Có ${existingCustomers.length} số điện thoại đã tồn tại trong hệ thống`
      );
    }

    const customers = customersData.map(data => 
      this.campaignCustomerRepository.create(data)
    );

    return this.campaignCustomerRepository.save(customers);
  }

  async importFromExcel(buffer: Buffer): Promise<{ 
    success: boolean; 
    imported: number; 
    errors: string[] 
  }> {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      
      const worksheet = workbook.getWorksheet(1);
      if (!worksheet) {
        throw new BadRequestException('File Excel không có worksheet');
      }

      const data: any[] = [];
      const headers: { [key: number]: string } = {};
      
      // Get headers from first row
      const headerRow = worksheet.getRow(1);
      headerRow.eachCell((cell, colNumber) => {
        headers[colNumber] = String(cell.value || '');
      });
      
      // Process data rows
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header row
        
        const rowData: any = {};
        row.eachCell((cell, colNumber) => {
          const headerName = headers[colNumber];
          if (headerName) {
            rowData[headerName] = cell.value;
          }
        });
        
        if (Object.keys(rowData).length > 0) {
          data.push(rowData);
        }
      });

      if (!data || data.length === 0) {
        throw new BadRequestException('File Excel không có dữ liệu');
      }

      const errors: string[] = [];
      const customers: CustomerImportData[] = [];

      data.forEach((row: any, index: number) => {
        const rowNum = index + 2; // Excel rows start from 1, plus header

        // Validate required fields
        if (!row['Số điện thoại'] || !row['Họ và tên']) {
          errors.push(`Dòng ${rowNum}: Thiếu số điện thoại hoặc họ tên`);
          return;
        }

        const phoneNumber = String(row['Số điện thoại']).trim();
        const fullName = String(row['Họ và tên']).trim();
        const salutation = row['Xưng hô'] ? String(row['Xưng hô']).trim() : undefined;

        if (!this.isValidPhoneNumber(phoneNumber)) {
          errors.push(`Dòng ${rowNum}: Số điện thoại không hợp lệ`);
          return;
        }

        customers.push({
          phone_number: phoneNumber,
          full_name: fullName,
          salutation,
          metadata: {
            importedAt: new Date().toISOString(),
            rowNumber: rowNum
          }
        });
      });

      if (errors.length > 0) {
        return { success: false, imported: 0, errors };
      }

      const savedCustomers = await this.bulkCreate(customers);
      return { 
        success: true, 
        imported: savedCustomers.length, 
        errors: [] 
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Không thể đọc file Excel: ' + error.message);
    }
  }

  async update(id: string, data: Partial<CampaignCustomer>): Promise<CampaignCustomer> {
    await this.campaignCustomerRepository.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.campaignCustomerRepository.delete(id);
  }

  async bulkRemove(ids: string[]): Promise<void> {
    await this.campaignCustomerRepository.delete(ids);
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Vietnamese phone number validation
    const phoneRegex = /^(84|0)(3|5|7|8|9)[0-9]{8}$/;
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    return phoneRegex.test(cleanPhone);
  }
}
