// [Alex] In-process job queue, one job at a time (the pipeline is heavy and shares one Gemini quota).

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  get size(): number {
    return this.pending;
  }

  /** Runs `task` after every earlier task settles. Errors are handled by the task itself. */
  add(task: () => Promise<void>): Promise<void> {
    this.pending++;
    const run = this.tail.then(task).finally(() => {
      this.pending--;
    });
    this.tail = run.catch(() => undefined);
    return run;
  }
}
