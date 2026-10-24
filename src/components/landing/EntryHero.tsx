"use client";

import dynamic from "next/dynamic";
import { Component, useSyncExternalStore, type ReactNode } from "react";
import { ClockPoster } from "./ClockPoster";

// The WebGL scene is only ever loaded on the entry screens, only in the browser, and only on wide screens.
const Scene = dynamic(() => import("@/components/three/AttendanceClockScene"), {
  ssr: false,
  loading: () => <Poster />,
});

function Poster() {
  return (
    <div className="absolute inset-x-0 bottom-0 top-12 flex items-center justify-center lg:inset-0">
      <ClockPoster className="h-[96%] w-[96%] max-w-[560px] animate-fade lg:h-[78%] lg:w-[78%]" />
    </div>
  );
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

let webglSupport: boolean | null = null;
function hasWebGL(): boolean {
  if (webglSupport === null) {
    try {
      const c = document.createElement("canvas");
      webglSupport = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noop = () => () => {};

/** If the renderer fails at runtime (lost context, driver issue), show the poster instead of a blank panel. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Poster /> : this.props.children;
  }
}

export function EntryHero() {
  const wide = useMedia("(min-width: 1024px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const webgl = useSyncExternalStore(noop, hasWebGL, () => false);

  if (!wide || !webgl) return <Poster />;
  return (
    <SceneBoundary>
      <div className="absolute inset-0 animate-fade">
        <Scene animated={!reduced} />
      </div>
    </SceneBoundary>
  );
}
