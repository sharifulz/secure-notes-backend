import type { RequestHandler } from 'express';
import * as service from './post.service.js';
import { actor } from '../../middlewares/auth.js';
import { objectId } from '../../utils/validation.js';
import { paginationSchema } from '../../utils/pagination.js';
export const create: RequestHandler = async (req, res) => { res.status(201).json({ success: true, data: await service.create(actor(req).id, req.body) }); };
export const byUser: RequestHandler = async (req, res) => { res.json(await service.byUser(objectId.parse(req.params.id), paginationSchema.parse(req.query))); };
