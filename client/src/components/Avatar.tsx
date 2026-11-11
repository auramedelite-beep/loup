import { avatarIcon } from '@/lib/roles';

const SIZES = {
  xs: 'h-7 w-7',
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
  xl: 'h-20 w-20',
  '2xl': 'h-28 w-28',
} as const;
const ICON_SIZES = { xs: 14, sm: 17, md: 20, lg: 24, xl: 32, '2xl': 44 } as const;

export type AvatarSize = keyof typeof SIZES;

export function Avatar({
  avatar,
  size = 'md',
  online,
  ring = true,
  className = '',
}: {
  avatar: string | null | undefined;
  size?: AvatarSize;
  online?: boolean;
  ring?: boolean;
  className?: string;
}) {
  const AvatarIcon = avatarIcon(avatar);

  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <span
        className={`avatar-ring ${SIZES[size]} ${ring ? 'border-gold-500/25' : 'border-transparent'} bg-gradient-to-br from-ink-700 to-ink-900`}
        aria-hidden
      >
        <AvatarIcon size={ICON_SIZES[size]} strokeWidth={1.7} className="text-parchment-200" />
      </span>
      {typeof online === 'boolean' && (
        <span
          className={`absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-ink-900 ${
            online ? 'bg-emerald-400' : 'bg-mist/40'
          }`}
          aria-hidden
        />
      )}
    </span>
  );
}
