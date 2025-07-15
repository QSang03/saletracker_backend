import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { config } from 'dotenv';
import * as path from 'path';
import { CustomNamingStrategy } from './custom-naming.strategy';

config();

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
  namingStrategy: new CustomNamingStrategy(),
  synchronize: true,
  charset: 'utf8mb4_general_ci',
  logging: false,
  extra: {
    connectionLimit: 10,
    typeCast: (field, next) => {
      if (field.type === 'TIMESTAMP') {
        return field.string();
      }
      return next();
    },
  },
  timezone: '+07:00',
};
