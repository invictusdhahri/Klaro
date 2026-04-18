import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const placeholderClients = [
  { id: '11111111-1111-1111-1111-111111111111', name: 'Amine Trabelsi', score: 712, band: 'GOOD' },
  { id: '22222222-2222-2222-2222-222222222222', name: 'Sirine Khalifa', score: 854, band: 'EXCELLENT' },
  { id: '33333333-3333-3333-3333-333333333333', name: 'Karim Bouzid', score: 488, band: 'FAIR' },
];

export default function BankClientsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          Users who have granted your institution score visibility.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Consented users</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Score</th>
                <th className="pb-2 font-medium">Band</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {placeholderClients.map((c) => (
                <tr key={c.id}>
                  <td className="py-3">{c.name}</td>
                  <td className="py-3 tabular-nums">{c.score}</td>
                  <td className="py-3">{c.band}</td>
                  <td className="py-3 text-right">
                    <Link
                      href={`/bank/clients/${c.id}`}
                      className="text-primary hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
