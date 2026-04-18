import type { TransactionCategory } from '../types/transaction';

export interface CategoryMeta {
  key: TransactionCategory;
  labelEn: string;
  labelFr: string;
  labelAr: string;
  isIncome: boolean;
  isEssential: boolean;
}

export const TX_CATEGORIES: readonly CategoryMeta[] = [
  { key: 'salary', labelEn: 'Salary', labelFr: 'Salaire', labelAr: 'راتب', isIncome: true, isEssential: false },
  { key: 'freelance_income', labelEn: 'Freelance', labelFr: 'Freelance', labelAr: 'عمل حر', isIncome: true, isEssential: false },
  { key: 'transfer_in', labelEn: 'Transfer in', labelFr: 'Virement reçu', labelAr: 'تحويل وارد', isIncome: true, isEssential: false },
  { key: 'transfer_out', labelEn: 'Transfer out', labelFr: 'Virement émis', labelAr: 'تحويل صادر', isIncome: false, isEssential: false },
  { key: 'food', labelEn: 'Food', labelFr: 'Alimentation', labelAr: 'غذاء', isIncome: false, isEssential: true },
  { key: 'food_delivery', labelEn: 'Food delivery', labelFr: 'Livraison repas', labelAr: 'توصيل طعام', isIncome: false, isEssential: false },
  { key: 'groceries', labelEn: 'Groceries', labelFr: 'Courses', labelAr: 'مشتريات', isIncome: false, isEssential: true },
  { key: 'transport', labelEn: 'Transport', labelFr: 'Transport', labelAr: 'نقل', isIncome: false, isEssential: true },
  { key: 'fuel', labelEn: 'Fuel', labelFr: 'Carburant', labelAr: 'وقود', isIncome: false, isEssential: true },
  { key: 'utilities', labelEn: 'Utilities', labelFr: 'Services publics', labelAr: 'خدمات عامة', isIncome: false, isEssential: true },
  { key: 'rent', labelEn: 'Rent', labelFr: 'Loyer', labelAr: 'إيجار', isIncome: false, isEssential: true },
  { key: 'telecom', labelEn: 'Telecom', labelFr: 'Télécom', labelAr: 'اتصالات', isIncome: false, isEssential: true },
  { key: 'subscription', labelEn: 'Subscription', labelFr: 'Abonnement', labelAr: 'اشتراك', isIncome: false, isEssential: false },
  { key: 'health', labelEn: 'Health', labelFr: 'Santé', labelAr: 'صحة', isIncome: false, isEssential: true },
  { key: 'education', labelEn: 'Education', labelFr: 'Éducation', labelAr: 'تعليم', isIncome: false, isEssential: true },
  { key: 'entertainment', labelEn: 'Entertainment', labelFr: 'Loisirs', labelAr: 'ترفيه', isIncome: false, isEssential: false },
  { key: 'shopping', labelEn: 'Shopping', labelFr: 'Achats', labelAr: 'تسوق', isIncome: false, isEssential: false },
  { key: 'cash_withdrawal', labelEn: 'Cash withdrawal', labelFr: 'Retrait', labelAr: 'سحب نقدي', isIncome: false, isEssential: false },
  { key: 'fees', labelEn: 'Bank fees', labelFr: 'Frais bancaires', labelAr: 'رسوم بنكية', isIncome: false, isEssential: false },
  { key: 'loan_payment', labelEn: 'Loan payment', labelFr: 'Remboursement', labelAr: 'سداد قرض', isIncome: false, isEssential: true },
  { key: 'insurance', labelEn: 'Insurance', labelFr: 'Assurance', labelAr: 'تأمين', isIncome: false, isEssential: true },
  { key: 'savings', labelEn: 'Savings', labelFr: 'Épargne', labelAr: 'ادخار', isIncome: false, isEssential: false },
  { key: 'other', labelEn: 'Other', labelFr: 'Autre', labelAr: 'أخرى', isIncome: false, isEssential: false },
];

export const CATEGORY_MAP: Record<TransactionCategory, CategoryMeta> = Object.fromEntries(
  TX_CATEGORIES.map((c) => [c.key, c]),
) as Record<TransactionCategory, CategoryMeta>;
