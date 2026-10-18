const maxActive = 4;
let active = 0;

type Job = {
  start: (done: () => void) => () => void;
  cancel?: () => void;
  running: boolean;
  finished: boolean;
};

const pending: Job[] = [];

function finish(job: Job) {
  if (job.finished) return;
  job.finished = true;
  active -= 1;
  drain();
}

function drain() {
  while (active < maxActive && pending.length) {
    const job = pending.shift()!;
    if (job.finished) continue;
    job.running = true;
    active += 1;
    job.cancel = job.start(() => finish(job));
  }
}

export function queueThumbnailRequest(start: Job["start"]): () => void {
  const job: Job = { start, running: false, finished: false };
  pending.push(job);
  drain();
  return () => {
    if (job.finished) return;
    if (job.running) {
      job.cancel?.();
      finish(job);
    } else {
      job.finished = true;
      pending.splice(pending.indexOf(job), 1);
    }
  };
}
