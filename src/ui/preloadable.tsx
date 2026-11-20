import { type ComponentType, use } from "react";

/**
 * Like React.lazy, but `preload()` can fetch it ahead. Once loaded it renders
 * straight away, without the extra Suspense round that lazy always takes.
 */
export function preloadable<P extends object>(
  load: () => Promise<ComponentType<P>>,
) {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<unknown> | null = null;
  const preload = () => {
    pending ??= load().then((c) => {
      Loaded = c;
    });
    return pending;
  };
  // biome-ignore lint/correctness/noComponentHookFactories: made once per module, like React.lazy
  function Preloadable(props: P) {
    if (!Loaded) use(preload());
    return Loaded && <Loaded {...props} />;
  }
  return Object.assign(Preloadable, { preload });
}
