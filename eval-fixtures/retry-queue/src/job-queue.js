export class JobQueue {
  constructor(handler) {
    if (typeof handler !== "function") throw new TypeError("handler must be a function");
    this.handler = handler;
  }

  async run(job) {
    return this.handler(job);
  }
}
