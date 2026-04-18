import { z } from 'zod';

export const occupationCategorySchema = z.enum([
  'student',
  'salaried',
  'freelance',
  'business_owner',
  'unemployed',
  'retired',
]);

export const kycStatusSchema = z.enum(['pending', 'verified', 'flagged', 'rejected']);

export const appRoleSchema = z.enum(['user', 'bank', 'admin']);

export const userProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1).max(200),
  dateOfBirth: z.string().date().nullable(),
  age: z.number().int().min(0).max(150).nullable(),
  occupation: z.string().max(200).nullable(),
  occupationCategory: occupationCategorySchema.nullable(),
  educationLevel: z.string().max(100).nullable(),
  locationGovernorate: z.string().max(100).nullable(),
  locationCountry: z.string().length(2).default('TN'),
  phone: z
    .string()
    .regex(/^\+?[0-9\s-]{6,20}$/)
    .nullable(),
  kycStatus: kycStatusSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const userProfileUpdateSchema = userProfileSchema
  .partial()
  .omit({ id: true, createdAt: true, updatedAt: true });

export type UserProfileInput = z.infer<typeof userProfileUpdateSchema>;
