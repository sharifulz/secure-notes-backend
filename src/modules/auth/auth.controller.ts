import type { RequestHandler } from 'express';
import * as service from './auth.service.js';
import { User } from '../users/user.model.js';
import { actor } from '../../middlewares/auth.js';
export const register: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: await service.register(req.body) }); };
export const login: RequestHandler = async (req, res) => { res.json({ success: true, data: await service.login(req.body.email, req.body.password) }); };
export const me: RequestHandler = async (req, res) => { res.json({ success: true, data: await User.findById(actor(req).id).lean() }); };
