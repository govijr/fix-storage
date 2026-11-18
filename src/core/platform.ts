/** What differs between operating systems, in one place. */

export type Os = "mac" | "linux";

export const OS: Os = process.platform === "darwin" ? "mac" : "linux";

export const IS_MAC = OS === "mac";
export const IS_LINUX = OS === "linux";

/**
 * Picks this system's value. Every system needs one, so adding a system to
 * Os makes the compiler list each place that has to say what it does there.
 */
export function byOs<T>(values: Record<Os, T>): T {
  return values[OS];
}

/** The operating system's name, for messages. */
export const OS_NAME = byOs({ mac: "macOS", linux: "Linux" });

/** What revealing an item opens, for messages: "Showing x in Finder." */
export const FILE_MANAGER = byOs({ mac: "Finder", linux: "your file manager" });

/** Lowercase label for the reveal action. */
export const REVEAL_LABEL = byOs({ mac: "reveal in finder", linux: "show in file manager" });
