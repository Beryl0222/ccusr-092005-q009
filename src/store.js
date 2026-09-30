const iso = (d) => new Date(d).toISOString();

// 追加式事件日志：所有变更留痕，支持按历史日期重放，事件一旦写入不可修改。
export class EventStore {
  constructor(clock = () => new Date().toISOString()) {
    this._clock = clock;
    this._events = [];
  }

  now() {
    return iso(this._clock());
  }

  record(type, data = {}, at) {
    const event = { seq: this._events.length + 1, at: at ? iso(at) : this.now(), type, data };
    this._events.push(event);
    return event;
  }

  all() {
    return this._events.map((e) => ({ ...e, data: { ...e.data } }));
  }

  until(date) {
    const limit = iso(date);
    return this.all().filter((e) => e.at <= limit);
  }
}
