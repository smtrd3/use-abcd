import { isEqual } from "lodash-es";
import type { Draft } from "mutative";
import type { Collection } from "./collection";
import type { ItemStatus } from "./types";

export class Item<T extends object, C = unknown> {
  private _collection: Collection<T, C>;
  private _id: string;
  private _cachedStatus: ItemStatus = null;

  constructor(collection: Collection<T, C>, id: string) {
    this._collection = collection;
    this._id = id;
  }

  get id(): string {
    return this._id;
  }

  get data(): T | undefined {
    return this._collection.getState().items.get(this._id);
  }

  update(mutate: (draft: Draft<T>) => void): void {
    this._collection.update(this._id, mutate);
  }

  remove(): void {
    this._collection.remove(this._id);
  }

  getStatus(): ItemStatus {
    const newStatus = this._collection.getItemStatus(this._id);
    if (!isEqual(this._cachedStatus, newStatus)) {
      this._cachedStatus = newStatus;
    }
    return this._cachedStatus;
  }

  exists(): boolean {
    return this._collection.getState().items.has(this._id);
  }

  // Expose collection for useItem hook
  get collection(): Collection<T, C> {
    return this._collection;
  }

  // Internal method to update ID after server assigns permanent ID
  // Called by Collection when handling ID remapping
  _updateId(newId: string): void {
    this._id = newId;
  }
}
