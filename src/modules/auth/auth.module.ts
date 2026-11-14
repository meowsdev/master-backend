import { Module } from '@nestjs/common';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { getAccessExpiresIn, getAccessSecret } from './auth.config';
import { OtpService } from './otp.service';
import { SessionsService } from './sessions.service';
import { TokenCleanupService } from './token-cleanup.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    // Async so the secret is read after ConfigModule has loaded `.env`.
    JwtModule.registerAsync({
      useFactory: (): JwtModuleOptions => ({
        secret: getAccessSecret(),
        signOptions: {
          expiresIn: getAccessExpiresIn() as unknown as number,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    SessionsService,
    TokenCleanupService,
    JwtStrategy,
  ],
})
export class AuthModule {}
