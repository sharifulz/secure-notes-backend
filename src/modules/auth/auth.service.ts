import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { User } from '../users/user.model.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { ApiError } from '../../utils/errors.js';
import type { NewUser } from '../users/user.validation.js';
// Equalize bcrypt work for unknown accounts and seed accounts without a password.
const dummyHash = hashPassword('unused-dummy-password-for-login');
export async function register(input: Omit<NewUser, 'role'>) {
  const { password, ...profile } = input;
  const user = await User.create({ ...profile, role: 'USER', passwordHash: await hashPassword(password) });
  return User.findById(user._id).lean();
}
export async function login(email: string, password: string) {
  const user = await User.findOne({ email }).select('+passwordHash');
  const valid = await verifyPassword(password, user?.passwordHash || await dummyHash);
  if (!valid || !user?.passwordHash) throw new ApiError(401, 'Invalid email or password');
  return { accessToken: jwt.sign({}, env.JWT_SECRET, {
    algorithm: 'HS256', subject: user.id, expiresIn: '15m',
    issuer: env.JWT_ISSUER, audience: env.JWT_AUDIENCE,
  }), tokenType: 'Bearer', expiresIn: 900 };
}
