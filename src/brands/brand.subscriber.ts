import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, InsertEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { Brand } from './brand.entity';
import slugify from 'slugify';
import { PermissionService } from '../permissions/permission.service';

function toSlug(input: string): string {
  return slugify(input || '', { lower: true, strict: true });
}

@Injectable()
@EventSubscriber()
export class BrandSubscriber implements EntitySubscriberInterface<Brand> {
  constructor(
    dataSource: DataSource,
    private readonly permissionService: PermissionService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Brand;
  }

  async afterInsert(event: InsertEvent<Brand>) {
    try {
      const brand = event.entity;
      if (!brand) return;
      const slug = toSlug(brand.name);
      if (!slug) return;
      await this.permissionService.createPermission({ name: `pm_${slug}`, action: 'scope' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[BrandSubscriber.afterInsert] sync permission failed:', e);
    }
  }

  async afterUpdate(event: UpdateEvent<Brand>) {
    try {
      const beforeName = (event.databaseEntity as Brand | undefined)?.name;
      const afterName = (event.entity as Brand | undefined)?.name;
      if (!afterName) return;
      const newSlug = toSlug(afterName);
      const oldSlug = beforeName ? toSlug(beforeName) : undefined;
      if (oldSlug && oldSlug !== newSlug) {
        await this.permissionService.updatePermissionNameBySlug(`pm_${oldSlug}`, `pm_${newSlug}`);
      } else if (!oldSlug) {
        // In case of update via query that didn't load old entity, ensure permission exists
        await this.permissionService.createPermission({ name: `pm_${newSlug}`, action: 'scope' });
      }
    } catch (e) {
      console.error('[BrandSubscriber.afterUpdate] sync permission failed:', e);
    }
  }

  async afterRemove(event: RemoveEvent<Brand>) {
    try {
      const brand = (event.databaseEntity as Brand | undefined) || (event.entity as Brand | undefined);
      const name = brand?.name;
      if (!name) return;
      const slug = toSlug(name);
      if (!slug) return;
      await this.permissionService.softDeletePermissionsBySlug(`pm_${slug}`);
    } catch (e) {
      console.error('[BrandSubscriber.afterRemove] sync permission failed:', e);
    }
  }
}
