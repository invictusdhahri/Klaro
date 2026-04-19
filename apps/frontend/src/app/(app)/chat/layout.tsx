import { ChatSessionsRail } from '@/components/chat/chat-sessions-rail';

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-7rem)] gap-4">
      <ChatSessionsRail />
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
