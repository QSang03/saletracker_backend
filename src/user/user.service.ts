import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { Role } from 'src/role/role.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findByUsername(username: string) {
    return this.userRepository.findOne({ where: { username } });
  }

  async create(data: { username: string; password: string; roles: Role[] }) {
    const user = this.userRepository.create(data); // roles sẽ được map
    return await this.userRepository.save(user); // TypeORM tự insert vào bảng trung gian
  }
}
