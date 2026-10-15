import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User, USER_ROLES } from '../src/models/user.model.js';
import { authorizeRoles, authenticate, verifyToken } from '../src/middleware/auth.middleware.js';

test('User roles use the Manager/Admin/Member values and preserve legacy records', () => {
  assert.deepEqual(Object.values(USER_ROLES), ['Admin', 'Manager', 'Member']);
  assert.equal(USER_ROLES.EMPLOYEE, USER_ROLES.MEMBER);

  const member = new User({
    name: 'Board Member',
    email: 'member@example.test',
    passwordHash: 'bcrypt-hash'
  });
  assert.equal(member.role, 'Member');
  assert.equal(member.phone, '');
  assert.equal(member.avatar, '');

  const legacyMember = User.hydrate({
    _id: new mongoose.Types.ObjectId(),
    name: 'Legacy Member',
    email: 'legacy@example.test',
    passwordHash: 'bcrypt-hash',
    role: 'EMPLOYEE',
    isActive: true
  });
  assert.equal(legacyMember.role, 'Member');
});

test('authorizeRoles accepts managers and denies members for manager-only routes', async () => {
  const authorizeManagers = authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.MANAGER);
  const invoke = (role) => new Promise((resolve) => {
    authorizeManagers({ user: { role } }, {}, (error) => resolve(error || null));
  });

  assert.equal(await invoke('Manager'), null);
  assert.equal((await invoke('Member')).statusCode, 403);
  assert.equal(verifyToken, authenticate);
});
