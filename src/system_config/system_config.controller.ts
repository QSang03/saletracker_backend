import {
  Controller,
  Get,
  Param,
  Patch,
  Body,
  Post,
  UseGuards,
  BadRequestException,
  Query,
} from '@nestjs/common';
import { SystemConfigService } from './system_config.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { AdminAuthGuard } from '../common/guards/admin-auth.guard';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { Permission } from '../common/guards/permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';

@Controller('system-config')
@UseGuards(AuthGuard, PermissionGuard)
export class SystemConfigController {
  constructor(private readonly configService: SystemConfigService) {}

  @Get('by-section/:section')
  async getBySection(@Param('section') section: string) {
    return this.configService.getBySection(section);
  }

  @Get('by-section/:section/type/:type')
  async getBySectionAndType(
    @Param('section') section: string,
    @Param('type') type: string,
  ) {
    return this.configService.getBySectionAndType(section, type);
  }

  @Get('by-section/:section/:name')
  @UseGuards(AdminAuthGuard)
  @Permission('cong-no', 'read')
  async getBySectionAndName(
    @Param('section') section: string,
    @Param('name') name: string,
  ) {
    return this.configService.getBySectionAndName(section, name);
  }

  @Patch('by-section/:section/:name')
  @Permission('cong-no', 'update')
  async updateBySectionAndName(
    @Param('section') section: string,
    @Param('name') name: string,
    @Body() body: UpdateSystemConfigDto,
  ) {
    if (typeof body.value !== 'string') {
      throw new BadRequestException('Value is required and must be a string');
    }
    // Truyền cả status nếu có
    return this.configService.updateBySectionAndName(
      section,
      name,
      body.value,
      body.status,
    );
  }

  @Get()
  getAll() {
    return this.configService.getAll();
  }

  @Get(':name')
  getByName(@Param('name') name: string) {
    return this.configService.getByName(name);
  }

  @Patch(':name')
  setConfig(@Param('name') name: string, @Body() body: UpdateSystemConfigDto) {
    if (typeof body.value !== 'string') {
      throw new BadRequestException('Value is required and must be a string');
    }
    return this.configService.setConfig(name, body.value);
  }

  @Post()
  createConfig(@Body() data: CreateSystemConfigDto) {
    return this.configService.createConfig(data);
  }
}
