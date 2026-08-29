import { LoadingPanel } from '@/components/loading-panel';

/** RC5/F6 — dashboard loading state. Renders inside the dashboard chrome. */
export default function Loading() {
  return <LoadingPanel label="Loading your dashboard" />;
}
