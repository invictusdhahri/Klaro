import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TransactionsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Categorized automatically with Claude Haiku.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>No transactions yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Connect a bank or upload a statement to see your transactions here.
        </CardContent>
      </Card>
    </div>
  );
}
