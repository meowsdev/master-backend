import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * RESTRICT: no new orders (a provider is not offered any, a customer cannot place any). Still signed in.
 * BLOCK: signed out and locked out for now. BAN: the same, but only an admin can lift it.
 */
export const MODERATION_ACTIONS = [
  'RESTRICT',
  'UNRESTRICT',
  'BLOCK',
  'UNBLOCK',
  'BAN',
  'UNBAN',
] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export class ModerateMemberDto {
  @IsIn(MODERATION_ACTIONS)
  action!: ModerationAction;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
