import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ContactPrivacyInterceptor } from './common/contact-privacy.interceptor';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './redis/redis.module';
import { ServiceModule } from './modules/services/services.module';
import { ChatModule } from './modules/chat/chat.module';
import { SupportChatModule } from './modules/support-chat/support-chat.module';
import { ProviderServiceAreasModule } from './modules/provider-service-areas/provider-service-areas.module';
import { AdminMembersModule } from './modules/admin-members/admin-members.module';
import { AdminStaffModule } from './modules/admin-staff/admin-staff.module';
import { OrderAssignmentModule } from './modules/order-assignment/order-assignment.module';
import { OrderTechnicianModule } from './modules/order-technician/order-technician.module';
import { UserAddressModule } from './modules/user-address/user-address.module';
import { TechnicianProfileModule } from './modules/technician-profile/technician-profile.module';
import { ProviderKycModule } from './modules/provider-kyc/provider-kyc.module';
import { ServiceAssigneeModule } from './modules/service-assignee/service-assignee.module';
import { ActiveChatSlotModule } from './modules/active-chat-slot/active-chat-slot.module';
import { CustomerRetentionModule } from './modules/customer-retention/customer-retention.module';
import { OrdersModule } from './modules/orders/orders.module';
import { OrderPlacementModule } from './modules/order-placement/order-placement.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { ProviderTermsModule } from './modules/provider-terms/provider-terms.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { OrderPaymentTipModule } from './modules/order-payment-tip/order-payment-tip.module';
import { OrderExtraChargeModule } from './modules/order-extra-charge/order-extra-charge.module';
import { OrderExpenseClaimModule } from './modules/order-expense-claim/order-expense-claim.module';
import { OrderCompletionModule } from './modules/order-completion/order-completion.module';
import { AdminDirectoryModule } from './modules/admin-directory/admin-directory.module';
import { OrderAdvancePaymentModule } from './modules/order-advance-payment/order-advance-payment.module';
import { CustomerRatingModule } from './modules/customer-rating/customer-rating.module';
import { ProviderWalletModule } from './modules/provider-wallet/provider-wallet.module';
import { ServiceRevisionModule } from './modules/service-revision/service-revision.module';
import { ProviderReviewModule } from './modules/provider-review/provider-review.module';
import { ChatAuditLogModule } from './modules/chat-audit-log/chat-audit-log.module';
import { CounselorAuditLogModule } from './modules/counselor-audit-log/counselor-audit-log.module';
import { ProviderLevelingModule } from './modules/provider-leveling/provider-leveling.module';
import { LegalEscalationModule } from './modules/legal-escalation/legal-escalation.module';
import { LocationsModule } from './modules/locations/locations.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { OrderQuoteModule } from './modules/order-quote/order-quote.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    AuthModule,
    ServiceModule,
    CatalogModule,
    OrderQuoteModule,
    ChatModule,
    SupportChatModule,
    ProviderServiceAreasModule,
    AdminMembersModule,
    AdminStaffModule,
    OrderAssignmentModule,
    OrderTechnicianModule,
    UserAddressModule,
    TechnicianProfileModule,
    ProviderKycModule,
    ServiceAssigneeModule,
    ActiveChatSlotModule,
    CustomerRetentionModule,
    OrdersModule,
    OrderPlacementModule,
    PlatformSettingsModule,
    ProviderTermsModule,
    UploadsModule,
    OrderPaymentTipModule,
    OrderExtraChargeModule,
    OrderExpenseClaimModule,
    OrderCompletionModule,
    AdminDirectoryModule,
    OrderAdvancePaymentModule,
    CustomerRatingModule,
    ProviderWalletModule,
    ServiceRevisionModule,
    ProviderReviewModule,
    ChatAuditLogModule,
    CounselorAuditLogModule,
    ProviderLevelingModule,
    LegalEscalationModule,
    LocationsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_INTERCEPTOR, useClass: ContactPrivacyInterceptor }],
})
export class AppModule {}
