import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Send, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/contexts/SocketContext';
import { useToast } from '@/contexts/ToastContext';
import { Avatar } from './Avatar';
import { cn } from '@/lib/format';
import { errorCode } from '@/lib/api';

const MAX_LENGTH = 280;

export function ChatPanel({
  className = '',
  placeholder,
  disabled = false,
  disabledHint,
  height = 'h-[360px]',
}: {
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  disabledHint?: string;
  height?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { chat, typing, sendChat, sendTyping, connected } = useSocket();
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const typingActive = useRef(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chat.length]);

  useEffect(
    () => () => {
      if (typingTimer.current) window.clearTimeout(typingTimer.current);
    },
    [],
  );

  const stopTyping = () => {
    if (typingTimer.current) {
      window.clearTimeout(typingTimer.current);
      typingTimer.current = null;
    }
    if (typingActive.current) {
      typingActive.current = false;
      sendTyping(false);
    }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    if (!value.trim()) {
      stopTyping();
      return;
    }
    if (!typingActive.current) {
      typingActive.current = true;
      sendTyping(true);
    }
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, 2500);
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sending || disabled) return;
    setSending(true);
    try {
      const ack = await sendChat(body);
      if (!ack.ok) {
        toast.error(t(`errors.${ack.error ?? 'unknown_error'}`, { defaultValue: t('errors.unknown_error') }));
        return;
      }
      setDraft('');
      stopTyping();
    } finally {
      setSending(false);
    }
  };

  const typingNames = Object.values(typing).filter(Boolean);

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <div
        ref={scrollRef}
        className={cn('chat-scroll flex-1 space-y-2.5 pe-1', height)}
        aria-live="polite"
      >
        {chat.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Moon size={28} strokeWidth={1.5} className="opacity-60" aria-hidden />
            <p className="text-xs leading-relaxed text-mist">{t('chat.empty')}</p>
          </div>
        )}
        <AnimatePresence initial={false}>
          {chat.map((message) => {
            const mine = Boolean(user && message.userId === user.id);
            const system = message.channel === 'system';
            if (system) {
              return (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-center"
                >
                  <p className="chat-bubble chat-bubble-system max-w-full text-center text-[11px] leading-relaxed">
                    {message.deleted ? t('chat.deleted') : message.body}
                  </p>
                </motion.div>
              );
            }
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('flex items-end gap-2', mine && 'flex-row-reverse')}
              >
                {!mine && <Avatar avatar={null} size="xs" ring={false} />}
                <div className={cn('min-w-0', mine && 'flex flex-col items-end')}>
                  {!mine && (
                    <p className="mb-0.5 px-1 text-[10px] font-medium text-mist">
                      {message.username}
                      {message.channel === 'dead' && (
                        <span className="ms-1 text-blood-400/80">· {t('chat.dead')}</span>
                      )}
                    </p>
                  )}
                  <div
                    className={cn(
                      'chat-bubble whitespace-pre-wrap break-words',
                      mine && 'chat-bubble-own',
                      message.channel === 'dead' && 'chat-bubble-dead',
                    )}
                  >
                    {message.deleted ? <em className="opacity-70">{t('chat.deleted')}</em> : message.body}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div className="mt-2 flex h-5 items-center px-1 text-[11px] text-gold-300/80">
        {typingNames.length === 1 && t('chat.typing', { name: typingNames[0] })}
        {typingNames.length > 1 && t('chat.typingMany')}
      </div>

      {disabled ? (
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 text-xs text-mist">
          <VolumeX size={14} className="shrink-0" />
          <span>{disabledHint ?? t('chat.closed')}</span>
        </div>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              value={draft}
              onChange={(event) => onDraftChange(event.target.value.slice(0, MAX_LENGTH))}
              onBlur={stopTyping}
              placeholder={placeholder ?? t('chat.placeholder')}
              className="input pe-12"
              maxLength={MAX_LENGTH}
              autoComplete="off"
              disabled={!connected}
              aria-label={t('chat.placeholder')}
            />
            <span className="pointer-events-none absolute bottom-1 end-3 text-[9px] tabular-nums text-mist/50">
              {draft.length}/{MAX_LENGTH}
            </span>
          </div>
          <button
            type="submit"
            className="btn-primary h-[42px] w-[42px] shrink-0 p-0"
            disabled={!draft.trim() || sending || !connected}
            aria-label={t('chat.send')}
          >
            <Send size={17} className="rtl:rotate-180" />
          </button>
        </form>
      )}
    </div>
  );
}
