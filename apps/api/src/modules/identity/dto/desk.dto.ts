// modules/identity/dto/desk.dto.ts · PC-56 TENANT-13b · desks (zod .strict). Field-level judgement (codes grantable, members in the
// tenant, reason 20–500) lives in DeskService.review so every refusal names its field; zod bounds the shape.
import { z } from 'zod';
const CODE = z.string().trim().max(80);
export const DeskProposalSchema = z.object({
  kind: z.enum(['create', 'edit', 'disable', 'enable', 'install_templates']),
  deskId: z.string().trim().max(40).optional().nullable(),
  code: z.string().trim().max(40).optional().nullable(),
  name: z.string().trim().max(120).optional().nullable(),
  description: z.string().trim().max(400).optional().nullable(),
  templateCode: z.string().trim().max(20).optional().nullable(),
  permissions: z.array(CODE).max(80).optional().nullable(),
  members: z.object({ add: z.array(z.string().trim().max(40)).max(250).optional(), remove: z.array(z.string().trim().max(40)).max(250).optional() }).strict().optional().nullable(),
  reason: z.string().max(600).optional().nullable(),
}).strict();
export type DeskProposalDto = z.infer<typeof DeskProposalSchema>;

export const DeskRefuseSchema = z.object({ reason: z.string().max(600) }).strict();
export type DeskRefuseDto = z.infer<typeof DeskRefuseSchema>;

export const DeskMemberAddSchema = z.object({ userId: z.string().trim().max(40), reason: z.string().max(400).optional().nullable() }).strict();
export type DeskMemberAddDto = z.infer<typeof DeskMemberAddSchema>;
export const DeskMemberRemoveSchema = z.object({ reason: z.string().max(400) }).strict();
export type DeskMemberRemoveDto = z.infer<typeof DeskMemberRemoveSchema>;

export const QueryDeskProposalsSchema = z.object({
  status: z.enum(['proposed', 'confirmed', 'refused', 'expired']).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryDeskProposalsDto = z.infer<typeof QueryDeskProposalsSchema>;
