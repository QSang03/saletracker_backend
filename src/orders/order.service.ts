import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';

interface OrderFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  date?: string;
  employee?: string;
  user?: any; // truyền cả user object
}

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
  ) {}

  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      relations: ['details', 'sale_by'],
    });
  }

  async findAllPaginated(filters: OrderFilters): Promise<{
    data: OrderDetail[]; // Thay đổi return type
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page, pageSize, search, status, date, employee, user } = filters;
    const skip = (page - 1) * pageSize;

    const queryBuilder = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by');

    // Phân quyền: admin xem tất cả, manager xem theo phòng, user thường chỉ xem đơn của mình
    if (user) {
      const roleNames = (user.roles || []).map((r: any) => r.name);
      if (!roleNames.includes('admin')) {
        if (roleNames.some((r: string) => r.startsWith('manager-'))) {
          // Manager: xem tất cả đơn của phòng mình
          const deptIds = (user.departments || []).map((d: any) => d.id);
          if (deptIds.length > 0) {
            queryBuilder.andWhere('sale_by.departmentId IN (:...deptIds)', { deptIds });
          }
        } else {
          // User thường: chỉ xem đơn của mình
          queryBuilder.andWhere('order.sale_by = :userId', { userId: user.id });
        }
      }
    }

    // Filter by search (search in order details customer_name or order id)
    if (search) {
      queryBuilder.andWhere(
        '(details.customer_name LIKE :search OR CAST(order.id AS CHAR) LIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Filter by status (order detail status)
    if (status) {
      queryBuilder.andWhere('details.status = :status', { status });
    }

    // Filter by date
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      queryBuilder.andWhere(
        'order.created_at BETWEEN :startDate AND :endDate',
        { startDate, endDate }
      );
    }

    // Filter by employee (sale_by)
    if (employee) {
      queryBuilder.andWhere('sale_by.id = :employee', { employee });
    }

    // Filter by userId (người dùng tạo đơn hàng)
    if (user) {
      queryBuilder.andWhere('order.user_id = :userId', { userId: user.id });
    }

    // Order by order created_at desc
    queryBuilder.orderBy('order.created_at', 'DESC');

    // Get total count of ORDER_DETAILS before pagination
    const total = await queryBuilder.getCount();

    // Apply pagination on ORDER_DETAILS (10 order_details per page)
    queryBuilder.skip(skip).take(pageSize);

    const data = await queryBuilder.getMany();

    return {
      data, // Trả về array of OrderDetail
      total, // Tổng số order_details
      page,
      pageSize,
    };
  }

  async findById(id: number): Promise<Order | null> {
    return this.orderRepository.findOne({
      where: { id },
      relations: ['details', 'details.product', 'sale_by'],
    });
  }

  async create(orderData: Partial<Order>): Promise<Order> {
    const order = this.orderRepository.create(orderData);
    return this.orderRepository.save(order);
  }

  async update(id: number, orderData: Partial<Order>): Promise<Order | null> {
    await this.orderRepository.update(id, orderData);
    return this.findById(id);
  }

  async delete(id: number): Promise<void> {
    await this.orderRepository.softDelete(id);
  }
}
