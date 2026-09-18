// The one place HTTP status + error code pairs are defined (docs/API_CONTRACT.md §4/§6).
// Every thrown error in a route/service is an AppError; nothing else escapes to the client.

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  GRANT_EXPIRED: 'GRANT_EXPIRED',
  NOT_FOUND: 'NOT_FOUND',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  ALREADY_REDEEMED: 'ALREADY_REDEEMED',
  RULE_VIOLATION: 'RULE_VIOLATION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  GRANT_EXPIRED: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  ALREADY_REDEEMED: 409,
  RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,
};

export interface ValidationDetail {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: ValidationDetail[] | Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ValidationDetail[] | Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.details = details;
  }
}
