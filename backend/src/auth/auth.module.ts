import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountActionsService } from './account-actions.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OidcController } from './oidc.controller';
import { OidcService } from './oidc.service';

@Module({
  imports: [JwtModule.registerAsync({
    useFactory: () => {
      const secret = process.env.JWT_ACCESS_SECRET;
      if (!secret || secret.length < 32) throw new Error('JWT_ACCESS_SECRET must contain at least 32 characters.');
      return { secret, signOptions: { expiresIn: (process.env.JWT_ACCESS_TTL ?? '15m') as never } };
    },
  })],
  controllers: [AuthController, OidcController],
  providers: [AuthService, AccountActionsService, JwtAuthGuard, OidcService],
  exports: [AuthService, AccountActionsService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
