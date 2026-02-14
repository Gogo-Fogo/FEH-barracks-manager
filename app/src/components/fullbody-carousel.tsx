"use client";

import { useState } from "react";

type FullbodyCarouselProps = {
  heroName: string;
  poses: string[];
  heroSlug: string;
};

function poseLabel(pose: string) {
  return pose.charAt(0).toUpperCase() + pose.slice(1);
}

export function FullbodyCarousel({ heroName, poses, heroSlug }: FullbodyCarouselProps) {
  const safePoses = poses.length ? poses : ["portrait"];
  const [index, setIndex] = useState(0);
  const currentPose = safePoses[index] || safePoses[0];

  const prev = () => setIndex((i) => (i - 1 + safePoses.length) % safePoses.length);
  const next = () => setIndex((i) => (i + 1) % safePoses.length);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <img
        src={`/api/fullbody/${heroSlug}?pose=${encodeURIComponent(currentPose)}`}
        alt={`${heroName} ${currentPose} art`}
        className="mx-auto h-[360px] w-[220px] rounded-lg border border-zinc-700 object-contain bg-zinc-900"
      />

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={prev}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Previous pose"
        >
          ←
        </button>

        <p className="text-xs text-zinc-300">
          {poseLabel(currentPose)} ({index + 1}/{safePoses.length})
        </p>

        <button
          type="button"
          onClick={next}
          className="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          aria-label="Next pose"
        >
          →
        </button>
      </div>
    </div>
  );
}
