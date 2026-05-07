import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET') ?? 'changeme',
    });
  }

  async validate(payload: { sub: number; email: string }) {
    const res = await this.db.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [payload.sub],
    );
    if (!res.rows.length) throw new UnauthorizedException();
    return res.rows[0]; // attached to req.user
  }
}
