import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

const jwtSecret = process.env.JWT_ACCESS_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters. Copy .env.example to .env for local development.');
}

@Module({
  imports: [JwtModule.register({
    secret: jwtSecret,
    signOptions: { expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as never },
  })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
