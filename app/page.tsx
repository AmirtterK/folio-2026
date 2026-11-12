"use client";

import dynamic from "next/dynamic";

// WebGL only exists in the browser, so skip server rendering for the scene.
const FolioScene = dynamic(() => import("@/components/FolioScene"), { ssr: false });

export default function Page() {
  return <FolioScene />;
}
