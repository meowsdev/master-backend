import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { ServiceModule } from './modules/services/services.module';
import { ChatModule } from './modules/chat/chat.module';
import { UserAddressModule } from './modules/user-address/user-address.module';
import { TechnicianProfileModule } from './modules/technician-profile/technician-profile.module';
import { ProviderKycModule } from './modules/provider-kyc/provider-kyc.module';
import { ServiceAssigneeModule } from './modules/service-assignee/service-assignee.module';
import { ActiveChatSlotModule } from './modules/active-chat-slot/active-chat-slot.module';
import { CustomerRetentionModule } from './modules/customer-retention/customer-retention.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderPaymentTipModule } from './modules/order-payment-tip/order-payment-tip.module';
import { ServiceRevisionModule } from './modules/service-revision/service-revision.module';
import { ProviderReviewModule } from './modules/provider-review/provider-review.module';
import { ChatAuditLogModule } from './modules/chat-audit-log/chat-audit-log.module';
import { CounselorAuditLogModule } from './modules/counselor-audit-log/counselor-audit-log.module';
import { ProviderLevelingModule } from './modules/provider-leveling/provider-leveling.module';
import { LegalEscalationModule } from './modules/legal-escalation/legal-escalation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    ServiceModule,
    ChatModule,
    UserAddressModule,
    TechnicianProfileModule,
    ProviderKycModule,
    ServiceAssigneeModule,
    ActiveChatSlotModule,
    CustomerRetentionModule,
    OrdersModule,
    OrderPaymentTipModule,
    ServiceRevisionModule,
    ProviderReviewModule,
    ChatAuditLogModule,
    CounselorAuditLogModule,
    ProviderLevelingModule,
    LegalEscalationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

