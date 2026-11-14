import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';

export type OtpThrottleReason = 'COOLDOWN' | 'DAILY_LIMIT' | 'IP_LIMIT';

const MESSAGES: Record<OtpThrottleReason, string> = {
  COOLDOWN: 'Please wait before requesting a new OTP',
  DAILY_LIMIT: 'Daily OTP limit reached. Please try again tomorrow',
  IP_LIMIT: 'Too many OTP requests. Please try again later',
};

export class OtpThrottledException extends HttpException {
  readonly retryAfterSeconds: number;

  constructor(
    readonly reason: OtpThrottleReason,
    retryAfterSeconds: number,
    nextAllowedAt: Date,
  ) {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: MESSAGES[reason],
        reason,
        retryAfterSeconds: seconds,
        nextAllowedAt: nextAllowedAt.toISOString(),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
    this.retryAfterSeconds = seconds;
  }
}

/** Adds the standard Retry-After header; the body is built by the exception. */
@Catch(OtpThrottledException)
export class OtpThrottledFilter implements ExceptionFilter {
  catch(exception: OtpThrottledException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    res
      .status(HttpStatus.TOO_MANY_REQUESTS)
      .setHeader('Retry-After', String(exception.retryAfterSeconds))
      .json(exception.getResponse());
  }
}
