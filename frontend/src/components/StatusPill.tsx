import React from 'react';

export function StatusPill({ label, tone }: { label: string; tone: string }) {
  return (
    <span className={`status-pill status-${tone}`}>
      <span className="status-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
