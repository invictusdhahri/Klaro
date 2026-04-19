import { Router } from 'express';
import { bankRegistrationSchema } from '@klaro/shared';
import { authLimiter } from '../middleware/rate-limit';
import { validate } from '../middleware/validate';
import { supabaseAdmin } from '../services/supabase';
import { logger } from '../lib/logger';

/**
 * Public, unauthenticated bank-side endpoints.
 *
 * Currently exposes self-service registration for new banks. A registration
 * creates three things atomically (best-effort with rollback on failure):
 *   1. A row in `public.banks` (the bank organisation record).
 *   2. An auth user with `app_metadata = { role: 'bank', bank_id }`.
 *   3. A `public.bank_users` link row tying the auth user to the bank.
 *
 * Future hardening: e-mail verification, captcha / abuse protection, manual
 * approval workflow, and richer KYB (corporate ID, license number, etc.).
 */
export const bankPublicRouter = Router();

bankPublicRouter.post(
  '/register',
  authLimiter,
  validate(bankRegistrationSchema),
  async (req, res) => {
    const { slug, name, logoUrl, country, admin } = req.body as ReturnType<
      typeof bankRegistrationSchema.parse
    >;

    const slugLower = slug.toLowerCase();

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from('banks')
      .select('id')
      .eq('slug', slugLower)
      .maybeSingle();

    if (lookupError) {
      logger.error({ err: lookupError, slug: slugLower }, 'bank registration: slug lookup failed');
      res.status(500).json({ error: 'internal_error' });
      return;
    }
    if (existing) {
      res.status(409).json({
        error: 'bank_slug_taken',
        message: `A bank with slug "${slugLower}" already exists`,
      });
      return;
    }

    const { data: bankRow, error: insertBankError } = await supabaseAdmin
      .from('banks')
      .insert({
        slug: slugLower,
        name,
        logo_url: logoUrl && logoUrl.length > 0 ? logoUrl : null,
        country: country.toUpperCase(),
      })
      .select('id, slug, name, logo_url, country')
      .single();

    if (insertBankError || !bankRow) {
      logger.error({ err: insertBankError, slug: slugLower }, 'bank registration: insert failed');
      res.status(500).json({ error: 'internal_error', message: 'Failed to create bank' });
      return;
    }

    const bankId = bankRow.id;

    const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email: admin.email,
      password: admin.password,
      email_confirm: true,
      app_metadata: { role: 'bank', bank_id: bankId },
      user_metadata: { full_name: admin.fullName, bank_slug: bankRow.slug },
    });

    if (createUserError || !createdUser?.user) {
      logger.error(
        { err: createUserError, slug: slugLower, email: admin.email },
        'bank registration: auth user create failed',
      );
      // Roll back the bank row so the slug remains available.
      await supabaseAdmin.from('banks').delete().eq('id', bankId);

      const message = createUserError?.message ?? 'Failed to create administrator account';
      const status =
        createUserError?.status === 422 || /already.*registered/i.test(message) ? 409 : 400;
      res.status(status).json({
        error: status === 409 ? 'email_taken' : 'auth_create_failed',
        message,
      });
      return;
    }

    const authUserId = createdUser.user.id;

    const { error: linkError } = await supabaseAdmin
      .from('bank_users')
      .insert({ bank_id: bankId, user_id: authUserId, role: 'admin' });

    if (linkError) {
      logger.error(
        { err: linkError, bankId, authUserId },
        'bank registration: bank_users link failed',
      );
      // Best-effort cleanup of the auth user + bank row.
      await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => undefined);
      await supabaseAdmin.from('banks').delete().eq('id', bankId);
      res.status(500).json({ error: 'internal_error', message: 'Failed to link administrator' });
      return;
    }

    res.status(201).json({
      bank: {
        id: bankRow.id,
        slug: bankRow.slug,
        name: bankRow.name,
        logoUrl: bankRow.logo_url,
        country: bankRow.country,
      },
      admin: {
        id: authUserId,
        email: createdUser.user.email ?? admin.email,
      },
    });
  },
);
