import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../services/supabase';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized', message: 'Missing bearer token' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'unauthorized', message: 'Invalid token' });
    return;
  }

  const role = (data.user.app_metadata?.role as 'user' | 'bank' | 'admin' | undefined) ?? 'user';
  const bankIdRaw = data.user.app_metadata?.bank_id;
  const bankId = typeof bankIdRaw === 'string' && bankIdRaw.length > 0 ? bankIdRaw : undefined;
  req.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
    accessToken: token,
    bankId,
  };
  next();
}

export function requireRole(...roles: Array<'user' | 'bank' | 'admin'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!roles.includes(req.user.role) && req.user.role !== 'admin') {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/**
 * Bank-only guard: requires role=bank AND a resolved bankId from app_metadata.
 * Use this on every /api/bank/* route that scopes data by bank organisation.
 */
export function requireBank(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.user.role !== 'bank' && req.user.role !== 'admin') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  if (!req.user.bankId) {
    res.status(403).json({
      error: 'forbidden',
      message: 'Bank account is not linked to a bank organisation (missing app_metadata.bank_id)',
    });
    return;
  }
  next();
}
