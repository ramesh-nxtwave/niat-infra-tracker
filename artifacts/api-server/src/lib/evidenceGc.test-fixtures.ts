import { ObjectStorageService } from "./objectStorage";

export type ControlledDeleteOutcome = "deleted" | "not-found" | "failure" | "crash";

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = fulfill;
  });
  return { promise, resolve };
}

/**
 * A storage double for GC integration tests. It deliberately models the
 * storage boundary rather than mocking the GC worker: callers can hold a
 * physical delete between its start and completion, inspect an object while
 * that delete is pending, and make a later retry succeed.
 */
export class ControlledEvidenceStorage extends ObjectStorageService {
  readonly objects = new Map<string, Uint8Array>();
  readonly deleteCalls: string[] = [];
  private deleteOutcome: ControlledDeleteOutcome = "deleted";
  private deleteGate: Deferred | null = null;
  private deleteStarted: Deferred | null = null;

  seed(objectPath: string, contents: string | Uint8Array = "evidence") {
    this.objects.set(
      objectPath,
      typeof contents === "string" ? new TextEncoder().encode(contents) : contents,
    );
  }

  setDeleteOutcome(outcome: ControlledDeleteOutcome) {
    this.deleteOutcome = outcome;
  }

  delayDeletes() {
    this.deleteGate = deferred();
    this.deleteStarted = deferred();
  }

  releaseDeletes() {
    this.deleteGate?.resolve();
    this.deleteGate = null;
  }

  async waitForDeleteStart() {
    await this.deleteStarted?.promise;
  }

  read(objectPath: string): Uint8Array {
    const object = this.objects.get(objectPath);
    if (!object) throw new Error(`Fake object not found: ${objectPath}`);
    return object;
  }

  async deleteOwnedEvidenceObject(objectPath: string): Promise<void> {
    this.deleteCalls.push(objectPath);
    this.deleteStarted?.resolve();
    await this.deleteGate?.promise;

    switch (this.deleteOutcome) {
      case "deleted":
        this.objects.delete(objectPath);
        return;
      case "not-found":
        // ObjectStorageService treats an object-storage 404 as a successful,
        // idempotent delete. The fake therefore models its public contract.
        this.objects.delete(objectPath);
        return;
      case "failure":
        throw Object.assign(new Error("controlled storage failure"), { code: 503 });
      case "crash":
        throw new Error("controlled worker crash");
    }
  }
}