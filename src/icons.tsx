import type {ReactElement} from 'react';
import type {Page} from './types';

export interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  xmlns: 'http://www.w3.org/2000/svg'
};

export function OverviewIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function ClientsIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function LoansIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}

export function CollectionsIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
      <polyline points="17 18 23 18 23 12" />
    </svg>
  );
}

export function QuestionsIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <circle cx="9" cy="10" r="1" fill="currentColor" />
      <circle cx="12" cy="10" r="1" fill="currentColor" />
      <circle cx="15" cy="10" r="1" fill="currentColor" />
    </svg>
  );
}

export function WalletIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
      <circle cx="16" cy="14" r="1.5" />
    </svg>
  );
}

export function ReportsIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

export function SettingsIcon({size = 18, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function GiveMoneyIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

export function GetMoneyIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <line x1="17" y1="7" x2="7" y2="17" />
      <polyline points="17 17 7 17 7 7" />
    </svg>
  );
}

export function ReceiptIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1z" />
      <line x1="8" y1="7" x2="16" y2="7" />
      <line x1="8" y1="11" x2="16" y2="11" />
      <line x1="8" y1="15" x2="12" y2="15" />
    </svg>
  );
}

export function SearchIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function RefreshIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  );
}

export function PlusIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function CheckIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function XIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function CopyIcon({size = 15, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function ChevronRightIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export function ChevronDownIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function LockIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function ShieldIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

export function UserIcon({size = 16, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function PhoneIcon({size = 15, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

export function CalendarIcon({size = 15, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

export function PlayIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polygon points="5 3 19 12 5 21 5 3" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <rect x="6" y="4" width="4" height="16" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" fill="currentColor" />
    </svg>
  );
}

export function RotateCcwIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  );
}

export function ZoomInIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="11" y1="8" x2="11" y2="14" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

export function ZoomOutIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      <line x1="8" y1="11" x2="14" y2="11" />
    </svg>
  );
}

export function ArrowRightIcon({size = 14, className, strokeWidth = 2}: IconProps): ReactElement {
  return (
    <svg {...base} width={size} height={size} viewBox="0 0 24 24" strokeWidth={strokeWidth} className={className} aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export function PageIcon({page, size = 18, className}: {page: Page; size?: number; className?: string}): ReactElement {
  switch (page) {
    case 'overview':
      return <OverviewIcon size={size} className={className} />;
    case 'clients':
      return <ClientsIcon size={size} className={className} />;
    case 'loans':
      return <LoansIcon size={size} className={className} />;
    case 'collections':
      return <CollectionsIcon size={size} className={className} />;
    case 'questions':
      return <QuestionsIcon size={size} className={className} />;
    case 'wallet':
      return <WalletIcon size={size} className={className} />;
    case 'reports':
      return <ReportsIcon size={size} className={className} />;
    case 'settings':
      return <SettingsIcon size={size} className={className} />;
    default:
      return <OverviewIcon size={size} className={className} />;
  }
}
