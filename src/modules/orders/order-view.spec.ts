import { OrderStatus } from '@prisma/client';
import { buildAssigneeLabels, buildAssignmentCard, isOrderAccepted } from './order-view';

describe('buildAssigneeLabels', () => {
  const provider = { companyName: 'SmartCool', user: { username: 'khaled15' } };

  it('shows the technician first and keeps the company beside it', () => {
    expect(buildAssigneeLabels({ technician: { user: { username: 'hamid115' } }, provider })).toEqual({
      technician: '@hamid115',
      provider: 'SmartCool',
      primary: '@hamid115',
      providerUsername: '@khaled15',
      providerName: 'SmartCool',
    });
  });

  it('without a technician the company name leads', () => {
    expect(buildAssigneeLabels({ technician: null, provider }).primary).toBe('SmartCool');
  });

  it('uses the provider username when there is no company', () => {
    expect(buildAssigneeLabels({ provider: { companyName: null, user: { username: 'khaled15' } } }).primary).toBe('@khaled15');
  });

  it("shows the provider's username and company name", () => {
    const labels = buildAssigneeLabels({ provider: { companyName: 'Master', user: { name: 'Manik Khan', username: 'manik05' } } });
    expect([labels.providerUsername, labels.providerName]).toEqual(['@manik05', 'Master']);
  });

  it("falls back to the provider's own name when there is no company", () => {
    const labels = buildAssigneeLabels({ provider: { companyName: '  ', user: { name: 'Manik Khan', username: 'manik05' } } });
    expect(labels.providerName).toBe('Manik Khan');
  });

  it('hides every name until the order is accepted', () => {
    const labels = buildAssigneeLabels({ technician: { user: { username: 'hamid115' } }, provider }, false);
    expect(labels).toEqual({ technician: null, provider: null, primary: null, providerUsername: null, providerName: null });
  });

  it('counts an order as accepted by status or by its accepted time', () => {
    expect(isOrderAccepted({ orderStatus: OrderStatus.PENDING })).toBe(false);
    expect(isOrderAccepted({ orderStatus: OrderStatus.CANCELLED })).toBe(false);
    expect(isOrderAccepted({ orderStatus: OrderStatus.CANCELLED, acceptedAt: new Date() })).toBe(true);
    expect(isOrderAccepted({ orderStatus: OrderStatus.IN_PROGRESS })).toBe(true);
  });

  it('is empty when nobody is assigned', () => {
    expect(buildAssigneeLabels({})).toEqual({ technician: null, provider: null, primary: null, providerUsername: null, providerName: null });
  });
});

describe('buildAssignmentCard', () => {
  const provider = {
    companyName: 'Master',
    user: { name: 'Provider', username: 'prov', profilePhoto: 'p.jpg', addresses: [{ addressText: 'Gala Bazar, Tangail' }] },
  };
  const technician = { user: { name: 'Manik Khan', username: 'manik05', profilePhoto: 't.jpg' } };

  it('is hidden while the order is still pending', () => {
    expect(buildAssignmentCard({ orderStatus: OrderStatus.PENDING, technician, provider })).toBeNull();
  });

  it('shows the technician with the provider workshop and shop name once accepted', () => {
    expect(buildAssignmentCard({ orderStatus: OrderStatus.ACCEPTED, technician, provider })).toEqual({
      role: 'TECHNICIAN',
      name: 'Manik Khan',
      photoUrl: 't.jpg',
      workshopAddress: 'Gala Bazar, Tangail',
      shopName: 'Master',
    });
  });

  it('falls back to the provider when no technician is assigned', () => {
    const card = buildAssignmentCard({ orderStatus: OrderStatus.ACCEPTED, provider });
    expect(card).toMatchObject({ role: 'PROVIDER', name: 'Provider', photoUrl: 'p.jpg' });
  });

  it('never exposes phone numbers', () => {
    const card = buildAssignmentCard({ orderStatus: OrderStatus.ACCEPTED, technician, provider });
    expect(JSON.stringify(card)).not.toMatch(/mobile|phone/i);
  });
});
