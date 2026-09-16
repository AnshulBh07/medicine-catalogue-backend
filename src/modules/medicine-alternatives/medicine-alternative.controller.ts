import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../common/errors/app-error.js';
import { MedicineAlternativeService } from './medicine-alternative.service.js';
import type {
  CreateMedicineAlternativeInput,
  ListMedicineAlternativesQueryInput,
  UpdateMedicineAlternativeInput,
} from './medicine-alternative.schemas.js';

export const listAlternativesController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const query = req.query as unknown as ListMedicineAlternativesQueryInput;
    const alternatives = await MedicineAlternativeService.listAlternatives(query);
    res.status(200).json({ alternatives });
  } catch (error) {
    next(error);
  }
};

export const getByMedicineIdController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const { medicineId } = req.params as { medicineId: string };
    const result = await MedicineAlternativeService.getByMedicineId(medicineId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

export const createAlternativesController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    }
    const body = req.body as CreateMedicineAlternativeInput;
    const alternative = await MedicineAlternativeService.createAlternatives(userId, body);
    res.status(201).json({ alternative });
  } catch (error) {
    next(error);
  }
};

export const updateAlternativesController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    }
    const { sourceMedicineId } = req.params as { sourceMedicineId: string };
    const body = req.body as UpdateMedicineAlternativeInput;
    const alternative = await MedicineAlternativeService.updateAlternatives(
      userId,
      sourceMedicineId,
      body,
    );
    res.status(200).json({ alternative });
  } catch (error) {
    next(error);
  }
};

export const deleteAlternativesController = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication is required');
    }
    const { sourceMedicineId } = req.params as { sourceMedicineId: string };
    const result = await MedicineAlternativeService.deleteAlternatives(userId, sourceMedicineId);
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};
