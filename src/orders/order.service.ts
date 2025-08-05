import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, Between } from 'typeorm';
import { Order } from './order.entity';
import { OrderDetail } from 'src/order-details/order-detail.entity';
import { Department } from 'src/departments/department.entity';
import { User } from 'src/users/user.entity';
import { Product } from 'src/products/product.entity';

interface OrderFilters {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  date?: string;
  dateRange?: { start: string; end: string };
  employee?: string;
  employees?: string;
  departments?: string;
  products?: string;
  warningLevel?: string;
  user?: any; // truyền cả user object
}

@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @InjectRepository(OrderDetail)
    private orderDetailRepository: Repository<OrderDetail>,
    @InjectRepository(Department)
    private departmentRepository: Repository<Department>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
  ) {}

  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      relations: ['details', 'sale_by', 'sale_by.departments'],
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

  async findAllWithPermission(user?: any): Promise<Order[]> {
    const queryBuilder = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.details', 'details')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments');

    const allowedUserIds = await this.getUserIdsByRole(user);
    
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0'); // Không có quyền xem gì
      } else {
        queryBuilder.andWhere('order.sale_by IN (:...userIds)', { userIds: allowedUserIds });
      }
    }
    // Admin (allowedUserIds === null) không có điều kiện gì

    return queryBuilder.getMany();
  }

  async getFilterOptions(user?: any): Promise<{
    departments: Array<{ value: number; label: string; users: Array<{ value: number; label: string }> }>;
    products: Array<{ value: number; label: string }>;
  }> {
    const result: {
      departments: Array<{ value: number; label: string; users: Array<{ value: number; label: string }> }>;
      products: Array<{ value: number; label: string }>;
    } = {
      departments: [],
      products: []
    };

    // Lấy danh sách sản phẩm
    const products = await this.productRepository.find({
      select: ['id', 'productName'],
      order: { productName: 'ASC' }
    });
    
    result.products = products.map(p => ({
      value: p.id,
      label: p.productName
    }));

    // Phân quyền cho departments và users
    if (!user) return result;

    const roleNames = (user.roles || []).map((r: any) => 
      typeof r === 'string' 
        ? r.toLowerCase() 
        : (r.name || '').toLowerCase()
    );
    
    const isAdmin = roleNames.includes('admin');
    
    if (isAdmin) {
      // Admin: lấy tất cả departments và users
      const departments = await this.departmentRepository.find({
        relations: ['users'],
        order: { name: 'ASC' }
      });
      
      result.departments = departments.map(dept => ({
        value: dept.id,
        label: dept.name,
        users: (dept.users || []).map(u => ({
          value: u.id,
          label: u.fullName || u.username
        }))
      }));
    } else {
      const managerRoles = roleNames.filter((r: string) => r.startsWith('manager-'));
      
      if (managerRoles.length > 0) {
        // Manager: chỉ lấy department của mình và users trong đó
        const departmentSlugs = managerRoles.map((r: string) => r.replace('manager-', ''));
        
        const departments = await this.departmentRepository.find({
          where: departmentSlugs.map(slug => ({ slug })),
          relations: ['users'],
          order: { name: 'ASC' }
        });
        
        result.departments = departments.map(dept => ({
          value: dept.id,
          label: dept.name,
          users: (dept.users || []).map(u => ({
            value: u.id,
            label: u.fullName || u.username
          }))
        }));
      } else {
        // User thường: chỉ thấy chính mình và department của mình
        const currentUser = await this.userRepository.findOne({
          where: { id: user.id },
          relations: ['departments']
        });
        
        if (currentUser && currentUser.departments) {
          result.departments = currentUser.departments.map(dept => ({
            value: dept.id,
            label: dept.name,
            users: [{
              value: currentUser.id,
              label: currentUser.fullName || currentUser.username
            }]
          }));
        }
      }
    }

    return result;
  }

  async findAllPaginated(filters: OrderFilters): Promise<{
    data: OrderDetail[]; // Thay đổi return type
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { 
      page, 
      pageSize, 
      search, 
      status, 
      date, 
      dateRange,
      employee, 
      employees,
      departments,
      products,
      warningLevel,
      user 
    } = filters;
    const skip = (page - 1) * pageSize;

    const queryBuilder = this.orderDetailRepository
      .createQueryBuilder('details')
      .leftJoinAndSelect('details.order', 'order')
      .leftJoinAndSelect('details.product', 'product')
      .leftJoinAndSelect('order.sale_by', 'sale_by')
      .leftJoinAndSelect('sale_by.departments', 'sale_by_departments');

    // Phân quyền: admin xem tất cả, manager xem theo phòng, user thường chỉ xem đơn của mình
    const allowedUserIds = await this.getUserIdsByRole(user);
    
    if (allowedUserIds !== null) {
      if (allowedUserIds.length === 0) {
        queryBuilder.andWhere('1 = 0'); // Không có quyền xem gì
      } else {
        queryBuilder.andWhere('order.sale_by IN (:...userIds)', { userIds: allowedUserIds });
      }
    }
    // Admin (allowedUserIds === null) không có điều kiện gì

    // Filter by search (tìm kiếm theo order_details.id, customer_name, raw_item)
    if (search) {
      queryBuilder.andWhere(
        '(CAST(details.id AS CHAR) LIKE :search OR details.customer_name LIKE :search OR details.raw_item LIKE :search)',
        { search: `%${search}%` }
      );
    }

    // Filter by status (order detail status)
    if (status) {
      queryBuilder.andWhere('details.status = :status', { status });
    }

    // Filter by single date
    if (date) {
      const startDate = new Date(date);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      
      queryBuilder.andWhere(
        'order.created_at BETWEEN :startDate AND :endDate',
        { startDate, endDate }
      );
    }

    // Filter by date range
    if (dateRange && dateRange.start && dateRange.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      endDate.setHours(23, 59, 59, 999);
      
      queryBuilder.andWhere(
        'order.created_at BETWEEN :rangeStart AND :rangeEnd',
        { rangeStart: startDate, rangeEnd: endDate }
      );
    }

    // Filter by single employee (backward compatibility)
    if (employee) {
      queryBuilder.andWhere('sale_by.id = :employee', { employee });
    }

    // Filter by multiple employees
    if (employees) {
      const employeeIds = employees.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (employeeIds.length > 0) {
        queryBuilder.andWhere('sale_by.id IN (:...employeeIds)', { employeeIds });
      }
    }

    // Filter by multiple departments
    if (departments) {
      const departmentIds = departments.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (departmentIds.length > 0) {
        queryBuilder.andWhere('sale_by_departments.id IN (:...departmentIds)', { departmentIds });
      }
    }

    // Filter by multiple products
    if (products) {
      const productIds = products.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
      if (productIds.length > 0) {
        queryBuilder.andWhere('details.product_id IN (:...productIds)', { productIds });
      }
    }

    // Filter by warning level (extended)
    if (warningLevel) {
      const levels = warningLevel.split(',').map(level => parseInt(level.trim(), 10)).filter(level => !isNaN(level));
      if (levels.length > 0) {
        queryBuilder.andWhere('details.extended IN (:...levels)', { levels });
      }
    }

    // Order by order created_at desc
    queryBuilder.orderBy('details.id', 'DESC');

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
      relations: ['details', 'details.product', 'sale_by', 'sale_by.departments'],
    });
  }

  async findByIdWithPermission(id: number, user?: any): Promise<Order | null> {
    const order = await this.findById(id);
    
    // Kiểm tra quyền xem order này
    if (order && user) {
      const allowedUserIds = await this.getUserIdsByRole(user);
      
      if (allowedUserIds !== null) {
        if (allowedUserIds.length === 0 || !allowedUserIds.includes(order.sale_by?.id)) {
          return null; // Không có quyền xem
        }
      }
      // Admin (allowedUserIds === null) có thể xem tất cả
    }
    
    return order;
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
