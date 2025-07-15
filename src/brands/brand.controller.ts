import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { BrandService } from './brand.service';
import { Brand } from './brand.entity';

@Controller('brands')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Get()
  findAll() {
    return this.brandService.findAll();
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
