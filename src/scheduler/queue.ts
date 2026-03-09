/**
 * FIFO job queue for the scheduler.
 *
 * Jobs are enqueued when their timer fires and processed one at a time.
 * Sequential execution prevents parallel LLM API calls which would cause
 * rate limit issues and unnecessary cost. If 10 jobs fire at 8:00am,
 * they run one after another, each taking ~5-30 seconds.
 */

export interface QueueItem {
  jobId: string;
  /** Optional delay in ms before processing (used for retry backoff). */
  delayMs?: number;
}

type JobProcessor = (jobId: string) => Promise<void>;

export class JobQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private processor: JobProcessor;

  constructor(processor: JobProcessor) {
    this.processor = processor;
  }

  /** Add a job to the end of the queue. Starts processing if idle. */
  enqueue(item: QueueItem): void {
    this.queue.push(item);
    if (!this.processing) {
      this.processNext();
    }
  }

  /** Number of jobs currently waiting (not including the one being processed). */
  get pending(): number {
    return this.queue.length;
  }

  /** Whether a job is currently being executed. */
  get isProcessing(): boolean {
    return this.processing;
  }

  /**
   * Process the next job in the queue.
   * If the job has a delay, waits before executing.
   * Errors are caught and logged — a failing job never blocks the queue.
   */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;

    // Respect retry delay if set
    if (item.delayMs && item.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, item.delayMs));
    }

    try {
      await this.processor(item.jobId);
    } catch (err) {
      console.error(`[scheduler] Queue processor error for job "${item.jobId}":`, err);
    }

    // Process next item (if any)
    this.processNext();
  }
}
