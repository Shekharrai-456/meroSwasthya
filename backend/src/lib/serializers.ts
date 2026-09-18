import type { Prisma } from '../../generated/prisma/client.js';

// The only place a User row becomes API JSON (REQ-API-007, REQ-USER-002).
// Deliberately whitelist-only: this function never spreads the source row, so
// pinHash can never leak into a response body even if a caller passes a row
// with extra fields selected.

export type UserWithFacility = Prisma.UserGetPayload<{ include: { facility: true } }>;

export interface UserDto {
  id: string;
  phone: string;
  role: string;
  name: string;
  facilityId: string | null;
  facilityName: string | null;
  createdAt: string;
}

export function toUserDto(user: UserWithFacility): UserDto {
  return {
    id: user.id,
    phone: user.phone,
    role: user.role,
    name: user.name,
    facilityId: user.facilityId,
    facilityName: user.facility?.name ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
