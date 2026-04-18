export interface BankInfo {
  id: string;
  name: string;
  shortName: string;
  loginUrl: string;
  supported: boolean;
  logoSlug: string;
}

export const TUNISIAN_BANKS: readonly BankInfo[] = [
  {
    id: 'attijari',
    name: 'Attijari Bank',
    shortName: 'Attijari',
    loginUrl: 'https://www.attijaribank.com.tn/espace-client',
    supported: true,
    logoSlug: 'attijari',
  },
  {
    id: 'stb',
    name: 'Société Tunisienne de Banque',
    shortName: 'STB',
    loginUrl: 'https://www.stb.com.tn/',
    supported: true,
    logoSlug: 'stb',
  },
  {
    id: 'biat',
    name: 'Banque Internationale Arabe de Tunisie',
    shortName: 'BIAT',
    loginUrl: 'https://www.biat.com.tn/',
    supported: true,
    logoSlug: 'biat',
  },
  {
    id: 'bna',
    name: 'Banque Nationale Agricole',
    shortName: 'BNA',
    loginUrl: 'https://www.bna.tn/',
    supported: false,
    logoSlug: 'bna',
  },
  {
    id: 'bh',
    name: 'Banque de l\'Habitat',
    shortName: 'BH',
    loginUrl: 'https://www.bh.com.tn/',
    supported: false,
    logoSlug: 'bh',
  },
  {
    id: 'amen',
    name: 'Amen Bank',
    shortName: 'Amen',
    loginUrl: 'https://www.amenbank.com.tn/',
    supported: false,
    logoSlug: 'amen',
  },
  {
    id: 'uib',
    name: 'Union Internationale de Banques',
    shortName: 'UIB',
    loginUrl: 'https://www.uib.com.tn/',
    supported: false,
    logoSlug: 'uib',
  },
] as const;

export const BANK_BY_ID: Record<string, BankInfo> = Object.fromEntries(
  TUNISIAN_BANKS.map((b) => [b.id, b]),
);
