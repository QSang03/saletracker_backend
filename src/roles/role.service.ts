import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Role } from "./role.entity";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { CreateRoleDto } from "./dto/create-role.dto";

@Injectable()
export class RoleService {
  assignPermissionsToRole(arg0: number, permissionIds: number[], token: string) {
    throw new Error("Method not implemented.");
  }
  softDeleteRole(arg0: number, token: string) {
    throw new Error("Method not implemented.");
  }
  updateRole(arg0: number, updateRoleDto: UpdateRoleDto, token: string) {
    throw new Error("Method not implemented.");
  }
  createRole(createRoleDto: CreateRoleDto, token: string) {
    throw new Error("Method not implemented.");
  }
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>
  ) {}

  async findAll(token: string): Promise<Role[]> {
    return this.roleRepo.find({ relations: ['permissions'] });
  }
}