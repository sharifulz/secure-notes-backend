export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function required<T>(value: T, message = 'Resource not found'): NonNullable<T> {
  if (value == null) throw new ApiError(404, message);
  return value;
}
