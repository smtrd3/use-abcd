import { isEqual } from "lodash-es";
import { useMemo, useRef } from "react";

export const CANCEL_RECOVERABLE = "CANCEL_RECOVERABLE";
export const CANCELLED_BY_USER = "CANCELLED_BY_USER";

export const useMemoDeepEquals = <T>(value: T) => {
  const valueRef = useRef(value);

  return useMemo(() => {
    if (!isEqual(value, valueRef.current)) {
      valueRef.current = value;
    }
    return valueRef.current;
  }, [value]);
};

export function wait(ms: number, signal: AbortSignal, onAbort?: () => void) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abortCallback);
      resolve("WAIT_COMPLETE");
    }, ms);

    const abortCallback = () => {
      onAbort?.();
      clearTimeout(timeout);
      reject(CANCEL_RECOVERABLE);
    };

    signal.addEventListener("abort", abortCallback);
  });
}
