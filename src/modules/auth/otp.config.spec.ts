import { getOtpConfig } from './otp.config';

describe('getOtpConfig().logCodeToConsole', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('is on in development and when NODE_ENV is unset', () => {
    process.env.NODE_ENV = 'development';
    expect(getOtpConfig().logCodeToConsole).toBe(true);
    delete process.env.NODE_ENV;
    expect(getOtpConfig().logCodeToConsole).toBe(true);
  });

  it('is never on in production, even if asked for', () => {
    process.env.NODE_ENV = 'production';
    process.env.OTP_LOG_TO_CONSOLE = 'true';
    expect(getOtpConfig().logCodeToConsole).toBe(false);
  });

  it('can be silenced in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.OTP_LOG_TO_CONSOLE = 'false';
    expect(getOtpConfig().logCodeToConsole).toBe(false);
  });
});
