import { z } from 'zod';
import { formatScheme } from '../../common/commercial.utils.js';

const hasMaxTwoDecimals = (value: number): boolean => {
  const str = value.toString();
  if (str.includes('e') || str.includes('E')) {
    return Number(value.toFixed(2)) === value;
  }
  const parts = str.split('.');
  return parts.length <= 1 || (parts[1] !== undefined && parts[1].length <= 2);
};

export const money = z.coerce
  .number()
  .finite()
  .nonnegative()
  .max(9999999999.99)
  .refine(hasMaxTwoDecimals, {
    message: 'Value must have at most 2 decimal places',
  });

export const discountPercent = z.coerce
  .number()
  .finite()
  .min(0)
  .max(100)
  .refine(hasMaxTwoDecimals, {
    message: 'Discount percent must have at most 2 decimal places',
  });

export const dealStatuses = ['PENDING', 'RECEIVED', 'CANCELLED'] as const;
export type DealStatusType = (typeof dealStatuses)[number];

export const dealSortFields = ['dealDate', 'medicineName', 'mrName', 'createdAt'] as const;
export type DealSortField = (typeof dealSortFields)[number];

export const sortOrders = ['asc', 'desc'] as const;
export type SortOrder = (typeof sortOrders)[number];

const schemeInput = z
  .union([
    z.string().trim().min(1, 'Agreed scheme is required'),
    z.record(z.string(), z.unknown()),
  ])
  .transform((val) => {
    const formatted = formatScheme(val);
    return formatted === 'None' ? 'None' : formatted;
  });

export const dealIdSchema = z.object({
  id: z.string().uuid(),
});

export const createDealSchema = z
  .object({
    medicineId: z.string().uuid('Invalid medicine ID'),
    mrId: z.string().uuid('Invalid MR ID'),
    dealDate: z
      .string()
      .trim()
      .refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid deal date format' })
      .transform((d) => new Date(d))
      .optional(),
    agreedMrp: money,
    agreedScheme: schemeInput,
    agreedBillDiscount: discountPercent,
    mrPhoneSnapshot: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null)),
    status: z.enum(dealStatuses).default('PENDING').optional(),
    notes: z
      .string()
      .trim()
      .max(10000)
      .nullable()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : null)),
  })
  .strict();

export const updateDealSchema = z
  .object({
    medicineId: z.string().uuid('Invalid medicine ID').optional(),
    mrId: z.string().uuid('Invalid MR ID').optional(),
    dealDate: z
      .string()
      .trim()
      .refine((d) => !isNaN(Date.parse(d)), { message: 'Invalid deal date format' })
      .transform((d) => new Date(d))
      .optional(),
    agreedMrp: money.optional(),
    agreedScheme: schemeInput.optional(),
    agreedBillDiscount: discountPercent.optional(),
    mrPhoneSnapshot: z
      .string()
      .trim()
      .max(20)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null)),
    status: z.enum(dealStatuses).optional(),
    notes: z
      .string()
      .trim()
      .max(10000)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null)),
  })
  .partial()
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided for update',
  });

export const updateDealStatusSchema = z
  .object({
    status: z.enum(dealStatuses),
  })
  .strict();

export const checkPendingDealQuerySchema = z.object({
  medicineId: z.string().uuid('Invalid medicine ID'),
  mrId: z.string().uuid('Invalid MR ID'),
});

export const listDealsSchema = z.object({
  medicineId: z.string().uuid().optional(),
  mrId: z.string().uuid().optional(),
  status: z.enum(['ALL', ...dealStatuses]).default('ALL').optional(),
  search: z.string().trim().optional(),
  sortBy: z.enum(dealSortFields).default('dealDate').optional(),
  sortOrder: z.enum(sortOrders).default('desc').optional(),
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
});

export type CreateDealInput = z.infer<typeof createDealSchema>;
export type UpdateDealInput = z.infer<typeof updateDealSchema>;
export type UpdateDealStatusInput = z.infer<typeof updateDealStatusSchema>;
export type ListDealsInput = z.infer<typeof listDealsSchema>;
export type CheckPendingDealQuery = z.infer<typeof checkPendingDealQuerySchema>;
