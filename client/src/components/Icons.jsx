export function Svg({ children, size = 20, filled = false, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function CashierIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9.5 8h5M9.5 12h5M12 15.5v-8M8.2 12.2l3.8-3.8 3.8 3.8" />
    </Svg>
  );
}

export function DashboardIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="7.5" height="8" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="5" rx="2" />
      <rect x="3" y="14" width="7.5" height="7" rx="2" />
      <rect x="13.5" y="11" width="7.5" height="10" rx="2" />
    </Svg>
  );
}

export function HistoryIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3.05 11a9 9 0 1 0 2.4-6.4" />
      <path d="M3 4v4.5h4.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function ReportsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  );
}

export function SettingsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </Svg>
  );
}

export function CheckIcon(props) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function AlertIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5M12 17.2v.1" />
    </Svg>
  );
}

export function RefreshIcon(props) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2" />
      <path d="M21 4v5h-5M3 20v-5h5" />
    </Svg>
  );
}

export function PrintIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7 8V3h10v5" />
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 13h10v8H7z" />
    </Svg>
  );
}

export function BackupIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function RestoreIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 15V3M7.5 7.5 12 3l4.5 4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Svg>
  );
}

export function FolderIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </Svg>
  );
}

export function DatabaseIcon(props) {
  return (
    <Svg {...props}>
      <ellipse cx="12" cy="5.5" rx="8" ry="3" />
      <path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </Svg>
  );
}

export function ScaleIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v18M6 21h12" />
      <path d="M12 6 5 9l2.5 5.5a3 3 0 0 0 5 0L15 9l-3-3Z" />
    </Svg>
  );
}

export function RupeeIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7 4h10M7 8.5h10M7 20l6.5-7.5H10a4.5 4.5 0 0 1 0-9" />
    </Svg>
  );
}

export function ReceiptIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9.5 8h5M9.5 12h5M9.5 16h3" />
    </Svg>
  );
}

export function TrendUpIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M15 7h6v6" />
    </Svg>
  );
}

export function BrandMark({ size = 44 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Joona Biryani logo"
      focusable="false"
    >
      <defs>
        <linearGradient id="jb-bowl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6cf7c" />
          <stop offset="100%" stopColor="#d99a2b" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="#4a1010" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="13.5" fill="none" stroke="#eab54f" strokeOpacity="0.55" />
      <path d="M16 32h32c0 9.4-7.2 17-16 17s-16-7.6-16-17Z" fill="url(#jb-bowl)" />
      <path d="M13 29.5h38" stroke="#f9ecd2" strokeWidth="3.6" strokeLinecap="round" />
      <path
        d="M25 22c-3.2-3.6 2.6-5.6 0-9.4M33.5 22c-3.2-3.6 2.6-5.6 0-9.4M42 22c-3.2-3.6 2.6-5.6 0-9.4"
        stroke="#f9ecd2"
        strokeOpacity="0.9"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
