import Link from 'next/link';
import { TUNISIAN_BANKS } from '@klaro/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function ConnectBankPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect your bank</h1>
        <p className="text-sm text-muted-foreground">
          Pick your bank to fetch your transaction history. Credentials are encrypted in your
          browser before leaving your device.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TUNISIAN_BANKS.map((bank) => (
          <Card key={bank.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{bank.shortName}</span>
                {!bank.supported && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                    Coming soon
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-xs text-muted-foreground">{bank.name}</p>
              <Button disabled={!bank.supported} variant={bank.supported ? 'default' : 'outline'}>
                {bank.supported ? 'Connect' : 'Notify me'}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Prefer to upload statements?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Upload PDF statements, images, CSV exports, or payslips. Each file goes through
            deepfake detection, authenticity checks, and cross-consistency verification before
            transactions are imported.
          </p>
          <Link href="/documents">
            <Button variant="outline">Upload statement</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
