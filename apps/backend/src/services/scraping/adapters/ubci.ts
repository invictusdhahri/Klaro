import fs from 'node:fs/promises';
import type { Browser, Page } from 'playwright';
import type { BankAdapter, BankBalance, BankCredentials } from './base';
import { uploadAndProcessStatement } from '../../statement.service';
import { logger } from '../../../lib/logger';

/**
 * UBCI – Union Bancaire pour le Commerce et l'Industrie
 * Portal: https://ubank.com.tn/
 *
 * Verified flow (Oracle JET / OBDX app):
 *  1.  Navigate to https://ubank.com.tn/  (waitUntil:'load', not 'networkidle')
 *  2.  Click oj-button.action-button-primary "Connexion"  → navigates to ?page=login-form
 *  3.  Fill input.oj-inputtext-input   → "Identifiant Utilisateur"
 *  4.  Fill input.oj-inputpassword-input → "Mot de passe"
 *  5.  Click oj-button#login-button to submit
 *  6.  Race: URL leaves login-form (success) vs. OTP modal appears (div.modal-window-viewport)
 *  7.  If OTP: fill input[id="otp|input"], click button:has-text("Soumettre")
 *  8.  extractTransactions():
 *        a. Navigate to ?page=manage-accounts~demand-deposit-transactions
 *        b. Click "Poursuivre"
 *        c. Wait for transactions table
 *        d. Download PDF: click "Télécharger" → "PDF"
 *        e. Upload buffer through the statement pipeline (OCR + verification)
 */
export class UbciAdapter implements BankAdapter {
  bankId = 'ubci';
  bankName = "Union Bancaire pour le Commerce et l'Industrie";

  private page: Page | null = null;
  private browser: Browser | null = null;
  private userId: string | null = null;

  async login(credentials: BankCredentials): Promise<void> {
    this.userId = credentials.userId ?? null;

    const { chromium } = await import('playwright');
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext({
      ignoreHTTPSErrors: true, // UBCI cert not trusted by headless Chromium
    });
    this.page = await context.newPage();

    // ── 1. Home page ─────────────────────────────────────────────────────────
    await this.page.goto('https://ubank.com.tn/', { waitUntil: 'load', timeout: 30_000 });
    await this.page.waitForSelector('oj-button.action-button-primary', { timeout: 20_000 });

    // ── 2. Open login form ────────────────────────────────────────────────────
    await this.page.locator('oj-button.action-button-primary', { hasText: 'Connexion' }).click();
    await this.page.waitForSelector('input.oj-inputtext-input', { timeout: 20_000 });

    // ── 3-4. Fill credentials ─────────────────────────────────────────────────
    await this.page.fill('input.oj-inputtext-input', credentials.username);
    await this.page.fill('input.oj-inputpassword-input', credentials.password);

    // ── 5. Submit ─────────────────────────────────────────────────────────────
    await this.page.locator('oj-button#login-button').click();

    // ── 6. Race: dashboard vs OTP modal ──────────────────────────────────────
    // Timeout is 50 s — UBCI's backend sometimes takes 30–40 s to trigger OTP.
    let outcome = await Promise.race([
      this.page
        .waitForURL((u) => !u.href.includes('login-form'), { timeout: 50_000 })
        .then(() => 'success' as const),
      this.page
        .waitForSelector('div.modal-window-viewport', { timeout: 50_000 })
        .then(() => 'otp' as const),
    ]).catch(() => 'unknown' as const);

    // If the race timed out, do one extra check: the OTP modal may have appeared
    // just after the deadline — check synchronously before giving up.
    if (outcome === 'unknown') {
      const otpVisible = await this.page.locator('div.modal-window-viewport').isVisible().catch(() => false);
      const leftLogin = !this.page.url().includes('login-form');
      if (otpVisible) outcome = 'otp';
      else if (leftLogin) outcome = 'success';
    }

    logger.info({ outcome, url: this.page.url() }, 'ubci: post-login outcome');

    // ── 7. OTP handling ───────────────────────────────────────────────────────
    if (outcome === 'otp') {
      if (!credentials.otpProvider) {
        throw new Error('UbciAdapter: OTP required but no otpProvider supplied');
      }
      const otp = await credentials.otpProvider();

      // OTP input id is "otp|input" – use attribute selector to handle the pipe
      await this.page.fill('input[id="otp|input"]', otp);
      await this.page.locator('button', { hasText: 'Soumettre' }).first().click();

      await this.page
        .waitForURL((u) => !u.href.includes('login-form'), { timeout: 40_000 })
        .catch(() => {
          throw new Error('UBCI OTP verification failed or timed out');
        });
    } else if (outcome === 'unknown') {
      const url = this.page.url();
      throw new Error(`UBCI login failed: page stayed on login-form after 50 s (url: ${url})`);
    }

    logger.info({ url: this.page.url() }, 'ubci: logged in successfully');
  }

  async extractTransactions() {
    if (!this.page) return [];

    const log = logger.child({ scope: 'ubci-transactions', userId: this.userId });

    // ── a. Wait for home dashboard to be ready ────────────────────────────────
    // After login the SPA is already on the home dashboard.
    // "Consulter un relevé" is a tile on that page — no URL navigation needed.
    // #region agent log
    fetch('http://127.0.0.1:7602/ingest/2102fef7-c894-4b9c-9080-261202272d0d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28fbaf'},body:JSON.stringify({sessionId:'28fbaf',location:'ubci.ts:a-start',message:'extractTransactions start — current URL',data:{url:this.page.url()},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    log.info({ url: this.page.url() }, 'ubci: starting extraction from home dashboard');

    // ── b. Click "Consulter un relevé" ───────────────────────────────────────
    const consulterLocator = this.page.locator('text=Consulter un relevé').first();
    await consulterLocator.waitFor({ state: 'visible', timeout: 30_000 });

    // #region agent log
    fetch('http://127.0.0.1:7602/ingest/2102fef7-c894-4b9c-9080-261202272d0d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28fbaf'},body:JSON.stringify({sessionId:'28fbaf',location:'ubci.ts:b-consulter',message:'Consulter un relevé visible — clicking',data:{url:this.page.url()},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    await consulterLocator.click();

    // Screenshot after click for debugging
    await this.page.waitForTimeout(3_000);
    await this.page.screenshot({ path: '/tmp/ubci_transactions_debug.png', fullPage: true }).catch(() => undefined);

    // #region agent log
    fetch('http://127.0.0.1:7602/ingest/2102fef7-c894-4b9c-9080-261202272d0d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28fbaf'},body:JSON.stringify({sessionId:'28fbaf',location:'ubci.ts:b-after-click',message:'after Consulter click — URL and screenshot saved',data:{url:this.page.url()},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // ── c. Wait for the "Télécharger" download button ────────────────────────
    const telechargerLocator = this.page.locator('button', { hasText: 'Télécharger' });
    await telechargerLocator.waitFor({ state: 'visible', timeout: 45_000 });

    // #region agent log
    fetch('http://127.0.0.1:7602/ingest/2102fef7-c894-4b9c-9080-261202272d0d',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'28fbaf'},body:JSON.stringify({sessionId:'28fbaf',location:'ubci.ts:c-telecharger',message:'Télécharger button visible',data:{url:this.page.url()},hypothesisId:'H-A',timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    await this.page.waitForTimeout(1_000);

    // ── d. Download PDF ───────────────────────────────────────────────────────
    log.info('clicking Télécharger');
    await telechargerLocator.click();

    // Wait for the dropdown menu with the PDF option
    await this.page.locator('span', { hasText: 'PDF' }).first().waitFor({ state: 'visible', timeout: 10_000 });

    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 30_000 }),
      this.page.locator('span', { hasText: 'PDF' }).first().click(),
    ]);

    const tmpPath = await download.path();
    if (!tmpPath) throw new Error('UBCI: PDF download failed — no path returned');

    const buffer = await fs.readFile(tmpPath);
    const fileName = download.suggestedFilename() || 'ubci-statement.pdf';
    log.info({ fileName, bytes: buffer.byteLength }, 'ubci: PDF downloaded');

    // ── e. Upload through the existing statement pipeline ─────────────────────
    if (this.userId) {
      const { id, status } = await uploadAndProcessStatement(
        this.userId,
        buffer,
        fileName,
        'application/pdf',
      );
      log.info({ statementId: id, status }, 'ubci: statement uploaded for processing');
    } else {
      log.warn('ubci: no userId available — statement not uploaded');
    }

    // Transactions will be extracted asynchronously by the ML pipeline
    return [];
  }

  async extractBalances(): Promise<BankBalance[]> {
    return [];
  }

  async logout(): Promise<void> {
    try {
      await this.page?.close().catch(() => undefined);
    } finally {
      await this.browser?.close().catch(() => undefined);
      this.page = null;
      this.browser = null;
    }
  }
}
