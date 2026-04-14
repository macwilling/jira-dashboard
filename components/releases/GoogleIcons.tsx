import type { SVGProps } from "react";

/**
 * Google Tasks brand mark — blue rounded square with white check.
 * Brand-neutral stand-in in the same visual family as Google's real mark.
 */
export function GoogleTasksIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#1A73E8" />
      <path
        d="M7 12.2 10.3 15.5 17 8.8"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

/**
 * Google Calendar brand mark — white square with colored tab and "31".
 */
export function GoogleCalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <rect x="2.5" y="4" width="19" height="17" rx="2.5" fill="#fff" stroke="#DADCE0" strokeWidth="1" />
      <path d="M2.5 7a2.5 2.5 0 0 1 2.5-3h14a2.5 2.5 0 0 1 2.5 3v1.5h-19V7Z" fill="#4285F4" />
      <rect x="6.5" y="2" width="1.8" height="4.5" rx="0.9" fill="#202124" />
      <rect x="15.7" y="2" width="1.8" height="4.5" rx="0.9" fill="#202124" />
      <text
        x="12"
        y="18"
        textAnchor="middle"
        fontFamily="system-ui, -apple-system, Roboto, Arial, sans-serif"
        fontSize="8"
        fontWeight="600"
        fill="#1A73E8"
      >
        31
      </text>
    </svg>
  );
}
