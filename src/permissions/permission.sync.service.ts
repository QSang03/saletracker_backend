import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brand } from '../brands/brand.entity';
import { Category } from '../categories/category.entity';
import { PermissionService } from './permission.service';
import slugify from 'slugify';

function toSlug(input: string): string {
  return slugify(input || '', { lower: true, strict: true });
}

@Injectable()
export class PermissionSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(
    @InjectRepository(Brand)
    private readonly brandRepo: Repository<Brand>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    private readonly permissionService: PermissionService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.syncAll();
    } catch (e) {
      this.logger.error('Failed to sync pm_cat_* and pm_brand_* permissions on bootstrap', e);
    }
  }

  async syncAll() {
    // Brands
    const brands = await this.brandRepo.find({ select: ['id', 'name'] });
    for (const b of brands) {
      const slug = toSlug(b.name);
      if (!slug) continue;
      await this.permissionService.createPermission({ name: `pm_brand_${slug}`, action: 'scope' });
    }

    // Categories
    const categories = await this.categoryRepo.find({ select: ['id', 'catName'] });
    for (const c of categories) {
      const slug = toSlug(c.catName);
      if (!slug) continue;
      await this.permissionService.createPermission({ name: `pm_cat_${slug}`, action: 'scope' });
    }

    this.logger.log('Synchronized pm_cat_* and pm_brand_* permissions for categories and brands');
  }
}
