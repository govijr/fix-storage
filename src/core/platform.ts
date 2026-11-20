/** What differs between operating systems, in one place. */

export type Os = "mac" | "linux" | "windows";

export const OS: Os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "windows" : "linux";

export const IS_MAC = OS === "mac";
export const IS_LINUX = OS === "linux";
export const IS_WINDOWS = OS === "windows";

/**
 * Picks this system's value. Every system needs one, so adding a system to
 * Os makes the compiler list each place that has to say what it does there.
 */
export function byOs<T>(values: Record<Os, T>): T {
  return values[OS];
}

/** The operating system's name, for messages. */
export const OS_NAME = byOs({ mac: "macOS", linux: "Linux", windows: "Windows" });

/** What revealing an item opens, for messages: "Showing x in Finder." */
export const FILE_MANAGER = byOs({ mac: "Finder", linux: "your file manager", windows: "File Explorer" });

/** Lowercase label for the reveal action. */
export const REVEAL_LABEL = byOs({ mac: "reveal in finder", linux: "show in file manager", windows: "show in explorer" });

/** What the trash is called, capitalized as a name: "Moved to Trash:", "Empty the Recycle Bin". */
export const TRASH = byOs({ mac: "Trash", linux: "Trash", windows: "Recycle Bin" });

/** Systems where fix-storage lists more than one drive. A Mac shows its startup disk only. */
export const MANY_DRIVES = byOs({ mac: false, linux: true, windows: true });

/** The key shown for removing an item. Windows keyboards say Delete, and Windows Terminal draws ⌫ too wide. */
export const DELETE_KEY = byOs({ mac: "⌫", linux: "⌫", windows: "del" });
