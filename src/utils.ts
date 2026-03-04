import { ulid, decodeTime } from "ulid";

export function getTimeFromId(id: string): number {
  return decodeTime(id);
}

export function getIdFromTime(time: number = Date.now()): string {
  return ulid(time);
}

export function compareTimeIds(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
