import { buildAssigneeLabels } from './order-view';

describe('buildAssigneeLabels', () => {
  const provider = { companyName: 'SmartCool', user: { username: 'khaled15' } };

  it('shows the technician first and keeps the company beside it', () => {
    expect(buildAssigneeLabels({ technician: { user: { username: 'hamid115' } }, provider })).toEqual({
      technician: '@hamid115',
      provider: 'SmartCool',
      primary: '@hamid115',
    });
  });

  it('without a technician the company name leads', () => {
    expect(buildAssigneeLabels({ technician: null, provider }).primary).toBe('SmartCool');
  });

  it('uses the provider username when there is no company', () => {
    expect(buildAssigneeLabels({ provider: { companyName: null, user: { username: 'khaled15' } } }).primary).toBe('@khaled15');
  });

  it('is empty when nobody is assigned', () => {
    expect(buildAssigneeLabels({})).toEqual({ technician: null, provider: null, primary: null });
  });
});
