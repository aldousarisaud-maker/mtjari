import { ALL_PERMISSIONS } from '@mtjari/shared';
import { effectivePermissions } from './tenancy';

describe('effectivePermissions', () => {
  it('gives owners every permission regardless of stored list', () => {
    expect(effectivePermissions({ key: 'owner', permissions: [] }).size).toBe(ALL_PERMISSIONS.length);
  });
  it('drops unknown permission strings', () => {
    expect([...effectivePermissions({ key: null, permissions: ['store:read', 'root:everything'] })]).toEqual(['store:read']);
  });
});
