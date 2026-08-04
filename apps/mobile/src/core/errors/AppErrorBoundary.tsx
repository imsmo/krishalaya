// apps/mobile/src/core/errors/AppErrorBoundary.tsx · the GLOBAL render-crash fallback (Law 12, degrade-never-die).
// React only surfaces render/lifecycle errors to a class component (getDerivedStateFromError / componentDidCatch),
// so this is a class by necessity. Mounted once at the root (app/_layout.tsx) it guarantees a thrown render error
// NEVER white-screens the app: it reports the crash (redacted, via observability) and shows the same friendly
// server-error panel the (system)/server-error route uses, with a safe support reference + a retry that re-mounts
// the tree. No PII is shown or logged (only the SDK's safe requestId, if any). Static — renders without a backend.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { EmptyState, ScreenScaffold, color, font, space } from '@krishalaya/ui-native';
import { useTranslation } from '../i18n/useTranslation';
import { captureError } from '../observability';
import { safeErrorRef } from '../../features/system/system';

/** The visible fallback. A function child so it can use the translation hook (the boundary itself can't). */
function ErrorFallback({ refId, onRetry }: { refId: string | null; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <ScreenScaffold title={t('system.error.title')}>
      <EmptyState
        title={t('system.error.heading')}
        message={t('system.error.message')}
        actionLabel={t('common.retry')}
        onAction={onRetry}
        testID="app-error-fallback"
      />
      {refId ? <View style={styles.refBox}><Text style={styles.ref}>{t('system.error.ref', { ref: refId })}</Text></View> : null}
    </ScreenScaffold>
  );
}

interface Props { children: React.ReactNode }
interface State { error: unknown }

export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    // Best-effort, redacted crash report (never throws — captureError swallows). The component stack carries only
    // component names (no PII), and redactPII scrubs the context map before it leaves the device.
    captureError(error, { boundary: 'app-root', componentStack: info?.componentStack });
  }

  private reset = (): void => this.setState({ error: null });

  render(): React.ReactNode {
    if (this.state.error != null) {
      return <ErrorFallback refId={safeErrorRef(this.state.error)} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  refBox: { marginTop: space[3], alignItems: 'center' },
  ref: { fontFamily: font.body, fontSize: font.size.xs, color: color.ink400 },
});
