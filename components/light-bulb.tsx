"use client";

import type { DeviceState } from "@/types/device";

interface LightBulbProps {
  state: DeviceState;
  isPending: boolean;
}

export function LightBulb({ state, isPending }: LightBulbProps) {
  const isOn = state === "ON";

  return (
    <div className="relative flex flex-col items-center gap-2">
      {/* Glow effect behind bulb */}
      <div
        className={`absolute top-1 h-20 w-20 rounded-full blur-2xl transition-all duration-500 ${
          isOn
            ? "bg-amber-400/60 scale-100"
            : "bg-zinc-400/0 scale-50"
        }`}
      />

      {/* Bulb SVG */}
      <svg
        width="80"
        height="80"
        viewBox="0 0 80 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`relative z-10 transition-all duration-300 ${
          isPending ? "animate-pulse" : ""
        }`}
      >
        {/* Bulb body */}
        <path
          d="M40 8C26.745 8 16 18.745 16 32c0 8.4 4.2 15.7 10.6 20.2L24 60h32l-2.6-7.8C59.8 47.7 64 40.4 64 32 64 18.745 53.255 8 40 8z"
          fill={isOn ? "#FBBF24" : "#3F3F46"}
          stroke={isOn ? "#F59E0B" : "#52525B"}
          strokeWidth="2"
          className="transition-all duration-500"
        />

        {/* Inner glow when ON */}
        {isOn && (
          <ellipse
            cx="40"
            cy="30"
            rx="12"
            ry="14"
            fill="#FEF3C7"
            opacity="0.7"
          />
        )}

        {/* Filament lines */}
        <path
          d="M34 34c2-4 4-2 6-6s4-2 6 2"
          stroke={isOn ? "#FEF3C7" : "#71717A"}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
          className="transition-all duration-500"
        />

        {/* Bulb base */}
        <rect
          x="30"
          y="52"
          width="20"
          height="4"
          rx="1"
          fill={isOn ? "#D97706" : "#52525B"}
          className="transition-all duration-500"
        />
        <rect
          x="32"
          y="56"
          width="16"
          height="3"
          rx="1"
          fill={isOn ? "#B45309" : "#3F3F46"}
          className="transition-all duration-500"
        />
        <rect
          x="33"
          y="59"
          width="14"
          height="3"
          rx="1"
          fill={isOn ? "#92400E" : "#27272A"}
          className="transition-all duration-500"
        />

        {/* Screw thread lines */}
        <line x1="33" y1="57" x2="47" y2="57" stroke={isOn ? "#78350F" : "#18181B"} strokeWidth="0.5" />
        <line x1="33.5" y1="60" x2="46.5" y2="60" stroke={isOn ? "#78350F" : "#18181B"} strokeWidth="0.5" />
      </svg>

      {/* State label */}
      <span
        className={`relative z-10 text-sm font-bold tracking-wide transition-colors duration-300 ${
          isOn
            ? "text-amber-600 dark:text-amber-400"
            : "text-zinc-400 dark:text-zinc-500"
        }`}
      >
        {isPending ? "..." : isOn ? "SÁNG" : "TẮT"}
      </span>
    </div>
  );
}
