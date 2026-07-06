import bcrypt from "bcryptjs";

const FALLBACK_PASSWORD = "admin123";

/**
 * Bcrypt hash of the admin password. Sourced from ADMIN_PASSWORD_HASH env.
 * Falls back to a hash of "admin123" with a loud warning so the server is
 * usable out of the box for development but never silently insecure in prod.
 */
export const ADMIN_PASSWORD_HASH = (() => {
  const fromEnv = process.env.ADMIN_PASSWORD_HASH;
  if (fromEnv && !fromEnv.includes("replaceWithRealHash")) {
    return fromEnv;
  }
  console.warn(
    "\x1b[33m[auth] WARNING: ADMIN_PASSWORD_HASH not set. " +
      `Using insecure default "${FALLBACK_PASSWORD}". Set ADMIN_PASSWORD_HASH in .env before any public deploy.\x1b[0m`
  );
  return bcrypt.hashSync(FALLBACK_PASSWORD, 10);
})();

/**
 * Express middleware. Requires an authenticated admin session.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function requireAuth(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  return res.status(401).json({ error: "Unauthorized" });
}
