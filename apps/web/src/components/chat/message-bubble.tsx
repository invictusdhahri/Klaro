import { cn } from '@klaro/ui/cn';
import type { ChatRole } from '@klaro/shared';

interface Props {
  role: ChatRole;
  content: string;
}

export function MessageBubble({ role, content }: Props) {
  const isUser = role === 'user';
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed',
          isUser
            ? 'rounded-br-sm bg-primary text-primary-foreground'
            : 'rounded-bl-sm bg-muted text-foreground',
        )}
      >
        {content}
      </div>
    </div>
  );
}
