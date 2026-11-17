import { Injectable } from '@nestjs/common';

export interface GatewayCharge {
  method: 'BKASH' | 'NAGAD' | 'CARD';
  amount: number;
  orderId: string;
}

export interface GatewayResult {
  success: boolean;
  transactionId: string;
}

/**
 * The one place a real bKash / Nagad / card integration plugs in.
 * Until merchant credentials exist this stub approves every charge, so the whole
 * completion flow can be exercised end to end. Replace `charge` with the real call;
 * nothing else needs to change.
 */
@Injectable()
export class PaymentGateway {
  async charge(request: GatewayCharge): Promise<GatewayResult> {
    return { success: true, transactionId: `SIM-${request.method}-${Date.now().toString(36).toUpperCase()}` };
  }
}
