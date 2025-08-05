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
    await this.orderDetailRepository.update(id, orderDetailData);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.orderDetailRepository.softDelete(id);
  }

  async deleteByOrderId(orderId: number): Promise<void> {
    await this.orderDetailRepository.softDelete({ order_id: orderId });
  }
}
