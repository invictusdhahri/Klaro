'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { API_ENDPOINTS } from '@klaro/shared';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerificationLayer {
  passed: boolean;
  confidence?: number;
  score?: number;
  coherence_score?: number;
  signals?: string[];
  failed_rules?: string[];
  flags?: CoherenceFlag[];
}

interface CoherenceFlag {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}

interface AnomalySignal {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detail: string;
  evidence?: Record<string, unknown>;
}

interface BankStatement {
  id: string;
  file_name: string;
  mime_type: string;
  status: 'pending' | 'processing' | 'processed' | 'verification_failed' | 'failed';
  extracted_count: number;
  coherence_score: number | null;
  verification_report: {
    passed?: boolean;
    failed_layer?: string | null;
    layers?: {
      deepfake?: VerificationLayer;
      authenticity?: VerificationLayer;
      consistency?: VerificationLayer;
    };
  };
  anomaly_report: {
    anomaly_score?: number;
    flagged?: boolean;
    signals?: AnomalySignal[];
  };
  error_message: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'image/tiff',
  'application/pdf',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',');

const SEVERITY_CLASSES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  high:     'bg-orange-100 text-orange-800 border-orange-300',
  medium:   'bg-yellow-100 text-yellow-800 border-yellow-300',
  low:      'bg-blue-100 text-blue-800 border-blue-300',
};

const MIME_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'text/csv': 'CSV',
  'application/vnd.ms-excel': 'XLS',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
  'image/jpeg': 'JPG',
  'image/jpg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
  'image/tiff': 'TIFF',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getToken(): Promise<string | null> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

function CoherenceBar({ score }: { score: number | null }) {
  if (score === null) return null;
  const pct = Math.round(score * 100);
  const color = score >= 0.8 ? 'bg-green-500' : score >= 0.5 ? 'bg-yellow-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground w-20 shrink-0">Coherence</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}

function LayerChip({ label, layer }: { label: string; layer?: VerificationLayer }) {
  if (!layer) return null;
  const passed = layer.passed;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        passed ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'
      }`}
    >
      <span>{passed ? '✓' : '✗'}</span>
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: BankStatement['status'] }) {
  const map: Record<BankStatement['status'], { label: string; cls: string }> = {
    pending:              { label: 'Pending',         cls: 'bg-muted text-muted-foreground' },
    processing:           { label: 'Processing…',     cls: 'bg-blue-100 text-blue-800 animate-pulse' },
    processed:            { label: 'Processed',       cls: 'bg-green-100 text-green-800' },
    verification_failed:  { label: 'Failed Checks',   cls: 'bg-red-100 text-red-800' },
    failed:               { label: 'Error',           cls: 'bg-orange-100 text-orange-800' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
  );
}

// ---------------------------------------------------------------------------
// Statement card
// ---------------------------------------------------------------------------

function StatementCard({
  stmt,
  onDelete,
  onReupload,
}: {
  stmt: BankStatement;
  onDelete: (id: string) => void;
  onReupload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const layers = stmt.verification_report?.layers;
  const allFlags = [
    ...(layers?.consistency?.flags ?? []),
  ];
  const anomalySignals = stmt.anomaly_report?.signals ?? [];
  const allSignals = [...allFlags, ...anomalySignals];

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
            {MIME_LABELS[stmt.mime_type] ?? 'FILE'}
          </span>
          <span className="truncate text-sm font-medium">{stmt.file_name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusPill status={stmt.status} />
          <span className="text-xs text-muted-foreground">
            {new Date(stmt.created_at).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* Verification layer chips */}
      {layers && (
        <div className="flex flex-wrap gap-1.5">
          <LayerChip label="Deepfake" layer={layers.deepfake} />
          <LayerChip label="Authenticity" layer={layers.authenticity} />
          <LayerChip label="Consistency" layer={layers.consistency} />
        </div>
      )}

      {/* Coherence score bar */}
      <CoherenceBar score={stmt.coherence_score} />

      {/* Extracted count */}
      {stmt.status === 'processed' && (
        <p className="text-xs text-muted-foreground">
          {stmt.extracted_count} transaction{stmt.extracted_count !== 1 ? 's' : ''} extracted
        </p>
      )}

      {/* Error message */}
      {stmt.error_message && (
        <p className="text-xs text-red-600">{stmt.error_message}</p>
      )}

      {/* Anomaly report summary */}
      {stmt.status === 'processed' && stmt.anomaly_report?.flagged && (
        <div className="rounded-md bg-orange-50 border border-orange-200 px-3 py-2 text-xs text-orange-800">
          Anomaly score: {Math.round((stmt.anomaly_report.anomaly_score ?? 0) * 100)}% — flagged for review
        </div>
      )}

      {/* Expandable flags */}
      {allSignals.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-xs text-primary hover:underline"
          >
            {expanded ? 'Hide' : 'Show'} {allSignals.length} flag{allSignals.length !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul className="mt-2 space-y-2">
              {allSignals.map((f, i) => (
                <li
                  key={i}
                  className={`rounded-md border px-3 py-2 text-xs ${SEVERITY_CLASSES[f.severity] ?? ''}`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <span className="uppercase tracking-wide">{f.severity}</span>
                    <span className="font-mono">{f.type.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1 text-current/80">{f.detail}</p>
                  {f.evidence && (
                    <pre className="mt-1 text-current/60 text-[10px] whitespace-pre-wrap">
                      {JSON.stringify(f.evidence, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Action row */}
      <div className="flex gap-2 pt-1">
        {stmt.status === 'verification_failed' && (
          <Button size="sm" variant="outline" onClick={onReupload}>
            Re-upload
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => onDelete(stmt.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DocumentsPage() {
  const [statements, setStatements] = useState<BankStatement[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatements = useCallback(async () => {
    const token = await getToken();
    if (!token) return;

    try {
      const res = await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.list}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const json = await res.json() as { data: BankStatement[] };
      setStatements(json.data ?? []);
    } catch {
      // silently ignore polling errors
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling while any row is processing
  useEffect(() => {
    void fetchStatements();
  }, [fetchStatements]);

  // Start/stop polling whenever the processing-row count changes.
  // The cleanup lives in a separate unmount-only effect so it never
  // fires between re-renders and kills the interval prematurely.
  useEffect(() => {
    const hasProcessing = statements.some((s) => s.status === 'processing' || s.status === 'pending');
    if (hasProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(() => void fetchStatements(), 3000);
    } else if (!hasProcessing && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, [statements, fetchStatements]);

  // Unmount-only cleanup — never fires between re-renders.
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Upload
  // ---------------------------------------------------------------------------

  const handleFile = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    setUploadProgress(0);

    const token = await getToken();
    if (!token) {
      setUploadError('Not authenticated');
      setUploading(false);
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.upload}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        setUploading(false);
        setUploadProgress(0);
        if (xhr.status === 202) {
          void fetchStatements();
        } else if (xhr.status === 409) {
          setUploadError('This file has already been uploaded.');
        } else {
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            setUploadError(body.error ?? 'Upload failed');
          } catch {
            setUploadError('Upload failed');
          }
        }
        resolve();
      };

      xhr.onerror = () => {
        setUploading(false);
        setUploadError('Network error during upload');
        resolve();
      };

      xhr.send(formData);
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (id: string) => {
    const token = await getToken();
    if (!token) return;
    try {
      await fetch(`${env.NEXT_PUBLIC_API_BASE_URL}${API_ENDPOINTS.documents.delete(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      setStatements((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // ignore
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground">
          Upload bank statements, payslips, or transaction exports instead of connecting your bank.
          Every file goes through a 3-layer security verification before transactions are imported.
        </p>
      </div>

      {/* Upload zone */}
      <Card>
        <CardHeader>
          <CardTitle>Upload a statement</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => !uploading && fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 cursor-pointer transition-colors ${
              dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50'
            } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="text-center space-y-2">
              <div className="text-3xl">📄</div>
              <p className="text-sm font-medium">
                {uploading ? `Uploading… ${uploadProgress}%` : 'Drop your file here or click to browse'}
              </p>
              <p className="text-xs text-muted-foreground">
                PDF · Image (JPG PNG WEBP TIFF) · CSV · Excel — max 20 MB
              </p>
            </div>

            {/* Progress bar */}
            {uploading && (
              <div className="mt-4 w-full max-w-xs">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {uploadError && (
            <p className="mt-3 text-sm text-destructive">{uploadError}</p>
          )}

          {/* Format legend */}
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>🔍 Layer 1: Deepfake detection</span>
            <span>📋 Layer 2: Document authenticity</span>
            <span>🔗 Layer 3: Cross-consistency + web verification</span>
            <span>📊 Anomaly analysis on extracted transactions</span>
          </div>
        </CardContent>
      </Card>

      {/* Statements list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : statements.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No statements uploaded yet. Upload a PDF, image, or CSV to get started.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
            {statements.length} statement{statements.length !== 1 ? 's' : ''}
          </h2>
          {statements.map((s) => (
            <StatementCard
              key={s.id}
              stmt={s}
              onDelete={handleDelete}
              onReupload={() => fileInputRef.current?.click()}
            />
          ))}
        </div>
      )}
    </div>
  );
}
