import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { BrandService } from './brand.service';
import { Brand } from './brand.entity';
import { AuthGuard } from '../common/guards/auth.guard';
import { Request } from 'express';

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @UseGuards(AuthGuard)
  @Get()
  findAll(@Req() req: Request) {
    return this.brandService.findAll({ user: (req as any)?.user });
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.brandService.findOne(id);
  }

  @Post()
  create(@Body() data: Partial<Brand>) {
    return this.brandService.create(data);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() data: Partial<Brand>) {
    return this.brandService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.brandService.remove(id);
  }
}
