import { z } from "zod";

export const RoleSchema = z.enum(["admin", "judge", "manager", "reviewer", "user"]);

export const OrgRecordSchema = z.object({
  name: z.string(),
  slug: z.string(),
  createdAt: z.number(),
  createdBy: z.string(),
});

export const UserRecordSchema = z.object({
  passwordHash: z.string(),
  role: RoleSchema,
  supervisor: z.string().nullable().optional(),
  createdAt: z.number(),
});

export const AuthContextSchema = z.object({
  email: z.string(),
  orgId: z.string(),
  role: RoleSchema,
});

export type Role = z.infer<typeof RoleSchema>;
export type OrgRecord = z.infer<typeof OrgRecordSchema>;
export type UserRecord = z.infer<typeof UserRecordSchema>;
export type AuthContext = z.infer<typeof AuthContextSchema>;
