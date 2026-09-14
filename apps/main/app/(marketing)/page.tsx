import UnifiedLanding from './unified-landing';

/**
 * Static marketing shell for the unified Flavourly Restaurant Growth OS.
 * Authentication-aware redirect remains client-side inside the landing UI
 * so the public home page stays statically renderable on Vercel.
 */
export default function Page() {
  return <UnifiedLanding />;
}
