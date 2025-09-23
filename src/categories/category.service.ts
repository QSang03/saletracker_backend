import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import slugify from 'slugify';
import { getPermissions, getRoleNames } from '../common/utils/user-permission.helper';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  async findAll(filter?: { user?: any }) {
    // Lightweight list for filters
    const rows = await this.categoryRepository.find({ select: ['id', 'catName', 'slug'] });
    const user = filter?.user;
    if (!user) return rows;
    const roles = getRoleNames(user).map((r) => String(r).toLowerCase());
    const isAdmin = roles.includes('admin');
    const isView = roles.includes('view');
    const isPM = roles.includes('pm') || roles.some((r) => r.startsWith('pm-'));
    if (!isPM || isAdmin || isView) return rows;

    // Chỉ lấy permissions pm_cat_*
    const catPerms = getPermissions(user)
      .map((p) => String(p || ''))
      .filter((name) => /^pm_cat_/i.test(name))
      .map((name) => name.replace(/^pm_cat_/i, ''))
      .map((s) => slugify(s, { lower: true, strict: true }));
    
    if (catPerms.length === 0) return [];
    
    return rows.filter((c) => catPerms.includes(c.slug || slugify(c.catName || '', { lower: true, strict: true })));
  }

  findOne(id: number) {
    return this.categoryRepository.findOne({ where: { id } });
  }

  create(data: Partial<Category>) {
    return this.categoryRepository.save(data);
  }

  update(id: number, data: Partial<Category>) {
    return this.categoryRepository.update(id, data);
  }

  remove(id: number) {
    return this.categoryRepository.delete(id);
  }
}
