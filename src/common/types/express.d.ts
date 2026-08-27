import type { $Enums } from '@prisma/client/index';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: $Enums.UserRole;
      };
    }
  }
}

export {};
