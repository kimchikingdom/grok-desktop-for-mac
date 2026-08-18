type IconProps = {
  size?: number;
  className?: string;
};

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Official Grok mark from the product icon. */
export function LogoMark({ size = 28, className }: IconProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 509.641"
      className={className}
      aria-hidden
    >
      <path d="M115.612 0h280.776C459.975 0 512 52.026 512 115.612v278.416c0 63.587-52.025 115.613-115.612 115.613H115.612C52.026 509.641 0 457.615 0 394.028V115.612C0 52.026 52.026 0 115.612 0z" />
      <path
        fill="#fff"
        d="M213.235 306.019l178.976-180.002v.169l51.695-51.763c-.924 1.32-1.86 2.605-2.785 3.89-39.281 54.164-58.46 80.649-43.07 146.922l-.09-.101c10.61 45.11-.744 95.137-37.398 131.836-46.216 46.306-120.167 56.611-181.063 14.928l42.462-19.675c38.863 15.278 81.392 8.57 111.947-22.03 30.566-30.6 37.432-75.159 22.065-112.252-2.92-7.025-11.67-8.795-17.792-4.263l-124.947 92.341zm-25.786 22.437l-.033.034L68.094 435.217c7.565-10.429 16.957-20.294 26.327-30.149 26.428-27.803 52.653-55.359 36.654-94.302-21.422-52.112-8.952-113.177 30.724-152.898 41.243-41.254 101.98-51.661 152.706-30.758 11.23 4.172 21.016 10.114 28.638 15.639l-42.359 19.584c-39.44-16.563-84.629-5.299-112.207 22.313-37.298 37.308-44.84 102.003-1.128 143.81z"
      />
    </svg>
  );
}

export function IconFolder({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 5.5h4l1.2 1.5H13.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" {...stroke} />
    </Svg>
  );
}

export function IconFile({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M5 2.5h4.5L13.5 6.5V13a1 1 0 0 1-1 1h-7.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" {...stroke} />
      <path d="M9.5 2.5V6.5H13.5" {...stroke} />
    </Svg>
  );
}

export function IconSend({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M2.5 8 13.5 2.5 10 13.5 7.5 8.5 2.5 8Z" {...stroke} />
      <path d="M7.5 8.5 13.5 2.5" {...stroke} />
    </Svg>
  );
}

export function IconStop({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <rect x="4" y="4" width="8" height="8" rx="1.4" fill="currentColor" />
    </Svg>
  );
}

export function IconPlus({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M8 3v10M3 8h10" {...stroke} />
    </Svg>
  );
}

export function IconPencil({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M9.2 3.4 12.6 6.8 6 13.4H2.6V10Z" {...stroke} />
      <path d="M8 4.6 11.4 8" {...stroke} />
    </Svg>
  );
}

export function IconChevron({ size, className, open }: IconProps & { open?: boolean }): React.JSX.Element {
  return (
    <Svg size={size} className={`chevron-icon${open ? ' open' : ''} ${className ?? ''}`}>
      <path d="M6 4.5 10.5 8 6 11.5" {...stroke} />
    </Svg>
  );
}

export function IconClose({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M4 4 12 12M12 4 4 12" {...stroke} />
    </Svg>
  );
}

export function IconUndo({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M4 7.5H10.5a3.5 3.5 0 1 1 0 7H8" {...stroke} />
      <path d="M6.5 5 4 7.5 6.5 10" {...stroke} />
    </Svg>
  );
}

export function IconCheck({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" {...stroke} />
    </Svg>
  );
}

export function IconSearch({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <circle cx="7" cy="7" r="3.5" {...stroke} />
      <path d="M10 10 13.5 13.5" {...stroke} />
    </Svg>
  );
}

export function IconTerminal({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.5" {...stroke} />
      <path d="M4.5 6.5 6.5 8 4.5 9.5M8.5 10.5H11.5" {...stroke} />
    </Svg>
  );
}

export function IconEdit({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3 13.5h10M4.5 9.5 10.8 3.2a1.2 1.2 0 0 1 1.7 0l.3.3a1.2 1.2 0 0 1 0 1.7L6.5 11.5H4.5V9.5Z" {...stroke} />
    </Svg>
  );
}

export function IconTrash({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 5h9M6 5V3.5h4V5M5 5l.5 8h5L11 5" {...stroke} />
    </Svg>
  );
}

export function IconGlobe({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="5.5" {...stroke} />
      <path d="M2.5 8h11M8 2.5c1.8 1.8 2.7 3.7 2.7 5.5S9.8 11.7 8 13.5C6.2 11.7 5.3 9.8 5.3 8S6.2 4.3 8 2.5Z" {...stroke} />
    </Svg>
  );
}

export function IconSpark({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M8 2.5 9 6.2 12.5 7.2 9 8.2 8 13.5 7 8.2 3.5 7.2 7 6.2 8 2.5Z" {...stroke} />
    </Svg>
  );
}

export function IconBook({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3.5 3.5h4A2 2 0 0 1 9.5 5.5v7a1.5 1.5 0 0 0-1.5-1.5h-4.5v-8Z" {...stroke} />
      <path d="M12.5 3.5h-4A2 2 0 0 0 6.5 5.5v7a1.5 1.5 0 0 1 1.5-1.5h4.5v-8Z" {...stroke} />
    </Svg>
  );
}

export function IconMove({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3 8h10M8 3v10M5.5 5.5 3 8l2.5 2.5M10.5 5.5 13 8l-2.5 2.5" {...stroke} />
    </Svg>
  );
}

export function IconGear({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <circle cx="8" cy="8" r="2" {...stroke} />
      <path
        d="M8 2.5v1.3M8 12.2v1.3M2.5 8h1.3M12.2 8h1.3M4.1 4.1l.9.9M11 11l.9.9M11.9 4.1l-.9.9M5 11l-.9.9"
        {...stroke}
      />
    </Svg>
  );
}

export function IconChat({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M3 4.5h10a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H7l-3.5 2v-2H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" {...stroke} />
    </Svg>
  );
}

export function IconDiff({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M4 3.5h5.5L12 6v6.5H4v-9Z" {...stroke} />
      <path d="M6 9h4M8 7v4" {...stroke} />
    </Svg>
  );
}

export function IconExternal({ size, className }: IconProps): React.JSX.Element {
  return (
    <Svg size={size} className={className}>
      <path d="M7 3.5H3.5V12.5H12.5V9" {...stroke} />
      <path d="M8.5 3.5H12.5V7.5M12.5 3.5 7 9" {...stroke} />
    </Svg>
  );
}

const KIND_ICONS = {
  read: IconBook,
  search: IconSearch,
  edit: IconEdit,
  delete: IconTrash,
  move: IconMove,
  execute: IconTerminal,
  fetch: IconGlobe,
  think: IconSpark,
  other: IconGear,
} as const;

export function iconForKind(kind: string): (props: IconProps) => React.JSX.Element {
  return KIND_ICONS[kind as keyof typeof KIND_ICONS] ?? IconGear;
}
