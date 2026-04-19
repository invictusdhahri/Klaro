export {};

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string | null;
        role: 'user' | 'bank' | 'admin';
        accessToken: string;
        /** Bank organisation id (banks.id), present when role === 'bank'. */
        bankId?: string;
      };
    }
  }
}
