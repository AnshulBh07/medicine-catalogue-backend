import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { usersRouter } from '../modules/users/user.routes.js';
import { saltsRouter } from '../modules/salts/salt.routes.js';
import { compositionSaltsRouter } from '../modules/composition-salts/composition-salt.routes.js';
import { compositionsRouter } from '../modules/compositions/composition.routes.js';
import { medicinesRouter } from '../modules/medicines/medicine.routes.js';
import { batchesRouter } from '../modules/batches/batch.routes.js';
import { commercialDetailsRouter } from '../modules/commercial-details/commercial-details.routes.js';
import { mrsRouter } from '../modules/mrs/mr.routes.js';
import { manufacturersRouter } from '../modules/manufacturers/manufacturer.routes.js';
import { uploadsRouter } from '../modules/uploads/upload.routes.js';

export const router = Router();

router.use('/auth', authRouter);
router.use('/users', usersRouter);
router.use('/salts', saltsRouter);
router.use('/composition-salts', compositionSaltsRouter);
router.use('/compositions', compositionsRouter);
router.use('/medicines', medicinesRouter);
router.use('/batches', batchesRouter);
router.use('/medicines', commercialDetailsRouter);
router.use('/mrs', mrsRouter);
router.use('/manufacturers', manufacturersRouter);
router.use('/uploads', uploadsRouter);

router.get('/health', async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    response.status(200).json({
      status: 'ok',
      api: 'ok',
      database: 'reachable',
    });
  } catch {
    response.status(503).json({
      status: 'degraded',
      api: 'ok',
      database: 'unreachable',
    });
  }
});
