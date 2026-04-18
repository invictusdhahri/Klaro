import type { BankAdapter, BankBalance, BankCredentials } from './base';

export class StbAdapter implements BankAdapter {
  bankId = 'stb';
  bankName = 'Société Tunisienne de Banque';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async login(_credentials: BankCredentials): Promise<void> {
    throw new Error('StbAdapter.login: not implemented yet');
  }

  async extractTransactions() {
    return [];
  }

  async extractBalances(): Promise<BankBalance[]> {
    return [];
  }

  async logout(): Promise<void> {}
}
