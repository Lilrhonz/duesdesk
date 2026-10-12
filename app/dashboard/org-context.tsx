"use client";

import { createContext, useContext } from "react";

export type OrgInfo = {
  id: string;
  name: string;
  org_type: string | null;
  currency: string;
  role: string;
  email: string;
  userName: string;
};

export const OrgContext = createContext<OrgInfo | null>(null);

export function useOrg(): OrgInfo {
  const value = useContext(OrgContext);
  if (!value) throw new Error("useOrg must be used inside the dashboard layout");
  return value;
}
