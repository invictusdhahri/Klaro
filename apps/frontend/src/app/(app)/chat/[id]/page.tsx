import { ChatStream } from '@/components/chat/chat-stream';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ChatSessionPage({ params }: Props) {
  const { id } = await params;
  return <ChatStream sessionId={id} />;
}
