'use client';

import * as React from 'react';
import { cn } from '@klaro/ui/cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

type DocumentType = 'cin' | 'passport' | 'driver_license';

interface ExtractedFields {
  full_name: string | null;
  full_name_latin: string | null;
  cin_number: string | null;
  date_of_birth: string | null;
  expiry_date: string | null;
  address: string | null;
  gender: string | null;
}

type OcrResult =
  | { success: true; extracted: ExtractedFields; face_crop_base64: string; confidence: number; quality_score: number }
  | { success: false; reason: 'low_quality' | 'no_face_detected' };

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading' }
  | { status: 'error'; message: string }
  | { status: 'success'; result: Extract<OcrResult, { success: true }> };

// ── Sub-components ────────────────────────────────────────────────────────────

function ScorePill({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-500';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium">
      {label}
      <span className={cn('font-semibold tabular-nums', color)}>{pct}%</span>
    </span>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className={cn('text-sm', value ? 'text-foreground' : 'italic text-muted-foreground')}>
        {value ?? 'Not detected'}
      </span>
    </div>
  );
}

function DropZone({
  file,
  dragging,
  onFiles,
  onDragOver,
  onDragLeave,
  onDrop,
  onClick,
  inputRef,
}: {
  file: File | null;
  dragging: boolean;
  onFiles: (files: FileList) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const preview = file ? URL.createObjectURL(file) : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors',
        dragging
          ? 'border-primary bg-primary/5'
          : file
            ? 'border-border bg-muted/20'
            : 'border-border bg-muted/10 hover:border-primary/50 hover:bg-primary/5',
      )}
    >
      {preview ? (
        <img
          src={preview}
          alt="Document preview"
          className="max-h-40 max-w-full rounded object-contain p-2"
        />
      ) : (
        <div className="flex flex-col items-center gap-3 p-6 text-center">
          <UploadIcon className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Drop your document here or click to browse</p>
            <p className="text-xs text-muted-foreground mt-0.5">JPEG or PNG · max 10 MB</p>
          </div>
          {/* Capture tips */}
          <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1.5 text-left text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><GreenDot />Place flat on a surface</span>
            <span className="flex items-center gap-1.5"><GreenDot />Shoot directly from above</span>
            <span className="flex items-center gap-1.5"><GreenDot />Bright, even lighting</span>
            <span className="flex items-center gap-1.5"><RedDot />No glare or shadows</span>
            <span className="flex items-center gap-1.5"><RedDot />No tilt or angle</span>
            <span className="flex items-center gap-1.5"><RedDot />No fingers covering text</span>
          </div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
    </div>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('animate-spin', className)} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function GreenDot() {
  return <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />;
}

function RedDot() {
  return <span className="mt-px h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />;
}

// ── Doc type config ───────────────────────────────────────────────────────────

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'cin', label: 'CIN (Carte d\'Identité Nationale)' },
  { value: 'passport', label: 'Passport' },
  { value: 'driver_license', label: 'Driver License' },
];

const ERROR_MESSAGES: Record<string, string> = {
  low_quality: 'The image is too blurry or zoomed-in. Move further back so the full card is visible, use bright even lighting, and hold the camera steady.',
  tilted_image: 'The document is at too steep an angle. Lay it flat on a surface and shoot straight down — avoid holding the camera to the side.',
  no_face_detected: 'No face photo was detected on the document. Make sure the portrait is clearly visible and unobstructed.',
};

// ── Main component ────────────────────────────────────────────────────────────

interface IdUploadStepProps {
  onSuccess?: (result: Extract<OcrResult, { success: true }>) => void;
}

export function IdUploadStep({ onSuccess }: IdUploadStepProps) {
  const [docType, setDocType] = React.useState<DocumentType>('cin');
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [state, setState] = React.useState<UploadState>({ status: 'idle' });
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList) => {
    const picked = files[0];
    if (!picked) return;
    setFile(picked);
    setState({ status: 'idle' });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleUpload = async () => {
    if (!file) return;
    setState({ status: 'uploading' });

    try {
      const form = new FormData();
      form.append('image', file, file.name);
      form.append('document_type', docType);

      const raw = await api.post<OcrResult>('/api/kyc/upload', form);

      if (!raw.success) {
        setState({
          status: 'error',
          message: ERROR_MESSAGES[raw.reason] ?? `Extraction failed: ${raw.reason}`,
        });
        return;
      }

      setState({ status: 'success', result: raw });
      onSuccess?.(raw);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setState({ status: 'error', message: msg });
    }
  };

  const reset = () => {
    setFile(null);
    setState({ status: 'idle' });
  };

  const isSuccess = state.status === 'success';
  const isUploading = state.status === 'uploading';

  return (
    <div className="space-y-4">
      {/* Document type selector */}
      <div className="space-y-1.5">
        <label htmlFor="doc-type" className="text-sm font-medium">
          Document type
        </label>
        <select
          id="doc-type"
          value={docType}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
          disabled={isUploading || isSuccess}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {DOC_TYPES.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {/* Drop zone */}
      {!isSuccess && (
        <DropZone
          file={file}
          dragging={dragging}
          onFiles={handleFiles}
          onDragOver={handleDragOver}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          inputRef={inputRef}
        />
      )}

      {/* Error banner */}
      {state.status === 'error' && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {state.message}
        </div>
      )}

      {/* Action buttons */}
      {!isSuccess && (
        <div className="flex gap-2">
          <Button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className="flex-1"
          >
            {isUploading ? (
              <>
                <SpinnerIcon className="h-4 w-4" />
                Extracting…
              </>
            ) : (
              'Extract document data'
            )}
          </Button>
          {file && !isUploading && (
            <Button variant="outline" onClick={reset}>
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Success result */}
      {isSuccess && state.status === 'success' && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-green-600">
              <CheckIcon className="h-4 w-4" />
              Document extracted successfully
            </div>
            <div className="flex gap-2">
              <ScorePill label="Quality" value={state.result.quality_score} />
              <ScorePill label="Confidence" value={state.result.confidence} />
            </div>
          </div>

          {/* Face crop + fields */}
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            {/* Face crop */}
            <div className="flex flex-col items-center gap-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Document photo
              </span>
              <img
                src={`data:image/png;base64,${state.result.face_crop_base64}`}
                alt="Face detected on document"
                className="h-28 w-24 rounded-md border object-cover shadow-sm"
              />
            </div>

            {/* Fields grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <FieldRow label="Full name (Arabic)" value={state.result.extracted.full_name} />
              <FieldRow label="Full name (Latin)" value={state.result.extracted.full_name_latin} />
              <FieldRow label="ID number" value={state.result.extracted.cin_number} />
              <FieldRow label="Gender" value={state.result.extracted.gender} />
              <FieldRow label="Date of birth" value={state.result.extracted.date_of_birth} />
              <FieldRow label="Expiry date" value={state.result.extracted.expiry_date} />
              <div className="col-span-2">
                <FieldRow label="Address" value={state.result.extracted.address} />
              </div>
            </div>
          </div>

          <Button variant="outline" size="sm" onClick={reset} className="w-full">
            Upload a different document
          </Button>
        </div>
      )}
    </div>
  );
}
