import { LoadingPanel } from '@/components/loading-panel';

/** RC5/F6 — root loading state. Pure static UI, no data access. */
export default function Loading() {
  return <LoadingPanel label="Loading" />;
}
