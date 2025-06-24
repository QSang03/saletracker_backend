import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { config } from 'dotenv';
import * as path from 'path';

config(); // Load biến môi trường từ .env

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'mysql',
  host: process.env.DB_HOST,
  port: +(process.env.DB_PORT || 3306),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  entities: [path.join(__dirname, '/../**/*.entity.{ts,js}')],
  migrations: [path.join(__dirname, '/../migrations/*{.ts,.js}')],
  autoLoadEntities: true,
  synchronize: false,
  charset: 'utf8mb4_general_ci',
  logging: true,
};
