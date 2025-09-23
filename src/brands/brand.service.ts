import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from './brand.entity';
import slugify from 'slugify';
import { getPermissions, getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class BrandService {
  constructor(
    @InjectRepository(Brand)
    private readonly brandRepository: Repository<Brand>,
  ) {}

  async findAll(filter?: { user?: any }) {
    // Return only basic fields for filter dropdowns
    const rows = await this.brandRepository.find({ select: ['id', 'name', 'slug'] });
    const user = filter?.user;
    if (!user) return rows;
    const roles = getRoleNames(user).map((r) => String(r).toLowerCase());
    const isAdmin = roles.includes('admin');
    const isView = roles.includes('view');
    const isPM = roles.includes('pm') || roles.some((r) => r.startsWith('pm-'));
    if (!isPM || isAdmin || isView) return rows;

    // Chỉ lấy permissions pm_brand_*
    const brandPerms = getPermissions(user)
      .map((p) => String(p || ''))
      .filter((name) => /^pm_brand_/i.test(name))
      .map((name) => name.replace(/^pm_brand_/i, ''))
      .map((s) => slugify(s, { lower: true, strict: true }));
    
    if (brandPerms.length === 0) return [];
    
    return rows.filter((b) => brandPerms.includes(b.slug || slugify(b.name || '', { lower: true, strict: true })));
  }

  findOne(id: number) {
    return this.brandRepository.findOne({ where: { id } });
  }

  create(data: Partial<Brand>) {
    return this.brandRepository.save(data);
  }

  update(id: number, data: Partial<Brand>) {
    return this.brandRepository.update(id, data);
  }

  remove(id: number) {
    return this.brandRepository.delete(id);
  }
}
