"use client";

import { useEffect } from "react";
import { initRemote } from "@/lib/store/remote";

/** Liga a camada do Supabase (sessão e login/logout) assim que o app abre no navegador. */
export function RemoteBoot() {
  useEffect(() => {
    initRemote();
  }, []);
  return null;
}
