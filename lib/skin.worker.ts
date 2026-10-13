// Meshes characters off the main thread. Building the cow's skin takes the
// best part of a second (several, on a slow phone), and doing it on the main
// thread froze the title card while it happened.

import { pack, runJob, transferables, type SkinJob } from "./skinJobs";

self.onmessage = (e: MessageEvent<SkinJob>) => {
  const out = runJob(e.data).map(pack);
  (self as unknown as Worker).postMessage(out, transferables(out));
};
