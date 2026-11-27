/**
 * Adapted from LodyAI/Lody (Apache License 2.0): packages/components/src/lib/ime.ts.
 */
interface NativeImeAwareKeyboardEvent {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  which?: number;
}

/**
 * IME composition detection for keydown handlers. `isComposing` is the primary signal, but some
 * browsers and IMEs only expose composition through key=Process or keyCode/which=229.
 */
export function isImeComposingNativeKeyboardEvent(event: NativeImeAwareKeyboardEvent): boolean {
  if (event.isComposing) return true;
  if (event.key === "Process") return true;
  return event.keyCode === 229 || event.which === 229;
}
