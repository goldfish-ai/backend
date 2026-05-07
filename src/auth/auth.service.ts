import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { DatabaseService } from '../database/database.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.db.query(
      'SELECT id FROM users WHERE email = $1',
      [dto.email.toLowerCase()],
    );
    if (existing.rows.length) {
      throw new BadRequestException('Email already registered');
    }

    const hash = await bcrypt.hash(dto.password, 12);
    const res = await this.db.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, created_at`,
      [dto.email.toLowerCase(), hash, dto.name ?? null],
    );
    const user = res.rows[0];
    return { user, token: this.sign(user) };
  }

  async login(dto: LoginDto) {
    const res = await this.db.query(
      'SELECT id, email, name, password_hash FROM users WHERE email = $1',
      [dto.email.toLowerCase()],
    );
    const user = res.rows[0];
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const { password_hash: _, ...safe } = user;
    return { user: safe, token: this.sign(safe) };
  }

  private sign(user: { id: number; email: string }) {
    return this.jwt.sign({ sub: user.id, email: user.email });
  }
}
