import { IsIn, IsUUID } from 'class-validator';

/** OFFER: the provider may accept or decline. ASSIGN: the order is theirs at once. */
export const ASSIGNMENT_MODES = ['OFFER', 'ASSIGN'] as const;
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number];

export class AssignOrderDto {
  /** A provider profile id (not a user id), as in the assignable-providers list. */
  @IsUUID()
  providerId!: string;

  @IsIn(ASSIGNMENT_MODES)
  mode!: AssignmentMode;
}
