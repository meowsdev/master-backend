import { of, lastValueFrom } from 'rxjs';
import { ContactPrivacyInterceptor } from './contact-privacy.interceptor';

const run = async (url: string, user: { id: string; role: string } | undefined, body: unknown) => {
  const context = { getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ url, user }) }) };
  return lastValueFrom(new ContactPrivacyInterceptor().intercept(context as never, { handle: () => of(body) }));
};

describe('ContactPrivacyInterceptor', () => {
  const someone = { id: 'u-other', mobileNumber: '+8801712344585' };

  it('leaves the login response alone, so the user gets their own full number (real path has /api/v1)', async () => {
    const body = { user: { id: 'u-new', mobileNumber: '+8801700000010' } };
    await expect(run('/api/v1/auth/verify-otp', undefined, body)).resolves.toEqual(body);
  });

  it('masks other people for a non-admin on versioned routes', async () => {
    const result = (await run('/api/v1/orders/1', { id: 'u-manager', role: 'MANAGER' }, someone)) as { mobileNumber: string };
    expect(result.mobileNumber).toBe('017****4585');
  });

  it('shows full numbers to an admin', async () => {
    await expect(run('/api/v1/orders/1', { id: 'u-admin', role: 'ADMIN' }, someone)).resolves.toEqual(someone);
  });
});
