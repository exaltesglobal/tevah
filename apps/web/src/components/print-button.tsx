"use client";

import { Button } from "./ui";

export function PrintButton() {
  return (
    <Button variant="secondary" type="button" onClick={() => window.print()}>
      Print / PDF
    </Button>
  );
}
