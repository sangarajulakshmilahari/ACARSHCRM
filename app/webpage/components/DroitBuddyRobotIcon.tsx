type Props = {
  className?: string;
  size?: number;
};

export default function DroitBuddyRobotIcon({
  className,
  size = 30,
}: Props): JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="24" cy="4.6" r="2.6" fill="#F26522" />
      <path
        d="M24 7.2v5.2"
        stroke="#F26522"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <rect x="7.2" y="20.5" width="4.2" height="8.2" rx="2.1" fill="#F26522" />
      <rect x="36.6" y="20.5" width="4.2" height="8.2" rx="2.1" fill="#F26522" />
      <rect x="11" y="12.2" width="26" height="28.2" rx="11" fill="#FFFFFF" />
      <rect x="15" y="17.4" width="18" height="12.2" rx="6.1" fill="#0F1F3D" />
      <circle cx="20.4" cy="23.5" r="2.15" fill="#FFFFFF" />
      <circle cx="27.6" cy="23.5" r="2.15" fill="#FFFFFF" />
      <circle cx="20.9" cy="23.5" r="0.95" fill="#F26522" />
      <circle cx="28.1" cy="23.5" r="0.95" fill="#F26522" />
      <path
        d="M19.8 34.6c1.35 1.55 7.05 1.55 8.4 0"
        stroke="#F26522"
        strokeWidth="1.85"
        strokeLinecap="round"
      />
    </svg>
  );
}
