"use client";

// The header streams in after the page and the install state only exists in the browser, so this button is loaded on the
// client only (nothing in the server HTML to mismatch).
import dynamic from "next/dynamic";

const InstallButton = dynamic(() => import("./InstallButton").then((m) => m.InstallButton), { ssr: false });

export function HeaderInstall() {
  return <InstallButton variant="header" source="header" />;
}
