import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { map } from 'rxjs';
import { isOrderChatOpen } from '../chat/order-chat-policy';

/** Warranty window: a completed order can be reopened for a revision for this long. */
export const REVISION_WINDOW_DAYS = 3;

/** Stamp the moment an order is completed; it starts the revision window. Empty for other statuses. */
export function completionStamp(status?: OrderStatus | string) {
  return status === OrderStatus.COMPLETED ? { completedAt: new Date() } : {};
}

interface NamedUser {
  username?: string | null;
}

interface AssigneeSource {
  technician?: { user?: NamedUser | null } | null;
  provider?: { companyName?: string | null; user?: NamedUser | null } | null;
}

export interface AssigneeLabels {
  /** "@hamid115", or null when no technician is assigned. */
  technician: string | null;
  /** Company name (it has priority) or else "@username"; null when no provider is known. */
  provider: string | null;
  /** The one name to show first: the technician, or with none the provider. */
  primary: string | null;
}

export function buildAssigneeLabels(order: AssigneeSource): AssigneeLabels {
  const technicianUsername = order.technician?.user?.username;
  const technician = technicianUsername ? `@${technicianUsername}` : null;

  const company = order.provider?.companyName?.trim();
  const providerUsername = order.provider?.user?.username;
  const provider = company || (providerUsername ? `@${providerUsername}` : null);

  return { technician, provider, primary: technician ?? provider };
}

type OrderLike = AssigneeSource & Partial<Parameters<typeof isOrderChatOpen>[0]>;

const addOrderView = <T extends object>(order: T) => {
  const source = order as OrderLike;
  return {
    ...order,
    assignee: buildAssigneeLabels(source),
    // Needs orderStatus + revisions; list endpoints include both.
    isChatOpen: source.orderStatus && source.revisions ? isOrderChatOpen({ orderStatus: source.orderStatus, revisions: source.revisions }) : undefined,
  };
};

/** Adds `assignee` names and `isChatOpen` to every order the orders endpoints return (one order or a list). */
@Injectable()
export class OrderViewInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      map((body: unknown) => {
        if (Array.isArray(body)) return body.map((item) => (item && typeof item === 'object' ? addOrderView(item) : item));
        return body && typeof body === 'object' && 'referenceCode' in body ? addOrderView(body) : body;
      }),
    );
  }
}
