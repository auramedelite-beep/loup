import type { NextFunction, Request, Response } from 'express';
import { resolveToken, tokenFromHeader } from './jwt';

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const result = resolveToken(tokenFromHeader(req.headers.authorization));
  if (!result.ok) {
    if (result.error === 'banned') {
      res.status(403).json({ error: 'banned', reason: result.reason ?? null, until: result.until ?? null });
      return;
    }
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.auth = {
    id: result.user.id,
    username: result.user.username,
    role: result.user.role,
    isGuest: Boolean(result.user.is_guest),
    tokenVersion: result.user.token_version,
  };
  next();
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const result = resolveToken(tokenFromHeader(req.headers.authorization));
  if (result.ok) {
    req.auth = {
      id: result.user.id,
      username: result.user.username,
      role: result.user.role,
      isGuest: Boolean(result.user.is_guest),
      tokenVersion: result.user.token_version,
    };
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== 'admin') {
    res.status(403).json({ error: 'admin_required' });
    return;
  }
  next();
}

import { getSetting } from '../db';

export function maintenanceGuard(req: Request, res: Response, next: NextFunction): void {
  const maintenance = getSetting('maintenance_mode', 'false') === 'true';
  if (maintenance && req.auth?.role !== 'admin' && !req.path.startsWith('/api/health') && !req.path.startsWith('/api/auth')) {
    res.status(503).json({
      error: 'maintenance',
      message: getSetting('maintenance_message', '') || 'The village is resting. Please come back soon.',
    });
    return;
  }
  next();
}
