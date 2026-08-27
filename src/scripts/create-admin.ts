import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { $Enums } from '@prisma/client/index';
import { AppError } from '../common/errors/app-error.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createUser } from '../modules/users/user.service.js';
import { createUserSchema } from '../modules/users/user.schemas.js';

type AdminCredentials = {
  name: string;
  email: string | null;
  phone: string | null;
  password: string;
};

const getCredentials = async (): Promise<AdminCredentials> => {
  const configured = [
    process.env.ADMIN_NAME,
    process.env.ADMIN_EMAIL,
    process.env.ADMIN_PHONE,
    process.env.ADMIN_PASSWORD,
  ];

  if (configured.some((value) => value !== undefined)) {
    if (!process.env.ADMIN_NAME || !process.env.ADMIN_PASSWORD) {
      throw new AppError(
        400,
        'INVALID_ADMIN_CONFIGURATION',
        'ADMIN_NAME and ADMIN_PASSWORD are required when using admin environment variables',
      );
    }

    return {
      name: process.env.ADMIN_NAME,
      email: process.env.ADMIN_EMAIL ?? null,
      phone: process.env.ADMIN_PHONE ?? null,
      password: process.env.ADMIN_PASSWORD,
    };
  }

  const readline = createInterface({ input, output });

  try {
    return {
      name: await readline.question('Admin name: '),
      email: (await readline.question('Admin email (optional): ')) || null,
      phone: (await readline.question('Admin phone (optional): ')) || null,
      password: await readline.question('Admin password: '),
    };
  } finally {
    readline.close();
  }
};

const main = async (): Promise<void> => {
  if (env.NODE_ENV !== 'development') {
    throw new AppError(403, 'DEVELOPMENT_ONLY', 'The create-admin command is development-only');
  }

  const existingAdminCount = await prisma.user.count({
    where: { role: $Enums.UserRole.ADMIN },
  });

  if (existingAdminCount > 0) {
    throw new AppError(409, 'ADMIN_ALREADY_EXISTS', 'An ADMIN account already exists');
  }

  const credentials = await getCredentials();
  const parsed = createUserSchema.safeParse({
    ...credentials,
    role: $Enums.UserRole.ADMIN,
  });

  if (!parsed.success) {
    throw parsed.error;
  }

  await createUser(parsed.data);
  logger.info('Initial ADMIN account created');
};

main()
  .catch((error: unknown) => {
    if (error instanceof AppError) {
      logger.error(error.message);
    } else if (error instanceof Error) {
      logger.error(error.message);
    } else {
      logger.error('Failed to create initial ADMIN account');
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
