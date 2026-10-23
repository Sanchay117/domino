import { C } from "../theme";

/** The Domino mark, as in the app's favicon: a mint tile tipping against a standing one. `tip` animates the lean. */
export const LogoMark: React.FC<{ size: number; tip?: number }> = ({ size, tip = 1 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect x="4" y="9" width="9" height="18" rx="2" fill={C.mint} transform={`rotate(${-14 * tip} 8 18)`} />
    <rect x="17" y="5" width="9" height="22" rx="2" fill={C.text} />
  </svg>
);
