-- Used or dead OTP codes are no longer kept. Clean what earlier logins left behind.
UPDATE "OtpRequest" SET "codeHash" = NULL, "expiresAt" = NULL, "attempts" = 0
WHERE "consumedAt" IS NOT NULL OR "expiresAt" < NOW();

-- Legacy plain-text columns on User; nothing writes them any more.
UPDATE "User" SET "otp" = NULL, "otpExpire" = NULL WHERE "otp" IS NOT NULL OR "otpExpire" IS NOT NULL;
