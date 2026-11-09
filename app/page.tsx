"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so skip server rendering for the lab.
const CarLab = dynamic(() => import("@/components/CarLab"), { ssr: false });

export default function Page() {
  return <CarLab />;
}
