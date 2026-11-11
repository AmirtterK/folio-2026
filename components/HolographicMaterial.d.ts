import type { ReactElement } from "react";

export type HolographicMaterialProps = {
  fresnelAmount?: number;
  fresnelOpacity?: number;
  scanlineSize?: number;
  hologramBrightness?: number;
  signalSpeed?: number;
  hologramColor?: string;
  enableBlinking?: boolean;
  blinkFresnelOnly?: boolean;
  enableAdditive?: boolean;
  hologramOpacity?: number;
  side?: "FrontSide" | "BackSide" | "DoubleSide";
};

export default function HolographicMaterial(props: HolographicMaterialProps): ReactElement;
