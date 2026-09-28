export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (code: string, message: string, details?: unknown) => new AppError(400, code, message, details);
export const unauthorized = (message = "Authentification requise") => new AppError(401, "unauthorized", message);
export const forbidden = (message = "Accès refusé") => new AppError(403, "forbidden", message);
export const notFound = (what = "Ressource") => new AppError(404, "not_found", `${what} introuvable`);
export const conflict = (code: string, message: string) => new AppError(409, code, message);
