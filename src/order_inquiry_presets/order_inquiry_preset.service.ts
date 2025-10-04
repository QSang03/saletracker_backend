import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { OrderInquiryPreset } from './order_inquiry_preset.entity';
import { CreateOrderInquiryPresetDto } from './dto/create-order-inquiry-preset.dto';
import { UpdateOrderInquiryPresetDto } from './dto/update-order-inquiry-preset.dto';
import { FindOrderInquiryPresetDto } from './dto/find-order-inquiry-preset.dto';
import { User } from '../users/user.entity';
import { getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class OrderInquiryPresetService {
  constructor(
    @InjectRepository(OrderInquiryPreset)
    private readonly presetRepository: Repository<OrderInquiryPreset>,
  ) {}

  async create(
    createDto: CreateOrderInquiryPresetDto,
    user: User,
  ): Promise<OrderInquiryPreset> {
    const preset = this.presetRepository.create({
      ...createDto,
      user_id: user.id,
      user,
    });

    return await this.presetRepository.save(preset);
  }

  async findAll(
    query: FindOrderInquiryPresetDto,
    user: User,
  ): Promise<{
    data: OrderInquiryPreset[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const { page = 1, pageSize = 10, search, userId } = query;
    const roleNames = getRoleNames(user);
    const isAdmin = roleNames.includes('admin');
    const isView = roleNames.includes('view');

    const queryBuilder = this.presetRepository
      .createQueryBuilder('preset')
      .leftJoinAndSelect('preset.user', 'user')
      .orderBy('preset.createdAt', 'DESC');

    // Filter by user permissions
    if (!isAdmin && !isView) {
      // Regular users can only see their own presets
      queryBuilder.where('preset.user_id = :userId', { userId: user.id });
    } else if (userId) {
      // Admin/View can filter by specific user
      queryBuilder.where('preset.user_id = :userId', { userId });
    }

    // Search filter
    if (search) {
      queryBuilder.andWhere(
        '(preset.title LIKE :search OR preset.content LIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Pagination
    queryBuilder.skip((page - 1) * pageSize).take(pageSize);

    const [data, total] = await queryBuilder.getManyAndCount();

    return {
      data,
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: number, user: User): Promise<OrderInquiryPreset> {
    const preset = await this.presetRepository.findOne({
      where: { id },
      relations: ['user'],
    });

    if (!preset) {
      throw new NotFoundException('Preset không tồn tại');
    }

    const roleNames = getRoleNames(user);
    const isAdmin = roleNames.includes('admin');
    const isView = roleNames.includes('view');

    // Check permissions
    if (!isAdmin && !isView && preset.user_id !== user.id) {
      throw new ForbiddenException('Bạn không có quyền xem preset này');
    }

    return preset;
  }

  async update(
    id: number,
    updateDto: UpdateOrderInquiryPresetDto,
    user: User,
  ): Promise<OrderInquiryPreset> {
    const preset = await this.findOne(id, user);

    const roleNames = getRoleNames(user);
    const isAdmin = roleNames.includes('admin');

    // Only admin or the owner can update
    if (!isAdmin && preset.user_id !== user.id) {
      throw new ForbiddenException('Bạn không có quyền sửa preset này');
    }

    Object.assign(preset, updateDto);
    return await this.presetRepository.save(preset);
  }

  async remove(id: number, user: User): Promise<void> {
    const preset = await this.findOne(id, user);

    const roleNames = getRoleNames(user);
    const isAdmin = roleNames.includes('admin');

    // Only admin or the owner can delete
    if (!isAdmin && preset.user_id !== user.id) {
      throw new ForbiddenException('Bạn không có quyền xóa preset này');
    }

    await this.presetRepository.softDelete(id);
  }

  async findByUser(userId: number): Promise<OrderInquiryPreset[]> {
    return await this.presetRepository.find({
      where: { user_id: userId },
      order: { createdAt: 'DESC' },
    });
  }
}
