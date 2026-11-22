import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { canSeeContactDetails, canSeeFullPhoneNumbers, protectContactDetails } from './contact-privacy';

/** Routes that only ever return the caller's own details (login, session, profile). */
const EXEMPT_PREFIXES = ['/auth'];

interface PrivacyRequest {
  url?: string;
  user?: { id: string; role: string };
}

/**
 * Last line of defence for contact privacy: whatever a service returns, other people's phone numbers
 * leave the server masked ("017****4585") for everyone except an admin, and their emails are removed
 * unless the viewer is staff. The viewer's own details are untouched. Services that forget to hide a
 * number cannot leak it.
 */
@Injectable()
export class ContactPrivacyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<PrivacyRequest>();
    // "/api/v1/auth/me" -> "/auth/me". Without the version strip no route ever matched, so a user's own number
    // came back masked right after login (the login response has no signed-in user yet to call it "own").
    const path = (request.url ?? '').split('?')[0].replace(/^\/api(\/v\d+)?(?=\/)/, '');
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return next.handle();
    // An admin sees everyone's full number and email.
    if (canSeeFullPhoneNumbers(request.user?.role)) return next.handle();

    const viewerId = request.user?.id ?? null;
    const canSeeEmails = canSeeContactDetails(request.user?.role);
    return next.handle().pipe(map((body) => protectContactDetails(body, viewerId, canSeeEmails)));
  }
}
