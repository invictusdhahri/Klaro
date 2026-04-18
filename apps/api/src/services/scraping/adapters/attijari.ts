import type { BankAdapter, BankBalance, BankCredentials } from './base';

export class AttijariAdapter implements BankAdapter {
  bankId = 'attijari';
  bankName = 'Attijari Bank';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async login(_credentials: BankCredentials): Promise<void> {
    // TODO: implement Playwright flow against https://www.attijaribank.com.tn/espace-client
    throw new Error('AttijariAdapter.login: not implemented yet');
  }

  async extractTransactions() {
    return [];
  }

  async extractBalances(): Promise<BankBalance[]> {
    return [];
  }

  async logout(): Promise<void> {
    // no-op until login is implemented
  }
}
