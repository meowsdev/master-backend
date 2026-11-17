import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { canSeeContactDetails, stripContactDetails } from './contact-privacy';

/** Routes that legitimately return the caller's own details or the provider's own team. */
const EXEMPT_PREFIXES = ['/auth', '/technician-profile'];

interface PrivacyRequest {
  url?: string;
  user?: { id: string; role: string };
}

/**
 * Last line of defence for contact privacy: whatever a service returns, phone numbers and emails
 * of other people are removed before the response leaves the server. Only the viewer's own details
 * and platform staff are exempt. Services that forget to hide a number cannot leak it.
 */
@Injectable()
export class ContactPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<PrivacyRequest>();
    const path = (request.url ?? '').split('?')[0].replace(/^\/api(?=\/)/, '');
    const isExempt = EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (isExempt || canSeeContactDetails(request.user?.role)) return next.handle();

    return next.handle().pipe(map((body) => stripContactDetails(body, request.user?.id ?? null)));
  }
}
