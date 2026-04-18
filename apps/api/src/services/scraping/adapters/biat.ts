import type { BankAdapter, BankBalance, BankCredentials } from './base';

export class BiatAdapter implements BankAdapter {
  bankId = 'biat';
  bankName = 'Banque Internationale Arabe de Tunisie';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async login(_credentials: BankCredentials): Promise<void> {
    throw new Error('BiatAdapter.login: not implemented yet');
  }

  async extractTransactions() {
    return [];
  }

  async extractBalances(): Promise<BankBalance[]> {
    return [];
  }

  async logout(): Promise<void> {}
}
