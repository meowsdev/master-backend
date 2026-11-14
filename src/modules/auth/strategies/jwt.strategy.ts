import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import type * as express from 'express';
import { getAccessSecret } from '../auth.config';
import { extractAccessToken } from '../auth-cookies.util';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super({
      jwtFromRequest: (req: express.Request) => extractAccessToken(req) ?? null,
      secretOrKey: getAccessSecret(),
      passReqToCallback: true,
    });
  }

  async validate(
    req: express.Request,
    paylode: { sub: string; mobileNumber: string; role: string },
  ) {
    const accessToken = extractAccessToken(req);
    if (!accessToken) {
      throw new UnauthorizedException('Unauthorized');
    }

    const isBlackListed = await this.redisService.exists(
      `auth:blacklist:access:${accessToken}`,
    );

    if (isBlackListed) {
      throw new UnauthorizedException('Unauthorized');
    }
    const user = await this.prisma.user.findUnique({
      where: {
        id: paylode.sub,
      },
      select: {
        id: true,
        mobileNumber: true,
        email: true,
        name: true,
        role: true,
        status: true,
        isVerified: true,
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Unauthorized');
    }
    return user;
  }
}
