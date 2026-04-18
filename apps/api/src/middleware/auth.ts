import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '@/services/supabase';

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
  req.user = {
    id: data.user.id,
    email: data.user.email ?? null,
    role,
    accessToken: token,
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
