import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDatabase } from '../config/database.js';
import { User } from '../modules/users/user.model.js';
import { email, password } from '../utils/validation.js';
import { hashPassword } from '../utils/password.js';
const input = z.object({ SEED_USER_EMAIL: email, SEED_USER_PASSWORD: password }).parse(process.env);
try {
  await connectDatabase();
  const result = await User.updateOne({ email: input.SEED_USER_EMAIL, passwordHash: null }, { $set: { passwordHash: await hashPassword(input.SEED_USER_PASSWORD) } });
  if (!result.matchedCount) throw new Error('No matching seed account without a password; existing passwords are never overwritten');
  console.log('Seed account password initialized');
} finally { await mongoose.disconnect(); }
