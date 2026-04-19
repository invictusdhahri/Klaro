import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { cn } from '@klaro/ui/cn';
import type { ChatRole } from '@klaro/shared';
import type { MessageAttachment } from '@/components/chat/chat-stream';

interface Props {
  role: ChatRole;
  content: string;
  streaming?: boolean;
  attachment?: MessageAttachment;
}

export function MessageBubble({ role, content, streaming, attachment }: Props) {
  const isUser = role === 'user';

  return (
    <div className={cn('flex w-full gap-3', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div
          aria-hidden
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/10"
        >
          K
        </div>
      )}

      <div className={cn('flex max-w-[85%] flex-col gap-1.5', isUser && 'items-end')}>
        {/* Attachment preview (shown above or alongside the text bubble) */}
        {attachment && (
          <AttachmentView attachment={attachment} isUser={isUser} />
        )}

        {/* Text bubble — omit when content is empty and there is an attachment */}
        {(content || streaming) && (
          <div
            className={cn(
              'text-sm leading-relaxed',
              isUser
                ? 'rounded-2xl rounded-br-md bg-primary px-4 py-2 text-primary-foreground'
                : 'rounded-2xl rounded-tl-md border border-border/60 bg-muted/40 px-4 py-2.5 text-foreground',
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{content}</p>
            ) : streaming && !content ? (
              <TypingDots />
            ) : (
              <div className="space-y-1">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: (p) => (
                      <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0" {...p} />
                    ),
                    h2: (p) => (
                      <h4 className="mb-1 mt-3 text-sm font-semibold first:mt-0" {...p} />
                    ),
                    h3: (p) => (
                      <h5 className="mb-1 mt-2 text-sm font-semibold first:mt-0" {...p} />
                    ),
                    p: (p) => (
                      <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0" {...p} />
                    ),
                    ul: (p) => (
                      <ul
                        className="my-2 ml-5 list-disc space-y-1 marker:text-muted-foreground"
                        {...p}
                      />
                    ),
                    ol: (p) => (
                      <ol
                        className="my-2 ml-5 list-decimal space-y-1 marker:text-muted-foreground"
                        {...p}
                      />
                    ),
                    li: (p) => <li className="leading-relaxed" {...p} />,
                    strong: (p) => (
                      <strong className="font-semibold text-foreground" {...p} />
                    ),
                    em: (p) => <em className="italic" {...p} />,
                    a: (p) => (
                      <a
                        className="text-primary underline underline-offset-2 hover:opacity-80"
                        {...p}
                      />
                    ),
                    code: (p) => (
                      <code
                        className="rounded bg-muted-foreground/10 px-1 py-0.5 font-mono text-[0.85em]"
                        {...p}
                      />
                    ),
                    pre: (p) => (
                      <pre
                        className="my-2 overflow-x-auto rounded-md bg-muted-foreground/10 p-3 text-[0.85em]"
                        {...p}
                      />
                    ),
                    blockquote: (p) => (
                      <blockquote
                        className="my-2 border-l-2 border-border pl-3 italic text-muted-foreground"
                        {...p}
                      />
                    ),
                    hr: () => <hr className="my-3 border-border/60" />,
                    table: (p) => (
                      <div className="my-2 overflow-x-auto">
                        <table className="w-full border-collapse text-xs" {...p} />
                      </div>
                    ),
                    th: (p) => (
                      <th
                        className="border border-border/60 px-2 py-1 text-left font-semibold"
                        {...p}
                      />
                    ),
                    td: (p) => <td className="border border-border/60 px-2 py-1" {...p} />,
                  }}
                >
                  {content}
                </ReactMarkdown>
                {streaming && content && (
                  <span className="ml-0.5 inline-block h-3 w-[2px] animate-pulse bg-foreground/60 align-middle" />
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentView({
  attachment,
  isUser,
}: {
  attachment: MessageAttachment;
  isUser: boolean;
}) {
  if (attachment.previewUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={attachment.previewUrl}
        alt={attachment.name}
        className={cn(
          'max-h-48 max-w-[260px] rounded-xl object-cover ring-1 ring-border/40',
          isUser ? 'self-end' : 'self-start',
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-xs',
        isUser ? 'self-end' : 'self-start',
      )}
    >
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="max-w-[200px] truncate text-foreground/80">{attachment.name}</span>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Klaro is typing">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/70" />
    </span>
  );
}
