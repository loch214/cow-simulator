// Ask for a character's skin. Each job gets its own short-lived worker, so the
// cow, the officer and the flock are meshed in parallel; if workers are not
// available the job simply runs here instead, which is slower to start but
// otherwise identical.

import * as THREE from "three";
import { runJob, unpack, type PackedGeo, type SkinJob } from "./skinJobs";

const cache = new Map<string, Promise<THREE.BufferGeometry[]>>();

export function skinGeometry(job: SkinJob): Promise<THREE.BufferGeometry[]> {
  // one build per kind: the officer's rest frames never change between mounts
  const hit = cache.get(job.kind);
  if (hit) return hit;
  const promise = new Promise<THREE.BufferGeometry[]>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./skin.worker.ts", import.meta.url), { type: "module" });
    } catch {
      resolve(runJob(job));
      return;
    }
    worker.onmessage = (e: MessageEvent<PackedGeo[]>) => {
      resolve(e.data.map(unpack));
      worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      resolve(runJob(job));
    };
    worker.postMessage(job);
  });
  cache.set(job.kind, promise);
  return promise;
}
