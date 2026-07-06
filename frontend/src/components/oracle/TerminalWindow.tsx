import type { ReactNode } from "react";

interface TerminalWindowProps {
  title: string;
  live?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * CRT-styled terminal frame: phosphor-glow border, local scanline overlay,
 * themed scrollbar, and a header bar with an optional live indicator. Visual
 * chrome only — the body and footer are supplied by the caller so the same
 * shell can host the Oracle's history + input line.
 */
export default function TerminalWindow({
  title,
  live = false,
  children,
  footer,
}: TerminalWindowProps) {
  return (
    <div className="oracle-terminal">
      <div className="oracle-terminal__bar">
        <span className="oracle-terminal__dots" aria-hidden>
          <span className="oracle-terminal__dot" />
          <span className="oracle-terminal__dot" />
          <span className="oracle-terminal__dot" />
        </span>
        <span className="oracle-terminal__title crt-glow">{title}</span>
        <span className="oracle-terminal__status">
          {live ? (
            <span className="oracle-terminal__live">
              <span className="oracle-dot oracle-dot--pulse" aria-hidden />
              live
            </span>
          ) : (
            <span className="oracle-terminal__idle">ready</span>
          )}
        </span>
      </div>
      <div className="oracle-terminal__body">{children}</div>
      {footer && <div className="oracle-terminal__footer">{footer}</div>}
    </div>
  );
}
