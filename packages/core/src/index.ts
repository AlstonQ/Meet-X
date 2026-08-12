import { z } from "zod";

export const organizationIdSchema = z.string().regex(/^org_[0-9A-HJKMNP-TV-Z]{26}$/);
export const userIdSchema = z.string().regex(/^usr_[0-9A-HJKMNP-TV-Z]{26}$/);
export const meetingIdSchema = z.string().regex(/^mtg_[0-9A-HJKMNP-TV-Z]{26}$/);

export type OrganizationId = z.infer<typeof organizationIdSchema>;
export type UserId = z.infer<typeof userIdSchema>;
export type MeetingId = z.infer<typeof meetingIdSchema>;

export type Result<TValue, TError extends string> =
  | { ok: true; value: TValue }
  | { ok: false; error: TError };

export function ok<TValue>(value: TValue): Result<TValue, never> {
  return { ok: true, value };
}

export function err<TError extends string>(error: TError): Result<never, TError> {
  return { ok: false, error };
}
