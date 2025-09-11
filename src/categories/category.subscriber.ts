import { Injectable } from '@nestjs/common';
import { DataSource, EntitySubscriberInterface, EventSubscriber, InsertEvent, RemoveEvent, UpdateEvent } from 'typeorm';
import { Category } from './category.entity';
import slugify from 'slugify';
import { PermissionService } from '../permissions/permission.service';

function toSlug(input: string): string {
  return slugify(input || '', { lower: true, strict: true });
}

@Injectable()
@EventSubscriber()
export class CategorySubscriber implements EntitySubscriberInterface<Category> {
  constructor(
    dataSource: DataSource,
    private readonly permissionService: PermissionService,
  ) {
    dataSource.subscribers.push(this);
  }

  listenTo() {
    return Category;
  }

  async afterInsert(event: InsertEvent<Category>) {
    try {
      const category = event.entity;
      if (!category) return;
      const slug = toSlug(category.catName);
      if (!slug) return;
      await this.permissionService.createPermission({ name: `pm_${slug}`, action: 'scope' });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[CategorySubscriber.afterInsert] sync permission failed:', e);
    }
  }

  async afterUpdate(event: UpdateEvent<Category>) {
    try {
      const beforeName = (event.databaseEntity as Category | undefined)?.catName;
      const afterName = (event.entity as Category | undefined)?.catName;
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
      console.error('[CategorySubscriber.afterUpdate] sync permission failed:', e);
    }
  }

  async afterRemove(event: RemoveEvent<Category>) {
    try {
      const category = (event.databaseEntity as Category | undefined) || (event.entity as Category | undefined);
      const name = category?.catName;
      if (!name) return;
      const slug = toSlug(name);
      if (!slug) return;
      await this.permissionService.softDeletePermissionsBySlug(`pm_${slug}`);
    } catch (e) {
      console.error('[CategorySubscriber.afterRemove] sync permission failed:', e);
    }
  }
}
