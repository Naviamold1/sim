"use client";

import { useEffect, useState } from "react";
import { useGameStore } from "./game-store";

export function useServerClock() {
  const offset = useGameStore((state) => state.clockOffset);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now + offset;
}

export function remainingSeconds(deadline: number | null, now: number) {
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
