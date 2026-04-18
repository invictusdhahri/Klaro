import { ChatStream } from '@/components/chat/chat-stream';

export default function ChatPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Klaro Advisor</h1>
        <p className="text-sm text-muted-foreground">
          Ask anything about your spending, income trends, or how to improve your score.
        </p>
      </div>
      <ChatStream />
    </div>
  );
}
