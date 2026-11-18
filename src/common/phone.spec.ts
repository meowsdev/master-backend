import { phoneLookupVariants } from './phone';

describe('phoneLookupVariants', () => {
  it('lists the international, the 880 and the local form of a Bangladeshi number', () => {
    expect(phoneLookupVariants('+8801700000777')).toEqual(['+8801700000777', '8801700000777', '01700000777']);
  });

  it('leaves any other number as it is', () => {
    expect(phoneLookupVariants('+14155550123')).toEqual(['+14155550123']);
  });
});
