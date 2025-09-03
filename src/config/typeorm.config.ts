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
  // Performance optimizations
  cache: {
    duration: 30000, // 30 seconds cache
  },
  // Connection pooling optimization
  extra: {
    connectionLimit: 20, // Tăng connection limit
    acquireTimeout: 60000, // 60 seconds timeout
    timeout: 60000, // Query timeout
    typeCast: (field, next) => {
      if (field.type === 'TIMESTAMP') {
        return field.string();
      }
      return next();
    },
    // Connection pool settings
    queueLimit: 0,
    waitForConnections: true,
    // Performance settings
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
    // Query optimization
    multipleStatements: false,
    trace: false,
  },
  // Query optimization
  maxQueryExecutionTime: 10000, // Log slow queries > 10s
  timezone: '+07:00',
};
