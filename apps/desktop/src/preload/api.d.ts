import type { DesktopBridge } from '@grok-desktop/shared';

declare global {
  interface Window {
    readonly grokDesktop: DesktopBridge;
  }
}

export {};
