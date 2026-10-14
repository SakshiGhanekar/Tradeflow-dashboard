import React from 'react';

export default function Logo() {
  return (
    <svg className="logo-svg" viewBox="0 0 64 64" width="40" height="40" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lg" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#7f8cff" />
          <stop offset="100%" stopColor="#8ee2ff" />
        </linearGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g filter="url(#glow)">
        <rect x="4" y="4" width="56" height="56" rx="12" fill="url(#lg)" />
        <g transform="translate(0,2)">
          <path className="logo-letter" d="M20 44 L28 16 L36 44 L32 44 L30 36 L22 36 L20 44 Z" fill="#051521" />
        </g>
      </g>
    </svg>
  );
}
