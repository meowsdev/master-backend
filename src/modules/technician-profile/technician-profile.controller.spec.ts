import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { TechnicianProfileController } from './technician-profile.controller';

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));

/** Reads the HTTP method, path and required roles of every route of the controller. */
function routes() {
  const proto = TechnicianProfileController.prototype as unknown as Record<string, () => void>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => ({
      name,
      method: Reflect.getMetadata(METHOD_METADATA, proto[name]) as RequestMethod,
      path: Reflect.getMetadata(PATH_METADATA, proto[name]) as string,
      roles: Reflect.getMetadata(ROLES_KEY, proto[name]) as UserRole[] | undefined,
    }));
}

describe('TechnicianProfileController access rules', () => {
  it('creating, attaching to a provider and deleting a technician require ADMIN', () => {
    const all = routes();
    const create = all.find((r) => r.method === RequestMethod.POST && r.path !== 'my-team');
    const agency = all.find((r) => r.method === RequestMethod.PATCH && r.path === ':id/agency');
    const remove = all.find((r) => r.method === RequestMethod.DELETE);

    expect(create?.roles).toEqual([UserRole.ADMIN]);
    expect(agency?.roles).toEqual([UserRole.ADMIN]);
    expect(remove?.roles).toEqual([UserRole.ADMIN]);
  });

  it('lets only a PROVIDER read and add to their own team', () => {
    const team = routes().filter((r) => r.path === 'my-team');
    expect(team.map((r) => r.method).sort()).toEqual([RequestMethod.GET, RequestMethod.POST].sort());
    expect(team.every((r) => r.roles?.length === 1 && r.roles[0] === UserRole.PROVIDER)).toBe(true);
  });

  it('has no self-service route that can create or move a technician', () => {
    const selfPaths = routes().filter((r) => r.path === 'me');
    // `me` only reads; the one self-service write is the location update.
    expect(selfPaths.every((r) => r.method === RequestMethod.GET)).toBe(true);

    const location = routes().find((r) => r.path === 'me/location');
    expect(location?.method).toBe(RequestMethod.PATCH);
    expect(location?.roles).toEqual([UserRole.TECHNICIAN]);
  });
});
