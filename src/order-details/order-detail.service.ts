import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrderDetail } from './order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';

@Injectable()
export class OrderDetailService {
  constructor(
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(Department)
    private departmentRepository: Repository<Department>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findAll(): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      relations: ['order', 'order.sale_by', 'product'],
    });
  }

  // Helper method để lấy user IDs dựa trên role của user
  private async getUserIdsByRole(user: any): Promise<number[] | null> {
    if (!user) return null;

    const roleNames = (user.roles || []).map((r: any) => 
      typeof r === 'string' 
        ? r.toLowerCase() 
        : (r.name || '').toLowerCase()
    );
    
    const isAdmin = roleNames.includes('admin');
    if (isAdmin) return null; // Admin có thể xem tất cả

    const managerRoles = roleNames.filter((r: string) => r.startsWith('manager-'));
    
    if (managerRoles.length > 0) {
      // Manager: lấy tất cả user trong phòng ban
      const departmentSlugs = managerRoles.map((r: string) => r.replace('manager-', ''));
      
      const departments = await this.departmentRepository.find({
        where: departmentSlugs.map(slug => ({ slug }))
      });
      
      if (departments.length > 0) {
        const departmentIds = departments.map(d => d.id);
        
        const usersInDepartments = await this.userRepository
          .createQueryBuilder('user')
          .leftJoin('user.departments', 'dept')
          .where('dept.id IN (:...departmentIds)', { departmentIds })
          .getMany();
        
        return usersInDepartments.map(u => u.id);
      } else {
        return []; // Manager không có department hợp lệ
      }
    } else {
      // User thường: chỉ xem của chính họ
      return [user.id];
    }
  }

  async findAllWithPermission(user?: any): Promise<OrderDetail[]> {
    const queryBuilder = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by');

    const allowedUserIds = await this.getUserIdsByRole(user);
    
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0'); // Không có quyền xem gì
      } else {
        queryBuilder.andWhere('sale_by.id IN (:...userIds)', { userIds: allowedUserIds });
      }
    }
    // Admin (allowedUserIds === null) không có điều kiện gì

    return queryBuilder.getMany();
  }

  async findById(id: number): Promise<OrderDetail | null> {
    return this.orderDetailRepository.findOne({
      where: { id },
      relations: ['order', 'order.sale_by', 'product'],
    });
  }

  async findByIdWithPermission(id: number, user?: any): Promise<OrderDetail | null> {
    const orderDetail = await this.findById(id);
    
    // Kiểm tra quyền xem order detail này
    if (orderDetail && user) {
      const allowedUserIds = await this.getUserIdsByRole(user);
      
      if (allowedUserIds !== null) {
        if (allowedUserIds.length === 0 || !allowedUserIds.includes(orderDetail.order.sale_by?.id)) {
          return null; // Không có quyền xem
        }
      }
      // Admin (allowedUserIds === null) có thể xem tất cả
    }
    
    return orderDetail;
  }

  async findByOrderId(orderId: number): Promise<OrderDetail[]> {
    return this.orderDetailRepository.find({
      where: { order_id: orderId },
      relations: ['product'],
    });
  }

  async findByZaloMessageId(zaloMessageId: string): Promise<OrderDetail | null> {
    return this.orderDetailRepository.findOne({ where: { zaloMessageId } });
  }

  async getCustomerNameByZaloMessageId(zaloMessageId: string): Promise<string | null> {
    const detail = await this.orderDetailRepository.findOne({ where: { zaloMessageId } });
    return detail?.customer_name || null;
  }

  async create(orderDetailData: Partial<OrderDetail>): Promise<OrderDetail> {
    const orderDetail = this.orderDetailRepository.create(orderDetailData);
    return this.orderDetailRepository.save(orderDetail);
  }

  async update(
    id: number,
    orderDetailData: Partial<OrderDetail>,
  ): Promise<OrderDetail | null> {
    // ✅ Xử lý đặc biệt cho trường extended - cộng thêm thay vì ghi đè
    if (orderDetailData.extended !== undefined) {
      const currentOrderDetail = await this.findById(id);
      if (currentOrderDetail) {
        const currentExtended = currentOrderDetail.extended || 4;
        orderDetailData.extended = currentExtended + orderDetailData.extended;
      }
    }
    
    await this.orderDetailRepository.update(id, orderDetailData);
    return this.findById(id);
  }

  async updateCustomerName(
    id: number,
    customerName: string,
  ): Promise<OrderDetail | null> {
    // Lấy thông tin order detail hiện tại để extract customer_id từ metadata
    const currentOrderDetail = await this.findById(id);
    if (!currentOrderDetail) {
      throw new Error('Order detail not found');
    }

    // Parse metadata để lấy customer_id
    let customerId: string | null = null;
    try {
      if (currentOrderDetail.metadata) {
        const metadata = typeof currentOrderDetail.metadata === 'string' 
          ? JSON.parse(currentOrderDetail.metadata) 
          : currentOrderDetail.metadata;
        customerId = metadata.customer_id;
      }
    } catch (error) {
      console.warn('Error parsing metadata:', error);
    }

    if (customerId) {
      // Tìm tất cả order details có cùng customer_id trong metadata
      // Sử dụng MySQL JSON syntax
      const orderDetailsWithSameCustomer = await this.orderDetailRepository
        .createQueryBuilder('orderDetail')
        .where("JSON_UNQUOTE(JSON_EXTRACT(orderDetail.metadata, '$.customer_id')) = :customerId", { customerId })
        .getMany();

      // Cập nhật tên khách hàng cho tất cả order details có cùng customer_id
      const idsToUpdate = orderDetailsWithSameCustomer.map(od => od.id);
      if (idsToUpdate.length > 0) {
        await this.orderDetailRepository
          .createQueryBuilder()
          .update(OrderDetail)
          .set({ customer_name: customerName })
          .where('id IN (:...ids)', { ids: idsToUpdate })
          .execute();
      }
    } else {
      // Fallback: chỉ cập nhật order detail hiện tại nếu không có customer_id
      await this.orderDetailRepository.update(id, { customer_name: customerName });
    }

    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.orderDetailRepository.softDelete(id);
  }

  async deleteByOrderId(orderId: number): Promise<void> {
    await this.orderDetailRepository.softDelete({ order_id: orderId });
  }

  // ✅ Bulk operations
  async bulkDelete(ids: number[], reason: string, user: any): Promise<{ deleted: number }> {
    // Kiểm tra quyền cho từng order detail
    const allowedUserIds = await this.getUserIdsByRole(user);
    
    let queryBuilder = this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids });

    if (allowedUserIds !== null) {
      queryBuilder = queryBuilder.andWhere('order.sale_by_id IN (:...allowedUserIds)', { allowedUserIds });
    }

    const orderDetails = await queryBuilder.getMany();
    
    if (orderDetails.length === 0) {
      return { deleted: 0 };
    }

    // Cập nhật reason và soft delete
    await this.orderDetailRepository.update(
      orderDetails.map(od => od.id),
      { reason }
    );

    await this.orderDetailRepository.softDelete(orderDetails.map(od => od.id));
    
    return { deleted: orderDetails.length };
  }

  async bulkUpdate(ids: number[], updates: Partial<OrderDetail>, user: any): Promise<{ updated: number }> {
    // Kiểm tra quyền cho từng order detail
    const allowedUserIds = await this.getUserIdsByRole(user);
    
    let queryBuilder = this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids });

    if (allowedUserIds !== null) {
      queryBuilder = queryBuilder.andWhere('order.sale_by_id IN (:...allowedUserIds)', { allowedUserIds });
    }

    const orderDetails = await queryBuilder.getMany();
    
    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    await this.orderDetailRepository.update(
      orderDetails.map(od => od.id),
      updates
    );
    
    return { updated: orderDetails.length };
  }

  async bulkExtend(ids: number[], user: any): Promise<{ updated: number }> {
    // Kiểm tra quyền cho từng order detail
    const allowedUserIds = await this.getUserIdsByRole(user);
    
    let queryBuilder = this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids });

    if (allowedUserIds !== null) {
      queryBuilder = queryBuilder.andWhere('order.sale_by_id IN (:...allowedUserIds)', { allowedUserIds });
    }

    const orderDetails = await queryBuilder.getMany();
    
    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    // Gia hạn thêm 4 ngày cho mỗi order detail
    for (const orderDetail of orderDetails) {
      const currentExtended = orderDetail.extended || 4;
      await this.orderDetailRepository.update(orderDetail.id, {
        extended: currentExtended + 4
      });
    }
    
    return { updated: orderDetails.length };
  }

  async bulkAddNotes(ids: number[], notes: string, user: any): Promise<{ updated: number }> {
    // Kiểm tra quyền cho từng order detail
    const allowedUserIds = await this.getUserIdsByRole(user);
    
    let queryBuilder = this.orderDetailRepository
      .createQueryBuilder('orderDetail')
      .leftJoinAndSelect('orderDetail.order', 'order')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .where('orderDetail.id IN (:...ids)', { ids });

    if (allowedUserIds !== null) {
      queryBuilder = queryBuilder.andWhere('order.sale_by_id IN (:...allowedUserIds)', { allowedUserIds });
    }

    const orderDetails = await queryBuilder.getMany();
    
    if (orderDetails.length === 0) {
      return { updated: 0 };
    }

    // ✅ Ghi đè ghi chú thay vì append
    await this.orderDetailRepository.update(
      orderDetails.map(od => od.id),
      { notes }
    );
    
    return { updated: orderDetails.length };
  }
}
