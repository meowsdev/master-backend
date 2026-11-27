import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitProviderKycDto } from './provider-kyc.dto';

/** The terms checkbox is enforced by the server too: a send without accepting them never reaches the service. */
describe('sending the verification needs the provider terms accepted', () => {
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(SubmitProviderKycDto, body))).map(
      (error) => error.property,
    );

  it('fails without acceptance, or with anything but true', async () => {
    expect(await errorsFor({})).toContain('acceptTerms');
    expect(await errorsFor({ acceptTerms: 'yes' })).toContain('acceptTerms');
    expect(await errorsFor({ acceptTerms: false })).toContain('acceptTerms');
  });

  it('passes the terms check with acceptTerms true and a version', async () => {
    const errors = await errorsFor({
      acceptTerms: true,
      termsVersion: '2026-11-27',
    });
    expect(errors).not.toContain('acceptTerms');
    expect(errors).not.toContain('termsVersion');
  });
});
